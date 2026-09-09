/**
 * Storage for the MONITOR weekly digest.
 *
 * Two kinds of function live here, mirroring src/db/monitoring.ts:
 *
 *   - tenant-scoped reads and writes for the console and the digest builder;
 *   - scheduler-facing queries that take a bare `SqlDb` because a cron tick has
 *     no session — the workspace, its owner email and its preferences all come
 *     out of the row itself. Every one of those still selects or mutates a
 *     single workspace at a time.
 *
 * The digest reads already-computed scheduled-run output and never triggers an
 * analysis, so nothing in this file spends at the provider.
 */

import {
  DEFAULT_MONITOR_DIGEST_SETTINGS,
  MONITOR_DIGEST_CLAIM_TTL_MS,
  MONITOR_DIGEST_INTERVAL_MS,
  isMonitorDigestCadence,
  type MonitorDigestClientFacts,
  type MonitorDigestFacts,
  type MonitorDigestSettings,
} from "@/core/monitorDigest";
import type { MonitoringOutcome } from "@/core/monitoring";
import type { SqlDb } from "@/db/sql";
import type { TenantScope } from "@/db/tenant";

// ---------------------------------------------------------------------------
// settings (tenant-scoped)
// ---------------------------------------------------------------------------

interface DigestSettingsRow {
  monitor_digest_cadence: string;
  monitor_digest_only_on_change: number;
  monitor_digest_recipient: string | null;
}

export async function getMonitorDigestSettings(t: TenantScope): Promise<MonitorDigestSettings> {
  const row = await t.db
    .prepare(
      `SELECT monitor_digest_cadence, monitor_digest_only_on_change, monitor_digest_recipient
       FROM workspaces WHERE id = ?`,
    )
    .bind(t.workspaceId)
    .first<DigestSettingsRow>();
  if (!row) return { ...DEFAULT_MONITOR_DIGEST_SETTINGS };
  return {
    cadence: isMonitorDigestCadence(row.monitor_digest_cadence)
      ? row.monitor_digest_cadence
      : "weekly",
    onlyOnChange: row.monitor_digest_only_on_change !== 0,
    recipient: row.monitor_digest_recipient ?? null,
  };
}

/**
 * Save digest preferences. Turning the digest off clears the schedule so the
 * tick stops selecting this workspace; turning it on leaves `next_due` null,
 * which the due query reads as "due now" so the first digest lands on the next
 * daily tick rather than immediately.
 */
export async function setMonitorDigestSettings(
  t: TenantScope,
  input: MonitorDigestSettings,
): Promise<void> {
  const recipient = input.recipient && input.recipient.trim().length > 0 ? input.recipient.trim() : null;
  if (input.cadence === "off") {
    await t.db
      .prepare(
        `UPDATE workspaces SET
           monitor_digest_cadence = 'off',
           monitor_digest_only_on_change = ?,
           monitor_digest_recipient = ?,
           monitor_digest_next_due_at = NULL,
           monitor_digest_claimed_at = NULL
         WHERE id = ?`,
      )
      .bind(input.onlyOnChange ? 1 : 0, recipient, t.workspaceId)
      .run();
    return;
  }
  await t.db
    .prepare(
      `UPDATE workspaces SET
         monitor_digest_cadence = ?,
         monitor_digest_only_on_change = ?,
         monitor_digest_recipient = ?
       WHERE id = ?`,
    )
    .bind(input.cadence, input.onlyOnChange ? 1 : 0, recipient, t.workspaceId)
    .run();
}

// ---------------------------------------------------------------------------
// facts (tenant-scoped) — what a period changed
// ---------------------------------------------------------------------------

const OPEN_STATUSES = ["new", "accepted", "proposal_prepared", "pitched"] as const;

/**
 * Aggregate everything a digest for [since, until) needs, for one workspace.
 *
 * Only monitored clients that had at least one scheduled scan in the window
 * appear in `clients` — those are the only clients a weekly digest can honestly
 * say anything changed about. Open-opportunity figures reflect the client's
 * live pipeline (mirroring the `isOpen` predicate in app/lib/portfolio.ts), so
 * a "3 new" line can be priced from the catalog.
 */
export async function collectDigestFacts(
  t: TenantScope,
  input: { since: string; until: string; now?: Date },
): Promise<MonitorDigestFacts> {
  const nowIso = (input.now ?? new Date()).toISOString();

  const workspace = await t.db
    .prepare(`SELECT name FROM workspaces WHERE id = ?`)
    .bind(t.workspaceId)
    .first<{ name: string }>();

  const clientRows = await t.db
    .prepare(
      `SELECT id, name, domain, average_job_value
       FROM clients
       WHERE workspace_id = ? AND monitoring_cadence != 'off'`,
    )
    .bind(t.workspaceId)
    .all<{ id: string; name: string; domain: string; average_job_value: number | null }>();
  const monitored = new Map(clientRows.map((c) => [c.id, c]));

  // Change per client across scheduled scans in the window.
  const aggregates = await t.db
    .prepare(
      `SELECT client_id,
              SUM(new_count) AS new_count,
              SUM(resolved_count) AS resolved_count
       FROM analysis_runs
       WHERE workspace_id = ? AND trigger = 'scheduled'
         AND finished_at >= ? AND finished_at < ?
       GROUP BY client_id`,
    )
    .bind(t.workspaceId, input.since, input.until)
    .all<{ client_id: string; new_count: number | null; resolved_count: number | null }>();

  // Most recent scheduled outcome per client in the window — for the headline
  // and the honest "could not read this site" count.
  const latest = await t.db
    .prepare(
      `SELECT r.client_id AS client_id, r.outcome AS outcome
       FROM analysis_runs r
       JOIN (
         SELECT client_id, MAX(finished_at) AS mx
         FROM analysis_runs
         WHERE workspace_id = ? AND trigger = 'scheduled'
           AND finished_at >= ? AND finished_at < ?
         GROUP BY client_id
       ) m ON m.client_id = r.client_id AND m.mx = r.finished_at
       WHERE r.workspace_id = ? AND r.trigger = 'scheduled'`,
    )
    .bind(t.workspaceId, input.since, input.until, t.workspaceId)
    .all<{ client_id: string; outcome: string }>();
  const latestOutcome = new Map(latest.map((r) => [r.client_id, r.outcome]));

  // Open, billable opportunities right now — grouped in JS so the top one (the
  // deep-link target) and the summed price range come from the same rows.
  const openRows = await t.db
    .prepare(
      `SELECT id, client_id, title, price_min, price_max
       FROM opportunities
       WHERE workspace_id = ?
         AND billable_status = 'billable'
         AND (
           status IN (${OPEN_STATUSES.map(() => "?").join(", ")})
           OR (status = 'snoozed' AND snooze_until IS NOT NULL AND snooze_until <= ?)
         )
       ORDER BY price_max DESC, id ASC`,
    )
    .bind(t.workspaceId, ...OPEN_STATUSES, nowIso)
    .all<{ id: string; client_id: string; title: string; price_min: number; price_max: number }>();

  const openByClient = new Map<
    string,
    { count: number; priceMin: number; priceMax: number; top: { id: string; title: string; priceMin: number; priceMax: number } | null }
  >();
  for (const row of openRows) {
    const entry = openByClient.get(row.client_id) ?? { count: 0, priceMin: 0, priceMax: 0, top: null };
    entry.count += 1;
    entry.priceMin += row.price_min;
    entry.priceMax += row.price_max;
    // Rows arrive price_max DESC, so the first seen per client is the top one.
    if (!entry.top) {
      entry.top = { id: row.id, title: row.title, priceMin: row.price_min, priceMax: row.price_max };
    }
    openByClient.set(row.client_id, entry);
  }

  const clients: MonitorDigestClientFacts[] = [];
  for (const agg of aggregates) {
    const client = monitored.get(agg.client_id);
    if (!client) continue; // a run for a since-unmonitored client is not reported
    const open = openByClient.get(agg.client_id);
    const outcome = latestOutcome.get(agg.client_id);
    clients.push({
      clientId: client.id,
      clientName: client.name,
      domain: client.domain,
      newCount: Number(agg.new_count ?? 0) || 0,
      resolvedCount: Number(agg.resolved_count ?? 0) || 0,
      couldNotRead: outcome === "inconclusive",
      latestOutcome: (outcome as MonitoringOutcome | undefined) ?? null,
      openCount: open?.count ?? 0,
      openPriceMin: open?.priceMin ?? 0,
      openPriceMax: open?.priceMax ?? 0,
      topOpportunity: open?.top ?? null,
      averageJobValue: client.average_job_value ?? null,
    });
  }

  return {
    workspaceName: workspace?.name ?? "Your agency",
    period: { since: input.since, until: input.until },
    monitoredClients: monitored.size,
    clients,
  };
}

// ---------------------------------------------------------------------------
// run log (tenant-scoped) — history + idempotency
// ---------------------------------------------------------------------------

export type MonitorDigestRunOutcome =
  | "sent"
  | "skipped_no_change"
  | "skipped_not_entitled"
  | "failed";

export interface MonitorDigestRunInput {
  periodStart: string;
  periodEnd: string;
  sentAt: string;
  recipient: string | null;
  outcome: MonitorDigestRunOutcome;
  newCount: number;
  resolvedCount: number;
  clientCount: number;
  error?: string | null;
}

export interface MonitorDigestRunRecord {
  periodStart: string;
  periodEnd: string;
  sentAt: string;
  recipient: string | null;
  outcome: MonitorDigestRunOutcome;
  newCount: number;
  resolvedCount: number;
  clientCount: number;
  error: string | null;
}

/**
 * Record what a digest tick did for this workspace and week. `INSERT OR IGNORE`
 * on the UNIQUE (workspace_id, period_start) key is the idempotency backstop: a
 * retry or an overlapping tick that computed the same period cannot write — and
 * therefore cannot re-send — the same week twice.
 */
export async function recordMonitorDigestRun(
  t: TenantScope,
  input: MonitorDigestRunInput,
): Promise<void> {
  await t.db
    .prepare(
      `INSERT OR IGNORE INTO monitor_digest_runs
         (workspace_id, period_start, period_end, sent_at, recipient, outcome,
          new_count, resolved_count, client_count, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      t.workspaceId,
      input.periodStart,
      input.periodEnd,
      input.sentAt,
      input.recipient,
      input.outcome,
      input.newCount,
      input.resolvedCount,
      input.clientCount,
      input.error ?? null,
    )
    .run();
}

export async function listMonitorDigestRuns(
  t: TenantScope,
  input: { limit?: number } = {},
): Promise<MonitorDigestRunRecord[]> {
  const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 10)));
  const rows = await t.db
    .prepare(
      `SELECT period_start, period_end, sent_at, recipient, outcome,
              new_count, resolved_count, client_count, error
       FROM monitor_digest_runs
       WHERE workspace_id = ?
       ORDER BY sent_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(t.workspaceId, limit)
    .all<{
      period_start: string;
      period_end: string;
      sent_at: string;
      recipient: string | null;
      outcome: string;
      new_count: number;
      resolved_count: number;
      client_count: number;
      error: string | null;
    }>();
  return rows.map((row) => ({
    periodStart: row.period_start,
    periodEnd: row.period_end,
    sentAt: row.sent_at,
    recipient: row.recipient ?? null,
    outcome: row.outcome as MonitorDigestRunOutcome,
    newCount: Number(row.new_count) || 0,
    resolvedCount: Number(row.resolved_count) || 0,
    clientCount: Number(row.client_count) || 0,
    error: row.error ?? null,
  }));
}

// ---------------------------------------------------------------------------
// scheduler-facing (pre-workspace) queries
// ---------------------------------------------------------------------------

export interface DueDigestWorkspace {
  workspaceId: string;
  name: string;
  ownerUserId: string;
  ownerEmail: string | null;
  recipient: string | null;
  onlyOnChange: boolean;
  lastSentAt: string | null;
}

/**
 * Workspaces whose weekly digest is due, oldest-due (and never-sent) first,
 * capped. Excludes `[TEST]` workspaces and any currently claimed by a live tick
 * (a claim older than the TTL is treated as abandoned). The owner email is
 * joined in so the tick can evaluate MONITOR entitlement without a second read.
 */
export async function listWorkspacesDueForDigest(
  db: SqlDb,
  input: { now: Date; limit: number },
): Promise<DueDigestWorkspace[]> {
  const now = input.now.toISOString();
  const staleBefore = new Date(input.now.getTime() - MONITOR_DIGEST_CLAIM_TTL_MS).toISOString();
  const rows = await db
    .prepare(
      `SELECT w.id AS id, w.name AS name, w.owner_user_id AS owner_user_id,
              u.email AS owner_email, w.monitor_digest_recipient AS recipient,
              w.monitor_digest_only_on_change AS only_on_change,
              w.monitor_digest_last_sent_at AS last_sent_at
       FROM workspaces w
       LEFT JOIN "user" u ON u.id = w.owner_user_id
       WHERE w.monitor_digest_cadence = 'weekly'
         AND w.name NOT LIKE '[TEST] %'
         AND (w.monitor_digest_next_due_at IS NULL OR w.monitor_digest_next_due_at <= ?)
         AND (w.monitor_digest_claimed_at IS NULL OR w.monitor_digest_claimed_at <= ?)
       ORDER BY (w.monitor_digest_next_due_at IS NULL) DESC,
                w.monitor_digest_next_due_at ASC, w.id ASC
       LIMIT ?`,
    )
    .bind(now, staleBefore, Math.max(0, Math.floor(input.limit)))
    .all<{
      id: string;
      name: string;
      owner_user_id: string;
      owner_email: string | null;
      recipient: string | null;
      only_on_change: number;
      last_sent_at: string | null;
    }>();

  return rows.map((row) => ({
    workspaceId: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    ownerEmail: row.owner_email ?? null,
    recipient: row.recipient ?? null,
    onlyOnChange: row.only_on_change !== 0,
    lastSentAt: row.last_sent_at ?? null,
  }));
}

/**
 * Take exclusive ownership of a workspace's digest for one tick. A single
 * conditional UPDATE, like the monitoring claim: two overlapping ticks racing on
 * the same workspace both run this and exactly one reports a row changed.
 */
export async function claimWorkspaceDigest(
  db: SqlDb,
  workspaceId: string,
  now: Date,
): Promise<boolean> {
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - MONITOR_DIGEST_CLAIM_TTL_MS).toISOString();
  const result = await db
    .prepare(
      `UPDATE workspaces SET monitor_digest_claimed_at = ?
       WHERE id = ?
         AND monitor_digest_cadence = 'weekly'
         AND name NOT LIKE '[TEST] %'
         AND (monitor_digest_next_due_at IS NULL OR monitor_digest_next_due_at <= ?)
         AND (monitor_digest_claimed_at IS NULL OR monitor_digest_claimed_at <= ?)`,
    )
    .bind(nowIso, workspaceId, nowIso, staleBefore)
    .run();
  return result.rowsAffected > 0;
}

/**
 * Release the claim and schedule the next digest. `next_due` always advances by
 * one cadence — a skipped or failed digest waits a full week rather than being
 * retried every daily tick — and `last_sent_at` moves only on an actual send.
 * The guard re-checks the cadence so a person turning the digest off mid-tick
 * wins; if it changed, only the claim is released.
 */
export async function finishWorkspaceDigest(
  db: SqlDb,
  workspaceId: string,
  input: { now: Date; sent: boolean },
): Promise<void> {
  const now = input.now.toISOString();
  const nextDue = new Date(input.now.getTime() + MONITOR_DIGEST_INTERVAL_MS.weekly).toISOString();
  const updated = await db
    .prepare(
      `UPDATE workspaces SET
         monitor_digest_claimed_at = NULL,
         monitor_digest_next_due_at = ?,
         monitor_digest_last_sent_at = CASE WHEN ? = 1 THEN ? ELSE monitor_digest_last_sent_at END
       WHERE id = ? AND monitor_digest_cadence = 'weekly'`,
    )
    .bind(nextDue, input.sent ? 1 : 0, now, workspaceId)
    .run();

  if (updated.rowsAffected === 0) {
    // Cadence changed under us (turned off). Release the claim, leave the
    // schedule the person just chose alone.
    await db
      .prepare(`UPDATE workspaces SET monitor_digest_claimed_at = NULL WHERE id = ?`)
      .bind(workspaceId)
      .run();
  }
}
