// src/db/insights.ts
var StageDurationsSchema = external_exports.record(
  external_exports.string().trim().min(1).max(100),
  external_exports.number().finite().nonnegative().max(864e5)
).default({});
function normalizeStageDurations(value) {
  const parsed = StageDurationsSchema.parse(value);
  const normalized3 = {};
  for (const [rawKey, duration3] of Object.entries(parsed)) {
    const key = rawKey.trim();
    if (key.length === 0 || key.length > 100) {
      throw new Error("Stage duration keys must contain bounded non-whitespace text.");
    }
    if (Object.prototype.hasOwnProperty.call(normalized3, key)) {
      throw new Error(`Duplicate stage duration key after normalization: ${key}`);
    }
    normalized3[key] = duration3;
  }
  return normalized3;
}
__name(normalizeStageDurations, "normalizeStageDurations");
function reservationId(value) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new RangeError("Insight snapshot runId must be a positive reservation id.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError("Insight snapshot runId exceeds SQLite's safe integer range.");
  }
  return parsed;
}
__name(reservationId, "reservationId");
function validateShadowArtifactPair(shadowDrafts, criticDecisions, label) {
  const draftIds = /* @__PURE__ */ new Set();
  for (const draft of shadowDrafts) {
    const expectedDraftId = problemDraftId({
      clientId: draft.clientId,
      category: draft.category,
      problemType: draft.problemType,
      canonicalSurface: draft.canonicalSurface,
      rootCause: draft.rootCause,
      diagnosticIds: draft.diagnosticIds,
      evidenceIds: draft.evidenceIds
    });
    if (draft.draftId !== expectedDraftId) {
      throw new Error(`${label} shadow draft ID must be canonical.`);
    }
    if (draftIds.has(draft.draftId)) {
      throw new Error(`${label} shadow drafts must contain each draft ID at most once.`);
    }
    draftIds.add(draft.draftId);
  }
  const decisionIds = /* @__PURE__ */ new Set();
  for (const decision of criticDecisions) {
    if (!draftIds.has(decision.draftId)) {
      throw new Error(`${label} critic decisions reference an unknown shadow draft.`);
    }
    if (decisionIds.has(decision.draftId)) {
      throw new Error(`${label} critic decisions must contain each shadow draft at most once.`);
    }
    decisionIds.add(decision.draftId);
  }
  if (criticDecisions.length > 0 && criticDecisions.length !== shadowDrafts.length) {
    throw new Error(`${label} critic decisions must cover every shadow draft.`);
  }
  if (criticDecisions.length > 0) {
    for (const [index, decision] of criticDecisions.entries()) {
      if (decision.draftId !== shadowDrafts[index]?.draftId) {
        throw new Error(`${label} critic decisions must follow the exact shadow draft order.`);
      }
    }
  }
}
__name(validateShadowArtifactPair, "validateShadowArtifactPair");
function normalizeInsightAccountingPersistence(snapshot, input = {}) {
  const accounting = InsightAccountingSchema.parse(snapshot.accounting);
  const shadowDrafts = external_exports.array(ProblemDraftSchema).max(100).parse(input.shadowDrafts ?? []);
  const criticDecisions = external_exports.array(CriticDecisionSchema).max(100).parse(input.criticDecisions ?? []);
  const stageDurations = normalizeStageDurations(input.stageDurations ?? {});
  for (const draft of shadowDrafts) {
    if (draft.clientId !== snapshot.clientId) {
      throw new CrossWorkspaceError("shadow problem draft crosses the completion client boundary");
    }
    if (draft.diagnosticIds.some((id) => !snapshot.diagnostics.some((diagnostic) => diagnostic.id === id))) {
      throw new Error("shadow problem draft references an unknown diagnostic");
    }
    if (draft.evidenceIds.some((id) => !snapshot.evidence.some((evidence) => evidence.id === id))) {
      throw new Error("shadow problem draft references unknown evidence");
    }
  }
  validateShadowArtifactPair(shadowDrafts, criticDecisions, "Input");
  return { accounting, shadowDrafts, criticDecisions, stageDurations };
}
__name(normalizeInsightAccountingPersistence, "normalizeInsightAccountingPersistence");
function accountingStatement(snapshot, run, record2) {
  return {
    sql: `INSERT INTO analysis_insight_accounting (
             workspace_id, run_id, client_id, accounting, shadow_drafts,
             critic_decisions, stage_durations, detector_manifest, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      snapshot.workspaceId,
      run,
      snapshot.clientId,
      JSON.stringify(record2.accounting),
      JSON.stringify(record2.shadowDrafts),
      JSON.stringify(record2.criticDecisions),
      JSON.stringify(record2.stageDurations),
      JSON.stringify(record2.accounting.detectors),
      (/* @__PURE__ */ new Date()).toISOString()
    ]
  };
}
__name(accountingStatement, "accountingStatement");
function insertStatements(snapshot, run) {
  const statements = [];
  for (const [position, evidence] of snapshot.evidence.entries()) {
    statements.push({
      sql: `INSERT INTO analysis_evidence_refs (
               id, workspace_id, run_id, client_id, kind, locator, page_url,
               screenshot_id, viewport, position, observed_at, payload
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        evidence.id,
        snapshot.workspaceId,
        run,
        snapshot.clientId,
        evidence.kind,
        evidence.locator,
        evidence.pageUrl ?? null,
        evidence.screenshotId ?? null,
        evidence.viewport ?? null,
        position,
        evidence.observedAt,
        JSON.stringify(evidence)
      ]
    });
  }
  for (const [position, diagnostic] of snapshot.diagnostics.entries()) {
    statements.push({
      sql: `INSERT INTO analysis_diagnostics (
               id, workspace_id, run_id, client_id, detector_id, detector_version,
               category, problem_type, subject_kind, subject_key, state, fingerprint,
               position, created_at, payload
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        diagnostic.id,
        snapshot.workspaceId,
        run,
        snapshot.clientId,
        diagnostic.detectorId,
        diagnostic.detectorVersion,
        diagnostic.category,
        diagnostic.problemType,
        diagnostic.subject.kind,
        diagnostic.subject.key,
        diagnostic.state,
        diagnostic.fingerprint,
        position,
        diagnostic.createdAt,
        JSON.stringify(diagnostic)
      ]
    });
  }
  for (const [position, problem] of snapshot.problems.entries()) {
    statements.push({
      sql: `INSERT INTO analysis_problems (
               id, workspace_id, run_id, client_id, canonical_key, category,
               problem_type, surface_key, quality_gate, position, created_at, payload
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        problem.id,
        snapshot.workspaceId,
        run,
        snapshot.clientId,
        problem.canonicalKey,
        problem.category,
        problem.problemType,
        problem.surfaceKey,
        problem.qualityGate,
        position,
        problem.createdAt,
        JSON.stringify(problem)
      ]
    });
  }
  const snapshotLimitations = snapshot.limitations === void 0 ? null : JSON.stringify(snapshot.limitations);
  for (const [position, category] of snapshot.categories.entries()) {
    statements.push({
      sql: `INSERT INTO analysis_category_assessments (
               id, workspace_id, run_id, client_id, category, state,
               diagnostic_count, problem_count, reason, limitations,
               snapshot_limitations, position, payload
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        category.category,
        snapshot.workspaceId,
        run,
        snapshot.clientId,
        category.category,
        category.state,
        category.diagnosticCount,
        category.problemCount,
        category.reason ?? null,
        JSON.stringify(category.limitations),
        snapshotLimitations,
        position,
        JSON.stringify(category)
      ]
    });
  }
  return statements;
}
__name(insertStatements, "insertStatements");
function insightSnapshotStatements(snapshot) {
  const parsed = InsightSnapshotSchema.parse(snapshot);
  return insertStatements(parsed, reservationId(parsed.runId));
}
__name(insightSnapshotStatements, "insightSnapshotStatements");
function insightAccountingStatement(snapshot, record2) {
  const parsed = InsightSnapshotSchema.parse(snapshot);
  return accountingStatement(parsed, reservationId(parsed.runId), record2);
}
__name(insightAccountingStatement, "insightAccountingStatement");
