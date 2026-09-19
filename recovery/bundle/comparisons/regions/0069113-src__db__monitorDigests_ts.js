// src/db/monitorDigests.ts
var OPEN_STATUSES = ["new", "accepted", "proposal_prepared", "pitched"];
async function collectDigestFacts(t, input) {
  const nowIso2 = (input.now ?? /* @__PURE__ */ new Date()).toISOString();
  const workspace = await t.db.prepare(`SELECT name FROM workspaces WHERE id = ?`).bind(t.workspaceId).first();
  const clientRows = await t.db.prepare(
    `SELECT id, name, domain, average_job_value
       FROM clients
       WHERE workspace_id = ? AND monitoring_cadence != 'off'`
  ).bind(t.workspaceId).all();
  const monitored = new Map(clientRows.map((c) => [c.id, c]));
  const aggregates = await t.db.prepare(
    `SELECT client_id,
              SUM(new_count) AS new_count,
              SUM(resolved_count) AS resolved_count
       FROM analysis_runs
       WHERE workspace_id = ? AND trigger = 'scheduled'
         AND finished_at >= ? AND finished_at < ?
       GROUP BY client_id`
  ).bind(t.workspaceId, input.since, input.until).all();
  const latest = await t.db.prepare(
    `SELECT r.client_id AS client_id, r.outcome AS outcome
       FROM analysis_runs r
       JOIN (
         SELECT client_id, MAX(finished_at) AS mx
         FROM analysis_runs
         WHERE workspace_id = ? AND trigger = 'scheduled'
           AND finished_at >= ? AND finished_at < ?
         GROUP BY client_id
       ) m ON m.client_id = r.client_id AND m.mx = r.finished_at
       WHERE r.workspace_id = ? AND r.trigger = 'scheduled'`
  ).bind(t.workspaceId, input.since, input.until, t.workspaceId).all();
  const latestOutcome = new Map(latest.map((r) => [r.client_id, r.outcome]));
  const openRows = await t.db.prepare(
    `SELECT id, client_id, title, price_min, price_max
       FROM opportunities
       WHERE workspace_id = ?
         AND billable_status = 'billable'
         AND (
           status IN (${OPEN_STATUSES.map(() => "?").join(", ")})
           OR (status = 'snoozed' AND snooze_until IS NOT NULL AND snooze_until <= ?)
         )
       ORDER BY price_max DESC, id ASC`
  ).bind(t.workspaceId, ...OPEN_STATUSES, nowIso2).all();
  const openByClient = /* @__PURE__ */ new Map();
  for (const row of openRows) {
    const entry2 = openByClient.get(row.client_id) ?? { count: 0, priceMin: 0, priceMax: 0, top: null };
    entry2.count += 1;
    entry2.priceMin += row.price_min;
    entry2.priceMax += row.price_max;
    if (!entry2.top) {
      entry2.top = { id: row.id, title: row.title, priceMin: row.price_min, priceMax: row.price_max };
    }
    openByClient.set(row.client_id, entry2);
  }
  const clients = [];
  for (const agg of aggregates) {
    const client = monitored.get(agg.client_id);
    if (!client) continue;
    const open2 = openByClient.get(agg.client_id);
    const outcome = latestOutcome.get(agg.client_id);
    clients.push({
      clientId: client.id,
      clientName: client.name,
      domain: client.domain,
      newCount: Number(agg.new_count ?? 0) || 0,
      resolvedCount: Number(agg.resolved_count ?? 0) || 0,
      couldNotRead: outcome === "inconclusive",
      latestOutcome: outcome ?? null,
      openCount: open2?.count ?? 0,
      openPriceMin: open2?.priceMin ?? 0,
      openPriceMax: open2?.priceMax ?? 0,
      topOpportunity: open2?.top ?? null,
      averageJobValue: client.average_job_value ?? null
    });
  }
  return {
    workspaceName: workspace?.name ?? "Your agency",
    period: { since: input.since, until: input.until },
    monitoredClients: monitored.size,
    clients
  };
}
__name(collectDigestFacts, "collectDigestFacts");
async function recordMonitorDigestRun(t, input) {
  await t.db.prepare(
    `INSERT OR IGNORE INTO monitor_digest_runs
         (workspace_id, period_start, period_end, sent_at, recipient, outcome,
          new_count, resolved_count, client_count, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    t.workspaceId,
    input.periodStart,
    input.periodEnd,
    input.sentAt,
    input.recipient,
    input.outcome,
    input.newCount,
    input.resolvedCount,
    input.clientCount,
    input.error ?? null
  ).run();
}
__name(recordMonitorDigestRun, "recordMonitorDigestRun");
async function listWorkspacesDueForDigest(db, input) {
  const now2 = input.now.toISOString();
  const staleBefore = new Date(input.now.getTime() - MONITOR_DIGEST_CLAIM_TTL_MS).toISOString();
  const rows = await db.prepare(
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
       LIMIT ?`
  ).bind(now2, staleBefore, Math.max(0, Math.floor(input.limit))).all();
  return rows.map((row) => ({
    workspaceId: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    ownerEmail: row.owner_email ?? null,
    recipient: row.recipient ?? null,
    onlyOnChange: row.only_on_change !== 0,
    lastSentAt: row.last_sent_at ?? null
  }));
}
__name(listWorkspacesDueForDigest, "listWorkspacesDueForDigest");
async function claimWorkspaceDigest(db, workspaceId, now2) {
  const nowIso2 = now2.toISOString();
  const staleBefore = new Date(now2.getTime() - MONITOR_DIGEST_CLAIM_TTL_MS).toISOString();
  const result = await db.prepare(
    `UPDATE workspaces SET monitor_digest_claimed_at = ?
       WHERE id = ?
         AND monitor_digest_cadence = 'weekly'
         AND name NOT LIKE '[TEST] %'
         AND (monitor_digest_next_due_at IS NULL OR monitor_digest_next_due_at <= ?)
         AND (monitor_digest_claimed_at IS NULL OR monitor_digest_claimed_at <= ?)`
  ).bind(nowIso2, workspaceId, nowIso2, staleBefore).run();
  return result.rowsAffected > 0;
}
__name(claimWorkspaceDigest, "claimWorkspaceDigest");
async function finishWorkspaceDigest(db, workspaceId, input) {
  const now2 = input.now.toISOString();
  const nextDue = new Date(input.now.getTime() + MONITOR_DIGEST_INTERVAL_MS.weekly).toISOString();
  const updated = await db.prepare(
    `UPDATE workspaces SET
         monitor_digest_claimed_at = NULL,
         monitor_digest_next_due_at = ?,
         monitor_digest_last_sent_at = CASE WHEN ? = 1 THEN ? ELSE monitor_digest_last_sent_at END
       WHERE id = ? AND monitor_digest_cadence = 'weekly'`
  ).bind(nextDue, input.sent ? 1 : 0, now2, workspaceId).run();
  if (updated.rowsAffected === 0) {
    await db.prepare(`UPDATE workspaces SET monitor_digest_claimed_at = NULL WHERE id = ?`).bind(workspaceId).run();
  }
}
__name(finishWorkspaceDigest, "finishWorkspaceDigest");
