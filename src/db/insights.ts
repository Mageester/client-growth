import { z } from "zod";
import { InsightAccountingSchema } from "@/core/analysisAccounting";
import { InsightSnapshotSchema, type InsightSnapshot } from "@/core/insightSchema";
import { CriticDecisionSchema, ProblemDraftSchema, problemDraftId, type ProblemDraft } from "@/core/siteUnderstandingSchema";
import { CrossWorkspaceError } from "@/db/tenant";

export const StageDurationsSchema = z.record(z.string().trim().min(1).max(100), z.number().finite().nonnegative().max(86_400_000)).default({});

function normalizeStageDurations(value: unknown): Record<string, number> {
  const parsed = StageDurationsSchema.parse(value);
  const normalized: Record<string, number> = {};
  for (const [rawKey, duration] of Object.entries(parsed)) {
    const key = rawKey.trim();
    if (key.length === 0 || key.length > 100) throw new Error("Stage duration keys must contain bounded non-whitespace text.");
    if (Object.prototype.hasOwnProperty.call(normalized, key)) throw new Error(`Duplicate stage duration key after normalization: ${key}`);
    normalized[key] = duration;
  }
  return normalized;
}

function reservationId(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new RangeError("Insight snapshot runId must be a positive reservation id.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RangeError("Insight snapshot runId exceeds SQLite's safe integer range.");
  return parsed;
}

function validateShadowArtifactPair(shadowDrafts: readonly ProblemDraft[], criticDecisions: readonly z.infer<typeof CriticDecisionSchema>[], label: string): void {
  const draftIds = new Set<string>();
  for (const draft of shadowDrafts) {
    const expectedDraftId = problemDraftId({ clientId: draft.clientId, category: draft.category, problemType: draft.problemType, canonicalSurface: draft.canonicalSurface, rootCause: draft.rootCause, diagnosticIds: draft.diagnosticIds, evidenceIds: draft.evidenceIds });
    if (draft.draftId !== expectedDraftId) throw new Error(`${label} shadow draft ID must be canonical.`);
    if (draftIds.has(draft.draftId)) throw new Error(`${label} shadow drafts must contain each draft ID at most once.`);
    draftIds.add(draft.draftId);
  }
  const decisionIds = new Set<string>();
  for (const decision of criticDecisions) {
    if (!draftIds.has(decision.draftId)) throw new Error(`${label} critic decisions reference an unknown shadow draft.`);
    if (decisionIds.has(decision.draftId)) throw new Error(`${label} critic decisions must contain each shadow draft at most once.`);
    decisionIds.add(decision.draftId);
  }
  if (criticDecisions.length > 0 && criticDecisions.length !== shadowDrafts.length) throw new Error(`${label} critic decisions must cover every shadow draft.`);
  if (criticDecisions.length > 0) {
    for (const [index, decision] of criticDecisions.entries()) if (decision.draftId !== shadowDrafts[index]?.draftId) throw new Error(`${label} critic decisions must follow the exact shadow draft order.`);
  }
}

export interface InsightAccountingPersistenceInput {
  shadowDrafts?: readonly unknown[];
  criticDecisions?: readonly unknown[];
  stageDurations?: unknown;
}

export function normalizeInsightAccountingPersistence(snapshot: InsightSnapshot, input: InsightAccountingPersistenceInput = {}) {
  const accounting = InsightAccountingSchema.parse(snapshot.accounting);
  const shadowDrafts = z.array(ProblemDraftSchema).max(100).parse(input.shadowDrafts ?? []);
  const criticDecisions = z.array(CriticDecisionSchema).max(100).parse(input.criticDecisions ?? []);
  const stageDurations = normalizeStageDurations(input.stageDurations ?? {});
  for (const draft of shadowDrafts) {
    if (draft.clientId !== snapshot.clientId) throw new CrossWorkspaceError("shadow problem draft crosses the completion client boundary");
    if (draft.diagnosticIds.some((id) => !snapshot.diagnostics.some((diagnostic) => diagnostic.id === id))) throw new Error("shadow problem draft references an unknown diagnostic");
    if (draft.evidenceIds.some((id) => !snapshot.evidence.some((evidence) => evidence.id === id))) throw new Error("shadow problem draft references unknown evidence");
  }
  validateShadowArtifactPair(shadowDrafts, criticDecisions, "Input");
  return { accounting, shadowDrafts, criticDecisions, stageDurations };
}

function accountingStatement(snapshot: InsightSnapshot, run: number, record: ReturnType<typeof normalizeInsightAccountingPersistence>) {
  return {
    sql: `INSERT INTO analysis_insight_accounting (
             workspace_id, run_id, client_id, accounting, shadow_drafts,
             critic_decisions, stage_durations, detector_manifest, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [snapshot.workspaceId, run, snapshot.clientId, JSON.stringify(record.accounting), JSON.stringify(record.shadowDrafts), JSON.stringify(record.criticDecisions), JSON.stringify(record.stageDurations), JSON.stringify(record.accounting.detectors), new Date().toISOString()],
  };
}

function insertStatements(snapshot: InsightSnapshot, run: number) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  for (const [position, evidence] of snapshot.evidence.entries()) {
    statements.push({ sql: `INSERT INTO analysis_evidence_refs (
               id, workspace_id, run_id, client_id, kind, locator, page_url,
               screenshot_id, viewport, position, observed_at, payload
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params: [evidence.id, snapshot.workspaceId, run, snapshot.clientId, evidence.kind, evidence.locator, evidence.pageUrl ?? null, evidence.screenshotId ?? null, evidence.viewport ?? null, position, evidence.observedAt, JSON.stringify(evidence)] });
  }
  for (const [position, diagnostic] of snapshot.diagnostics.entries()) {
    statements.push({ sql: `INSERT INTO analysis_diagnostics (
               id, workspace_id, run_id, client_id, detector_id, detector_version,
               category, problem_type, subject_kind, subject_key, state, fingerprint,
               position, created_at, payload
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params: [diagnostic.id, snapshot.workspaceId, run, snapshot.clientId, diagnostic.detectorId, diagnostic.detectorVersion, diagnostic.category, diagnostic.problemType, diagnostic.subject.kind, diagnostic.subject.key, diagnostic.state, diagnostic.fingerprint, position, diagnostic.createdAt, JSON.stringify(diagnostic)] });
  }
  for (const [position, problem] of snapshot.problems.entries()) {
    statements.push({ sql: `INSERT INTO analysis_problems (
               id, workspace_id, run_id, client_id, canonical_key, category,
               problem_type, surface_key, quality_gate, position, created_at, payload
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params: [problem.id, snapshot.workspaceId, run, snapshot.clientId, problem.canonicalKey, problem.category, problem.problemType, problem.surfaceKey, problem.qualityGate, position, problem.createdAt, JSON.stringify(problem)] });
  }
  const snapshotLimitations = snapshot.limitations === undefined ? null : JSON.stringify(snapshot.limitations);
  for (const [position, category] of snapshot.categories.entries()) {
    statements.push({ sql: `INSERT INTO analysis_category_assessments (
               id, workspace_id, run_id, client_id, category, state,
               diagnostic_count, problem_count, reason, limitations,
               snapshot_limitations, position, payload
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params: [category.category, snapshot.workspaceId, run, snapshot.clientId, category.category, category.state, category.diagnosticCount, category.problemCount, category.reason ?? null, JSON.stringify(category.limitations), snapshotLimitations, position, JSON.stringify(category)] });
  }
  return statements;
}

export function insightSnapshotStatements(snapshot: InsightSnapshot): Array<{ sql: string; params: unknown[] }> {
  const parsed = InsightSnapshotSchema.parse(snapshot);
  return insertStatements(parsed, reservationId(parsed.runId));
}

export function insightAccountingStatement(snapshot: InsightSnapshot, input: InsightAccountingPersistenceInput): { sql: string; params: unknown[] } {
  const parsed = InsightSnapshotSchema.parse(snapshot);
  return accountingStatement(parsed, reservationId(parsed.runId), normalizeInsightAccountingPersistence(parsed, input));
}
