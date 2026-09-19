// src/db/analysisLifecycle.ts
var ABANDONED_ANALYSIS_AFTER_MS = 3 * 60 * 1e3;
function knownStage(value) {
  return ANALYSIS_STAGES.includes(value) ? value : "queued";
}
__name(knownStage, "knownStage");
function knownFailureCode(value) {
  return value && ANALYSIS_FAILURE_CODES.includes(value) ? value : null;
}
__name(knownFailureCode, "knownFailureCode");
function toLifecycle(row) {
  return {
    reservationId: Number(row.id),
    clientId: row.client_id,
    reservedAt: row.reserved_at,
    stage: knownStage(row.stage),
    stageUpdatedAt: row.stage_updated_at ?? row.reserved_at,
    finishedAt: row.finished_at,
    failed: row.failed === 1,
    failureCode: knownFailureCode(row.failure_code),
    failureMessage: row.failure_message ?? "",
    analysisRunId: row.analysis_run_id === null ? null : Number(row.analysis_run_id)
  };
}
__name(toLifecycle, "toLifecycle");
async function readAnalysisLifecycle(t, reservationId3) {
  const row = await t.db.prepare(
    `SELECT id, client_id, reserved_at, stage, stage_updated_at, finished_at,
              failed, failure_code, failure_message, analysis_run_id
       FROM analysis_limit_reservations
       WHERE id = ? AND workspace_id = ?`
  ).bind(reservationId3, t.workspaceId).first();
  return row ? toLifecycle(row) : null;
}
__name(readAnalysisLifecycle, "readAnalysisLifecycle");
function safeFailureMessage(value) {
  if (!value) return null;
  const compact4 = value.replace(/\s+/g, " ").trim();
  return compact4 ? compact4.slice(0, 500) : null;
}
__name(safeFailureMessage, "safeFailureMessage");
async function advanceAnalysisLifecycle(t, input) {
  const current = await readAnalysisLifecycle(t, input.reservationId);
  if (!current) return false;
  if (current.stage === input.stage && isTerminalAnalysisStage(current.stage)) {
    return true;
  }
  if (!canTransitionAnalysisStage(current.stage, input.stage)) {
    if (isTerminalAnalysisStage(current.stage)) {
      throw new RangeError(`Analysis lifecycle is terminal at ${current.stage}.`);
    }
    throw new RangeError(
      `Cannot move analysis lifecycle from ${current.stage} to ${input.stage}.`
    );
  }
  const at = input.at ?? /* @__PURE__ */ new Date();
  if (!Number.isFinite(at.getTime())) throw new RangeError("at must be a valid date");
  const stamp = at.toISOString();
  const terminal = isTerminalAnalysisStage(input.stage);
  const failed = ["failed", "unavailable", "blocked"].includes(input.stage) ? 1 : 0;
  const result = await t.db.prepare(
    `UPDATE analysis_limit_reservations
       SET stage = ?, stage_updated_at = ?,
           finished_at = CASE WHEN ? = 1 THEN ? ELSE finished_at END,
           failed = CASE WHEN ? = 1 THEN ? ELSE failed END,
           failure_code = CASE WHEN ? = 1 THEN ? ELSE failure_code END,
           failure_message = CASE WHEN ? = 1 THEN ? ELSE failure_message END,
           analysis_run_id = COALESCE(?, analysis_run_id)
       WHERE id = ? AND workspace_id = ?
         AND stage = ?
         AND COALESCE(stage_updated_at, reserved_at) = ?`
  ).bind(
    input.stage,
    stamp,
    terminal ? 1 : 0,
    stamp,
    terminal ? 1 : 0,
    failed,
    terminal ? 1 : 0,
    input.failureCode ?? null,
    terminal ? 1 : 0,
    safeFailureMessage(input.failureMessage),
    input.analysisRunId ?? null,
    input.reservationId,
    t.workspaceId,
    current.stage,
    current.stageUpdatedAt
  ).run();
  if (result.rowsAffected > 0) return true;
  const latest = await readAnalysisLifecycle(t, input.reservationId);
  if (!latest) return false;
  if (latest.stage === input.stage) return true;
  if (isTerminalAnalysisStage(latest.stage)) {
    throw new RangeError(`Analysis lifecycle is terminal at ${latest.stage}.`);
  }
  throw new RangeError(
    `Analysis lifecycle transition lost a race while moving from ${current.stage} to ${input.stage}; current stage is ${latest.stage}.`
  );
}
__name(advanceAnalysisLifecycle, "advanceAnalysisLifecycle");
