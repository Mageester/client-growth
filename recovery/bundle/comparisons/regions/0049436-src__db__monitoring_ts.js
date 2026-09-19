// src/db/monitoring.ts
var MONITORING_COLUMNS = `monitoring_cadence, monitoring_next_due_at, monitoring_last_attempt_at,
       monitoring_last_success_at, monitoring_last_outcome, monitoring_consecutive_failures,
       monitoring_claimed_at`;
function toMonitoringState(row) {
  const cadence = isMonitoringCadence(row.monitoring_cadence) ? row.monitoring_cadence : "off";
  return {
    cadence,
    nextDueAt: cadence === "off" ? null : row.monitoring_next_due_at,
    lastAttemptAt: row.monitoring_last_attempt_at,
    lastSuccessAt: row.monitoring_last_success_at,
    lastOutcome: isMonitoringOutcome(row.monitoring_last_outcome) ? row.monitoring_last_outcome : null,
    consecutiveFailures: Number(row.monitoring_consecutive_failures) || 0,
    claimedAt: row.monitoring_claimed_at
  };
}
__name(toMonitoringState, "toMonitoringState");
async function getMonitoring(t, clientId2) {
  const row = await t.db.prepare(`SELECT ${MONITORING_COLUMNS} FROM clients WHERE id = ? AND workspace_id = ?`).bind(clientId2, t.workspaceId).first();
  return row ? toMonitoringState(row) : null;
}
__name(getMonitoring, "getMonitoring");
async function listDueClients(db, input) {
  const now2 = input.now.toISOString();
  const staleBefore = new Date(input.now.getTime() - MONITORING_CLAIM_TTL_MS).toISOString();
  const rows = await db.prepare(
    `SELECT id, workspace_id, monitoring_cadence, monitoring_next_due_at
       FROM clients
       WHERE monitoring_cadence != 'off'
         AND workspace_id NOT IN (SELECT id FROM workspaces WHERE name LIKE '[TEST] %')
         AND monitoring_next_due_at IS NOT NULL
         AND monitoring_next_due_at <= ?
         AND (monitoring_claimed_at IS NULL OR monitoring_claimed_at <= ?)
       ORDER BY monitoring_next_due_at ASC, id ASC
       LIMIT ?`
  ).bind(now2, staleBefore, Math.max(0, Math.floor(input.limit))).all();
  return rows.filter((row) => isMonitoringCadence(row.monitoring_cadence) && row.monitoring_cadence !== "off").map((row) => ({
    clientId: row.id,
    workspaceId: row.workspace_id,
    cadence: row.monitoring_cadence,
    nextDueAt: row.monitoring_next_due_at
  }));
}
__name(listDueClients, "listDueClients");
async function claimClient(db, target, now2) {
  const nowIso2 = now2.toISOString();
  const staleBefore = new Date(now2.getTime() - MONITORING_CLAIM_TTL_MS).toISOString();
  const result = await db.prepare(
    `UPDATE clients
         SET monitoring_claimed_at = ?, monitoring_last_attempt_at = ?
       WHERE id = ? AND workspace_id = ?
         AND monitoring_cadence != 'off'
         AND workspace_id NOT IN (SELECT id FROM workspaces WHERE name LIKE '[TEST] %')
         AND monitoring_next_due_at IS NOT NULL
         AND monitoring_next_due_at <= ?
         AND (monitoring_claimed_at IS NULL OR monitoring_claimed_at <= ?)`
  ).bind(nowIso2, nowIso2, target.clientId, target.workspaceId, nowIso2, staleBefore).run();
  return result.rowsAffected > 0;
}
__name(claimClient, "claimClient");
async function finishMonitoringRun(t, clientId2, input) {
  const now2 = input.now ?? /* @__PURE__ */ new Date();
  const current = await getMonitoring(t, clientId2);
  if (!current) return null;
  const consecutiveFailures = input.outcome === "failed" ? current.consecutiveFailures + 1 : 0;
  const next = {
    ...current,
    lastOutcome: input.outcome,
    lastSuccessAt: input.outcome === "failed" ? current.lastSuccessAt : now2.toISOString(),
    consecutiveFailures,
    claimedAt: null,
    nextDueAt: nextDueAfterRun({
      cadence: current.cadence,
      outcome: input.outcome,
      consecutiveFailures,
      now: now2
    })
  };
  const updated = await t.db.prepare(
    `UPDATE clients SET
         monitoring_claimed_at = NULL,
         monitoring_last_outcome = ?,
         monitoring_last_success_at = ?,
         monitoring_consecutive_failures = ?,
         monitoring_next_due_at = ?
       WHERE id = ? AND workspace_id = ? AND monitoring_cadence = ?`
  ).bind(
    next.lastOutcome,
    next.lastSuccessAt,
    next.consecutiveFailures,
    next.nextDueAt,
    clientId2,
    t.workspaceId,
    current.cadence
  ).run();
  if (updated.rowsAffected > 0) return next;
  await t.db.prepare(
    `UPDATE clients SET
         monitoring_claimed_at = NULL,
         monitoring_last_outcome = ?,
         monitoring_last_success_at = ?
       WHERE id = ? AND workspace_id = ?`
  ).bind(next.lastOutcome, next.lastSuccessAt, clientId2, t.workspaceId).run();
  return getMonitoring(t, clientId2);
}
__name(finishMonitoringRun, "finishMonitoringRun");
