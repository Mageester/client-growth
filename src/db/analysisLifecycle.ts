import {
  ANALYSIS_FAILURE_CODES,
  ANALYSIS_STAGES,
  canTransitionAnalysisStage,
  isTerminalAnalysisStage,
  type AnalysisFailureCode,
  type AnalysisStage,
} from "@/core/analysisLifecycle";
import type { TenantScope } from "@/db/tenant";

export const ABANDONED_ANALYSIS_AFTER_MS = 3 * 60 * 1_000;

export interface AnalysisLifecycle {
  reservationId: number;
  clientId: string;
  reservedAt: string;
  stage: AnalysisStage;
  stageUpdatedAt: string;
  finishedAt: string | null;
  failed: boolean;
  failureCode: AnalysisFailureCode | null;
  failureMessage: string;
  analysisRunId: number | null;
}

interface AnalysisLifecycleRow {
  id: number;
  client_id: string;
  reserved_at: string;
  stage: string;
  stage_updated_at: string | null;
  finished_at: string | null;
  failed: number;
  failure_code: string | null;
  failure_message: string | null;
  analysis_run_id: number | null;
}

function knownStage(value: string): AnalysisStage {
  return (ANALYSIS_STAGES as readonly string[]).includes(value) ? value as AnalysisStage : "queued";
}

function knownFailureCode(value: string | null): AnalysisFailureCode | null {
  return value && (ANALYSIS_FAILURE_CODES as readonly string[]).includes(value)
    ? value as AnalysisFailureCode
    : null;
}

function toLifecycle(row: AnalysisLifecycleRow): AnalysisLifecycle {
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
    analysisRunId: row.analysis_run_id === null ? null : Number(row.analysis_run_id),
  };
}

export async function readAnalysisLifecycle(
  t: TenantScope,
  reservationId: number,
): Promise<AnalysisLifecycle | null> {
  const row = await t.db.prepare(
    `SELECT id, client_id, reserved_at, stage, stage_updated_at, finished_at,
              failed, failure_code, failure_message, analysis_run_id
       FROM analysis_limit_reservations
       WHERE id = ? AND workspace_id = ?`,
  ).bind(reservationId, t.workspaceId).first<AnalysisLifecycleRow>();
  return row ? toLifecycle(row) : null;
}

function safeFailureMessage(value: string | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 500) : null;
}

export interface AdvanceAnalysisLifecycleInput {
  reservationId: number;
  stage: AnalysisStage;
  at?: Date;
  failureCode?: AnalysisFailureCode | null;
  failureMessage?: string;
  analysisRunId?: number | null;
}

export async function advanceAnalysisLifecycle(
  t: TenantScope,
  input: AdvanceAnalysisLifecycleInput,
): Promise<boolean> {
  const current = await readAnalysisLifecycle(t, input.reservationId);
  if (!current) return false;
  if (current.stage === input.stage && isTerminalAnalysisStage(current.stage)) return true;
  if (!canTransitionAnalysisStage(current.stage, input.stage)) {
    if (isTerminalAnalysisStage(current.stage)) throw new RangeError(`Analysis lifecycle is terminal at ${current.stage}.`);
    throw new RangeError(`Cannot move analysis lifecycle from ${current.stage} to ${input.stage}.`);
  }
  const at = input.at ?? new Date();
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
         AND COALESCE(stage_updated_at, reserved_at) = ?`,
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
    current.stageUpdatedAt,
  ).run();
  if (result.rowsAffected > 0) return true;
  const latest = await readAnalysisLifecycle(t, input.reservationId);
  if (!latest) return false;
  if (latest.stage === input.stage) return true;
  if (isTerminalAnalysisStage(latest.stage)) throw new RangeError(`Analysis lifecycle is terminal at ${latest.stage}.`);
  throw new RangeError(`Analysis lifecycle transition lost a race while moving from ${current.stage} to ${input.stage}; current stage is ${latest.stage}.`);
}
