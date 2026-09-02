import {
  MONITORING_CLAIM_TTL_MS,
  MONITORING_OFF,
  isMonitoringCadence,
  isMonitoringOutcome,
  nextDueAfterRun,
  stateForCadenceChange,
  type MonitoringCadence,
  type MonitoringOutcome,
  type MonitoringState,
} from "@/core/monitoring";
import type { SqlDb } from "@/db/sql";
import type { TenantScope } from "@/db/tenant";

/**
 * Storage for recurring monitoring.
 *
 * Almost everything here is tenant-scoped like the rest of the repositories.
 * The two exceptions are `listDueClients` and `claimClient`, which the scheduler
 * needs BEFORE a workspace is known — there is no session behind a cron tick, so
 * the workspace has to come out of the row itself. Both return / require the
 * workspace id explicitly, and every subsequent read and write the scheduler
 * performs goes through a normal `TenantScope` built from it. No query in this
 * file mutates rows across more than one workspace.
 */

interface MonitoringRow {
  monitoring_cadence: string;
  monitoring_next_due_at: string | null;
  monitoring_last_attempt_at: string | null;
  monitoring_last_success_at: string | null;
  monitoring_last_outcome: string | null;
  monitoring_consecutive_failures: number;
  monitoring_claimed_at: string | null;
}

const MONITORING_COLUMNS = `monitoring_cadence, monitoring_next_due_at, monitoring_last_attempt_at,
       monitoring_last_success_at, monitoring_last_outcome, monitoring_consecutive_failures,
       monitoring_claimed_at`;

/**
 * An unrecognised cadence or outcome (a value written by a newer deploy, or a
 * hand-edited row) reads as "off" / unknown rather than throwing. Monitoring
 * failing closed means not scanning, never crashing a page render.
 */
export function toMonitoringState(row: MonitoringRow): MonitoringState {
  const cadence: MonitoringCadence = isMonitoringCadence(row.monitoring_cadence)
    ? row.monitoring_cadence
    : "off";
  return {
    cadence,
    nextDueAt: cadence === "off" ? null : row.monitoring_next_due_at,
    lastAttemptAt: row.monitoring_last_attempt_at,
    lastSuccessAt: row.monitoring_last_success_at,
    lastOutcome: isMonitoringOutcome(row.monitoring_last_outcome)
      ? row.monitoring_last_outcome
      : null,
    consecutiveFailures: Number(row.monitoring_consecutive_failures) || 0,
    claimedAt: row.monitoring_claimed_at,
  };
}

export async function getMonitoring(
  t: TenantScope,
  clientId: string,
): Promise<MonitoringState | null> {
  const row = await t.db
    .prepare(`SELECT ${MONITORING_COLUMNS} FROM clients WHERE id = ? AND workspace_id = ?`)
    .bind(clientId, t.workspaceId)
    .first<MonitoringRow>();
  return row ? toMonitoringState(row) : null;
}

/** Monitoring state for every client in the workspace, in one query. */
export async function listMonitoringByClient(
  t: TenantScope,
): Promise<Map<string, MonitoringState>> {
  const rows = await t.db
    .prepare(`SELECT id, ${MONITORING_COLUMNS} FROM clients WHERE workspace_id = ?`)
    .bind(t.workspaceId)
    .all<MonitoringRow & { id: string }>();
  return new Map(rows.map((row) => [row.id, toMonitoringState(row)]));
}

/**
 * Turn monitoring on, off, or change its cadence. Returns the stored state, or
 * null when the client is not in this workspace.
 *
 * This is the ONLY way monitoring is ever enabled. Nothing in the scheduler
 * calls it.
 */
export async function setMonitoringCadence(
  t: TenantScope,
  clientId: string,
  cadence: MonitoringCadence,
  input: { lastAnalyzedAt: string | null; now?: Date },
): Promise<MonitoringState | null> {
  const current = await getMonitoring(t, clientId);
  if (!current) return null;

  const next = stateForCadenceChange({
    current,
    cadence,
    lastAnalyzedAt: input.lastAnalyzedAt,
    now: input.now ?? new Date(),
  });

  await t.db
    .prepare(
      `UPDATE clients SET
         monitoring_cadence = ?, monitoring_next_due_at = ?,
         monitoring_consecutive_failures = ?, monitoring_claimed_at = NULL
       WHERE id = ? AND workspace_id = ?`,
    )
    .bind(next.cadence, next.nextDueAt, next.consecutiveFailures, clientId, t.workspaceId)
    .run();

  return next;
}

// ---------------------------------------------------------------------------
// scheduler-facing (pre-workspace) queries
// ---------------------------------------------------------------------------

/** A client the scheduler may consider, with the workspace it belongs to. */
export interface DueClient {
  clientId: string;
  workspaceId: string;
  cadence: MonitoringCadence;
  nextDueAt: string;
}

/**
 * Monitored clients whose next scan is due, oldest-due first, capped.
 *
 * The cap is the point: a tick reads a bounded candidate list rather than the
 * portfolio. Clients currently claimed by a live invocation are excluded, and a
 * claim older than the TTL is treated as abandoned so an interrupted run cannot
 * strand a client permanently.
 */
export async function listDueClients(
  db: SqlDb,
  input: { now: Date; limit: number },
): Promise<DueClient[]> {
  const now = input.now.toISOString();
  const staleBefore = new Date(input.now.getTime() - MONITORING_CLAIM_TTL_MS).toISOString();
  const rows = await db
    .prepare(
      `SELECT id, workspace_id, monitoring_cadence, monitoring_next_due_at
       FROM clients
       WHERE monitoring_cadence != 'off'
         AND monitoring_next_due_at IS NOT NULL
         AND monitoring_next_due_at <= ?
         AND (monitoring_claimed_at IS NULL OR monitoring_claimed_at <= ?)
       ORDER BY monitoring_next_due_at ASC, id ASC
       LIMIT ?`,
    )
    .bind(now, staleBefore, Math.max(0, Math.floor(input.limit)))
    .all<{
      id: string;
      workspace_id: string;
      monitoring_cadence: string;
      monitoring_next_due_at: string;
    }>();

  return rows
    .filter((row) => isMonitoringCadence(row.monitoring_cadence) && row.monitoring_cadence !== "off")
    .map((row) => ({
      clientId: row.id,
      workspaceId: row.workspace_id,
      cadence: row.monitoring_cadence as MonitoringCadence,
      nextDueAt: row.monitoring_next_due_at,
    }));
}

/**
 * Take exclusive ownership of a client for one scan. Returns false when someone
 * else already holds it, when it stopped being due, when monitoring was turned
 * off since selection, or when the client no longer exists.
 *
 * This is a single conditional UPDATE on purpose. D1 has no interactive
 * transaction across awaits, so the claim has to be the atomic step — two
 * concurrent scheduler invocations racing on the same row will both run this
 * statement and exactly one will report a row changed.
 */
export async function claimClient(
  db: SqlDb,
  target: { clientId: string; workspaceId: string },
  now: Date,
): Promise<boolean> {
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - MONITORING_CLAIM_TTL_MS).toISOString();
  const result = await db
    .prepare(
      `UPDATE clients
         SET monitoring_claimed_at = ?, monitoring_last_attempt_at = ?
       WHERE id = ? AND workspace_id = ?
         AND monitoring_cadence != 'off'
         AND monitoring_next_due_at IS NOT NULL
         AND monitoring_next_due_at <= ?
         AND (monitoring_claimed_at IS NULL OR monitoring_claimed_at <= ?)`,
    )
    .bind(nowIso, nowIso, target.clientId, target.workspaceId, nowIso, staleBefore)
    .run();
  return result.rowsAffected > 0;
}

/**
 * Record the result of a scheduled scan and schedule the next one.
 *
 * Re-reads the cadence first because a person may have changed or disabled
 * monitoring while the scan was running; their choice wins. The guarded UPDATE
 * closes the remaining window — if the cadence changed between the read and the
 * write, the scheduling fields are left alone and only the claim is released, so
 * a finished scan can never resurrect monitoring the agency just turned off.
 */
export async function finishMonitoringRun(
  t: TenantScope,
  clientId: string,
  input: { outcome: MonitoringOutcome; now?: Date },
): Promise<MonitoringState | null> {
  const now = input.now ?? new Date();
  const current = await getMonitoring(t, clientId);
  if (!current) return null; // deleted mid-run: nothing to release

  const consecutiveFailures =
    input.outcome === "failed" ? current.consecutiveFailures + 1 : 0;
  const next: MonitoringState = {
    ...current,
    lastOutcome: input.outcome,
    lastSuccessAt:
      input.outcome === "failed" ? current.lastSuccessAt : now.toISOString(),
    consecutiveFailures,
    claimedAt: null,
    nextDueAt: nextDueAfterRun({
      cadence: current.cadence,
      outcome: input.outcome,
      consecutiveFailures,
      now,
    }),
  };

  const updated = await t.db
    .prepare(
      `UPDATE clients SET
         monitoring_claimed_at = NULL,
         monitoring_last_outcome = ?,
         monitoring_last_success_at = ?,
         monitoring_consecutive_failures = ?,
         monitoring_next_due_at = ?
       WHERE id = ? AND workspace_id = ? AND monitoring_cadence = ?`,
    )
    .bind(
      next.lastOutcome,
      next.lastSuccessAt,
      next.consecutiveFailures,
      next.nextDueAt,
      clientId,
      t.workspaceId,
      current.cadence,
    )
    .run();

  if (updated.rowsAffected > 0) return next;

  // The cadence changed under us. Release the claim and record the outcome, but
  // do not touch the schedule the person just chose.
  await t.db
    .prepare(
      `UPDATE clients SET
         monitoring_claimed_at = NULL,
         monitoring_last_outcome = ?,
         monitoring_last_success_at = ?
       WHERE id = ? AND workspace_id = ?`,
    )
    .bind(next.lastOutcome, next.lastSuccessAt, clientId, t.workspaceId)
    .run();
  return getMonitoring(t, clientId);
}

/** Release a claim without recording an outcome (used when a scan never started). */
export async function releaseClaim(t: TenantScope, clientId: string): Promise<void> {
  await t.db
    .prepare(
      "UPDATE clients SET monitoring_claimed_at = NULL WHERE id = ? AND workspace_id = ?",
    )
    .bind(clientId, t.workspaceId)
    .run();
}

// ---------------------------------------------------------------------------
// portfolio + health
// ---------------------------------------------------------------------------

export interface MonitoringPortfolio {
  /** Clients with monitoring enabled. */
  monitored: number;
  /** Monitored clients whose next scan is already due. */
  due: number;
  /** Monitored clients whose most recent scheduled scan did not conclude. */
  unhealthy: number;
}

export function summarizePortfolio(
  states: Iterable<MonitoringState>,
  now = new Date(),
): MonitoringPortfolio {
  const summary: MonitoringPortfolio = { monitored: 0, due: 0, unhealthy: 0 };
  const nowIso = now.toISOString();
  for (const state of states) {
    if (state.cadence === "off") continue;
    summary.monitored++;
    if (state.nextDueAt && state.nextDueAt <= nowIso) summary.due++;
    if (state.lastOutcome === "failed" || state.lastOutcome === "inconclusive") {
      summary.unhealthy++;
    }
  }
  return summary;
}

/**
 * Aggregate health of scheduled scans in a period.
 *
 * `rejected` and `errors` are the two numbers that tell an operator whether the
 * evaluator is behaving: a rejection is the commercial gate doing its job, an
 * error is the provider failing. They are deliberately kept apart.
 */
export interface MonitoringHealth {
  runs: number;
  findings: number;
  clean: number;
  inconclusive: number;
  newFindings: number;
  resolvedFindings: number;
  evaluatorCalls: number;
  evaluatorRejections: number;
  evaluatorErrors: number;
}

export async function scheduledRunHealth(
  t: TenantScope,
  input: { since: string },
): Promise<MonitoringHealth> {
  const row = await t.db
    .prepare(
      `SELECT
         COUNT(*) AS runs,
         SUM(CASE WHEN outcome = 'findings' THEN 1 ELSE 0 END) AS findings,
         SUM(CASE WHEN outcome = 'clean' THEN 1 ELSE 0 END) AS clean,
         SUM(CASE WHEN outcome = 'inconclusive' THEN 1 ELSE 0 END) AS inconclusive,
         SUM(new_count) AS new_findings,
         SUM(resolved_count) AS resolved_findings,
         SUM(evaluator_calls) AS evaluator_calls,
         SUM(evaluator_rejections) AS evaluator_rejections,
         SUM(evaluator_errors) AS evaluator_errors
       FROM analysis_runs
       WHERE workspace_id = ? AND trigger = 'scheduled' AND finished_at >= ?`,
    )
    .bind(t.workspaceId, input.since)
    .first<Record<string, number | null>>();

  const n = (key: string) => Number(row?.[key] ?? 0) || 0;
  return {
    runs: n("runs"),
    findings: n("findings"),
    clean: n("clean"),
    inconclusive: n("inconclusive"),
    newFindings: n("new_findings"),
    resolvedFindings: n("resolved_findings"),
    evaluatorCalls: n("evaluator_calls"),
    evaluatorRejections: n("evaluator_rejections"),
    evaluatorErrors: n("evaluator_errors"),
  };
}

export { MONITORING_OFF };
