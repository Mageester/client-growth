// src/db/repositories.ts
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== void 0).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
__name(stableJson, "stableJson");
function canonicalAccounting(accounting) {
  return {
    ...accounting,
    // Detector and category manifests are explicitly set-like. Preserve the
    // order of every nested artifact list because those arrays are authored
    // evidence, not interchangeable collections.
    detectors: [...accounting.detectors].sort((left, right) => {
      const leftJson = stableJson(left);
      const rightJson = stableJson(right);
      return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
    }),
    categories: [...accounting.categories].sort(
      (left, right) => left.category.localeCompare(right.category)
    )
  };
}
__name(canonicalAccounting, "canonicalAccounting");
function canonicalPersistence(record2) {
  return {
    accounting: canonicalAccounting(record2.accounting),
    shadowDrafts: record2.shadowDrafts,
    criticDecisions: record2.criticDecisions,
    stageDurations: record2.stageDurations
  };
}
__name(canonicalPersistence, "canonicalPersistence");
async function completionFingerprint(input, persistence) {
  const opportunities = [...input.opportunities].sort((left, right) => {
    const leftJson = stableJson(left);
    const rightJson = stableJson(right);
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
  });
  const canonicalSnapshot = {
    ...input.insightSnapshot,
    accounting: canonicalAccounting(input.insightSnapshot.accounting)
  };
  const canonical2 = stableJson({
    evidence: input.evidence,
    insightSnapshot: canonicalSnapshot,
    opportunities,
    run: input.run,
    accounting: canonicalPersistence(persistence)
  });
  const digest2 = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical2)
  );
  return Array.from(new Uint8Array(digest2), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(completionFingerprint, "completionFingerprint");
function toService(row) {
  return ServiceSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    priceMin: row.price_min,
    priceMax: row.price_max,
    tags: JSON.parse(row.tags),
    active: row.active === 1
  });
}
__name(toService, "toService");
async function listServices(t) {
  const rows = await t.db.prepare("SELECT * FROM services WHERE workspace_id = ? ORDER BY name").bind(t.workspaceId).all();
  return rows.map(toService);
}
__name(listServices, "listServices");
function toClient(row) {
  return ClientSchema.parse({
    id: row.id,
    name: row.name,
    domain: row.domain,
    offerings: JSON.parse(row.offerings),
    averageJobValue: row.average_job_value ?? void 0,
    notes: row.notes
  });
}
__name(toClient, "toClient");
async function getClient(t, id) {
  const row = await t.db.prepare("SELECT * FROM clients WHERE id = ? AND workspace_id = ?").bind(id, t.workspaceId).first();
  return row ? toClient(row) : null;
}
__name(getClient, "getClient");
function toExternalBusinessClaim(row) {
  return ExternalBusinessClaimSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    clientId: row.client_id,
    provider: row.provider,
    sourceRecordId: row.source_record_id,
    sourceUrl: row.source_url,
    authorization: row.authorization,
    rawServiceLabel: row.raw_service_label,
    sourceField: row.source_field,
    observedAt: row.observed_at,
    retrievedAt: row.retrieved_at,
    sourceHash: row.source_hash,
    sourceVersion: row.source_version ?? void 0,
    normalizedLabel: row.normalized_label,
    semanticState: row.semantic_state,
    semanticReason: row.semantic_reason
  });
}
__name(toExternalBusinessClaim, "toExternalBusinessClaim");
async function listExternalBusinessClaims(t, clientId2) {
  const rows = await t.db.prepare(
    `SELECT * FROM external_business_claims
       WHERE client_id = ? AND workspace_id = ?
       ORDER BY retrieved_at DESC, id ASC`
  ).bind(clientId2, t.workspaceId).all();
  return rows.map(toExternalBusinessClaim);
}
__name(listExternalBusinessClaims, "listExternalBusinessClaims");
async function listCoverage(t, clientId2) {
  const rows = await t.db.prepare("SELECT * FROM client_coverage WHERE client_id = ? AND workspace_id = ?").bind(clientId2, t.workspaceId).all();
  return rows.map(
    (r) => CoverageSchema.parse({
      clientId: r.client_id,
      serviceId: r.service_id,
      covered: true,
      note: r.note ?? void 0
    })
  );
}
__name(listCoverage, "listCoverage");
function evidenceStatement(t, bundle) {
  return {
    sql: `INSERT INTO evidence_bundles (workspace_id, client_id, source, captured_at, bundle)
          VALUES (?, ?, ?, ?, ?)`,
    params: [
      t.workspaceId,
      bundle.clientId,
      bundle.source,
      bundle.capturedAt,
      JSON.stringify(bundle)
    ]
  };
}
__name(evidenceStatement, "evidenceStatement");
function toOpportunity(row) {
  return OpportunitySchema.parse({
    id: row.id,
    dedupeKey: row.dedupe_key,
    clientId: row.client_id,
    ruleId: row.rule_id,
    title: row.title,
    detected: row.detected,
    evidenceRefs: JSON.parse(row.evidence_refs),
    suppressedEvidenceRefs: JSON.parse(row.suppressed_evidence_refs),
    rationale: row.rationale,
    suggestedServiceId: row.suggested_service_id,
    suggestedScope: JSON.parse(row.suggested_scope),
    verification: row.verification ? JSON.parse(row.verification) : void 0,
    conversionDefect: row.conversion_defect ? JSON.parse(row.conversion_defect) : void 0,
    priceMin: row.price_min,
    priceMax: row.price_max,
    confidence: row.confidence,
    billableStatus: row.billable_status,
    status: row.status,
    snoozeUntil: row.snooze_until ?? void 0,
    proposalMd: row.proposal_md ?? void 0,
    soldAmount: row.sold_amount ?? void 0,
    soldAt: row.sold_at ?? void 0,
    acceptedAt: row.accepted_at ?? void 0,
    proposalPreparedAt: row.proposal_prepared_at ?? void 0,
    pitchedAt: row.pitched_at ?? void 0,
    lostAt: row.lost_at ?? void 0,
    dismissedAt: row.dismissed_at ?? void 0,
    updatedAt: row.updated_at
  });
}
__name(toOpportunity, "toOpportunity");
async function listOpportunities(t, clientId2) {
  const rows = await t.db.prepare(
    "SELECT * FROM opportunities WHERE client_id = ? AND workspace_id = ? AND status <> 'superseded' ORDER BY confidence DESC, title"
  ).bind(clientId2, t.workspaceId).all();
  return rows.map(toOpportunity);
}
__name(listOpportunities, "listOpportunities");
function opportunityStatement(t, o) {
  return {
    sql: `INSERT INTO opportunities (
             id, workspace_id, dedupe_key, client_id, rule_id, title, detected, evidence_refs, suppressed_evidence_refs, rationale,
             suggested_service_id, suggested_scope, price_min, price_max, confidence,
             billable_status, status, snooze_until, proposal_md, verification,
             conversion_defect, sold_amount, sold_at,
             accepted_at, proposal_prepared_at, pitched_at, lost_at, dismissed_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(client_id, dedupe_key) DO UPDATE SET
             title = excluded.title, detected = excluded.detected,
             evidence_refs = excluded.evidence_refs,
             suppressed_evidence_refs = excluded.suppressed_evidence_refs,
             rationale = excluded.rationale,
             suggested_service_id = excluded.suggested_service_id,
             suggested_scope = excluded.suggested_scope,
             price_min = excluded.price_min, price_max = excluded.price_max,
             confidence = excluded.confidence, billable_status = excluded.billable_status,
             status = excluded.status, snooze_until = excluded.snooze_until,
             proposal_md = excluded.proposal_md, verification = excluded.verification,
             conversion_defect = excluded.conversion_defect,
             sold_amount = excluded.sold_amount, sold_at = excluded.sold_at,
             accepted_at = excluded.accepted_at,
             proposal_prepared_at = excluded.proposal_prepared_at,
             pitched_at = excluded.pitched_at,
             lost_at = excluded.lost_at,
             dismissed_at = excluded.dismissed_at,
             updated_at = excluded.updated_at
           WHERE opportunities.workspace_id = ? AND opportunities.status <> 'superseded'`,
    params: [
      o.id,
      t.workspaceId,
      o.dedupeKey,
      o.clientId,
      o.ruleId,
      o.title,
      o.detected,
      JSON.stringify(o.evidenceRefs),
      JSON.stringify(o.suppressedEvidenceRefs),
      o.rationale,
      o.suggestedServiceId,
      JSON.stringify(o.suggestedScope),
      o.priceMin,
      o.priceMax,
      o.confidence,
      o.billableStatus,
      o.status,
      o.snoozeUntil ?? null,
      o.proposalMd ?? null,
      o.verification ? JSON.stringify(o.verification) : null,
      o.conversionDefect ? JSON.stringify(o.conversionDefect) : null,
      o.soldAmount ?? null,
      o.soldAt ?? null,
      o.acceptedAt ?? null,
      o.proposalPreparedAt ?? null,
      o.pitchedAt ?? null,
      o.lostAt ?? null,
      o.dismissedAt ?? null,
      o.updatedAt,
      t.workspaceId
    ]
  };
}
__name(opportunityStatement, "opportunityStatement");
var RUN_TRIGGERS = ["manual", "scheduled"];
function validateAnalysisRunInput(run) {
  if (!run || typeof run !== "object") throw new TypeError("Analysis run input is required.");
  const stringFields = [
    "clientId",
    "startedAt",
    "finishedAt",
    "source",
    "summary",
    "trigger"
  ];
  for (const field of stringFields) {
    if (typeof run[field] !== "string" || run[field].trim() === "") {
      throw new TypeError(`Analysis run ${field} must be a non-empty string.`);
    }
  }
  if (!ANALYSIS_OUTCOMES.includes(run.outcome)) {
    throw new TypeError(`Analysis run outcome ${String(run.outcome)} is invalid.`);
  }
  if (!RUN_TRIGGERS.includes(run.trigger)) {
    throw new TypeError(`Analysis run trigger ${String(run.trigger)} is invalid.`);
  }
  if (run.limitation !== null && typeof run.limitation !== "string") {
    throw new TypeError("Analysis run limitation must be a string or null.");
  }
  if (!run.stats || typeof run.stats !== "object" || Array.isArray(run.stats)) {
    throw new TypeError("Analysis run stats must be an object.");
  }
  for (const [key, value] of Object.entries(run.stats)) {
    if (!key || typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError("Analysis run stats must contain finite numeric values.");
    }
  }
  const countFields = [
    "pagesRead",
    "pagesFetched",
    "blockedEvents",
    "inconclusiveEvents",
    "surfaced",
    "newCount",
    "resolvedCount",
    "evaluatorCalls",
    "evaluatorRejections",
    "evaluatorErrors"
  ];
  for (const field of countFields) {
    if (!Number.isInteger(run[field]) || run[field] < 0) {
      throw new TypeError(`Analysis run ${field} must be a non-negative integer.`);
    }
  }
  if (run.crawlExhaustive !== void 0 && typeof run.crawlExhaustive !== "boolean") {
    throw new TypeError("Analysis run crawlExhaustive must be a boolean.");
  }
  if (run.suggestedOfferings !== void 0 && !Array.isArray(run.suggestedOfferings)) {
    throw new TypeError("Analysis run suggestedOfferings must be an array.");
  }
  if (run.offeringDrift !== void 0 && !Array.isArray(run.offeringDrift)) {
    throw new TypeError("Analysis run offeringDrift must be an array.");
  }
  return {
    ...run,
    crawlExhaustive: run.crawlExhaustive ?? false,
    suggestedOfferings: run.suggestedOfferings ?? [],
    offeringDrift: run.offeringDrift ?? []
  };
}
__name(validateAnalysisRunInput, "validateAnalysisRunInput");
function analysisRunStatement(t, run) {
  return {
    sql: `INSERT INTO analysis_runs (
             workspace_id, client_id, started_at, finished_at, source, outcome, summary, limitation,
             pages_read, pages_fetched, blocked_events, inconclusive_events, surfaced, stats,
             trigger, new_count, resolved_count, evaluator_calls, evaluator_rejections, evaluator_errors,
             crawl_exhaustive, suggested_offerings, offering_drift
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      t.workspaceId,
      run.clientId,
      run.startedAt,
      run.finishedAt,
      run.source,
      run.outcome,
      run.summary,
      run.limitation ?? null,
      run.pagesRead,
      run.pagesFetched,
      run.blockedEvents,
      run.inconclusiveEvents,
      run.surfaced,
      JSON.stringify(run.stats),
      run.trigger,
      run.newCount,
      run.resolvedCount,
      run.evaluatorCalls,
      run.evaluatorRejections,
      run.evaluatorErrors,
      run.crawlExhaustive ? 1 : 0,
      JSON.stringify(run.suggestedOfferings ?? []),
      JSON.stringify(run.offeringDrift ?? [])
    ]
  };
}
__name(analysisRunStatement, "analysisRunStatement");
function linkCompletionReservationStatement(t, reservationId3, run, fingerprint) {
  return {
    sql: `UPDATE analysis_limit_reservations
          SET analysis_run_id = (
            SELECT id FROM analysis_runs
            WHERE workspace_id = ? AND client_id = ? AND started_at = ?
            ORDER BY id DESC LIMIT 1
          ), completion_fingerprint = ?,
          client_id = CASE
            WHEN analysis_run_id IS NULL
              AND finished_at IS NULL
              AND failed = 0
              AND stage NOT IN ('completed', 'completed_with_limitations', 'failed', 'unavailable', 'blocked')
              AND EXISTS (
                SELECT 1 FROM analysis_runs
                WHERE workspace_id = ? AND client_id = ? AND started_at = ?
              )
            THEN client_id
            ELSE NULL
          END
          WHERE workspace_id = ? AND id = ? AND client_id = ?`,
    params: [
      t.workspaceId,
      run.clientId,
      run.startedAt,
      fingerprint,
      t.workspaceId,
      run.clientId,
      run.startedAt,
      t.workspaceId,
      reservationId3,
      run.clientId
    ]
  };
}
__name(linkCompletionReservationStatement, "linkCompletionReservationStatement");
function assertCompletionIdentity(t, evidence, snapshot, opportunities, run) {
  if (evidence.clientId !== run.clientId || snapshot.clientId !== run.clientId) {
    throw new CrossWorkspaceError("analysis completion inputs disagree on client identity");
  }
  if (snapshot.workspaceId !== t.workspaceId) {
    throw new CrossWorkspaceError(`insight snapshot belongs to workspace ${snapshot.workspaceId}`);
  }
  if (snapshot.evidence.some((row) => row.runId !== snapshot.runId)) {
    throw new Error("Insight snapshot evidence must use its accepted reservation runId.");
  }
  if (snapshot.diagnostics.some(
    (row) => row.workspaceId !== t.workspaceId || row.runId !== snapshot.runId || row.clientId !== run.clientId
  ) || snapshot.problems.some(
    (row) => row.workspaceId !== t.workspaceId || row.runId !== snapshot.runId || row.clientId !== run.clientId
  )) {
    throw new CrossWorkspaceError("insight snapshot child rows cross the completion identity boundary");
  }
  if (opportunities.some((row) => row.clientId !== run.clientId)) {
    throw new CrossWorkspaceError("opportunity rows cross the completion client boundary");
  }
}
__name(assertCompletionIdentity, "assertCompletionIdentity");
async function saveAnalysisCompletion(t, input) {
  const evidence = EvidenceBundleSchema.parse(input.evidence);
  const insightSnapshot = InsightSnapshotSchema.parse(input.insightSnapshot);
  const opportunities = input.opportunities.map((row) => OpportunitySchema.parse(row));
  const run = validateAnalysisRunInput(input.run);
  assertCompletionIdentity(t, evidence, insightSnapshot, opportunities, run);
  const persistence = normalizeInsightAccountingPersistence(insightSnapshot, {
    shadowDrafts: input.shadowDrafts,
    criticDecisions: input.criticDecisions,
    stageDurations: input.stageDurations
  });
  const fingerprint = await completionFingerprint({
    ...input,
    evidence,
    insightSnapshot,
    opportunities,
    run
  }, persistence);
  const reservationId3 = Number(insightSnapshot.runId);
  if (!Number.isSafeInteger(reservationId3) || reservationId3 < 1 || String(reservationId3) !== insightSnapshot.runId) {
    throw new RangeError("Analysis completion runId must be its positive reservation id.");
  }
  const reservation = await t.db.prepare(
    `SELECT client_id, analysis_run_id, stage, finished_at, failed, completion_fingerprint
       FROM analysis_limit_reservations
       WHERE workspace_id = ? AND id = ?`
  ).bind(t.workspaceId, reservationId3).first();
  if (!reservation || reservation.client_id !== run.clientId) {
    throw new CrossWorkspaceError(
      `analysis completion reservation ${insightSnapshot.runId} is not owned by client ${run.clientId}`
    );
  }
  if (reservation.analysis_run_id !== null) {
    if (reservation.completion_fingerprint !== fingerprint) {
      throw new Error("Analysis completion retry conflicts with its accepted completion fingerprint.");
    }
    const linkedId = Number(reservation.analysis_run_id);
    const linkedRun = await t.db.prepare(
      `SELECT id FROM analysis_runs
         WHERE id = ? AND workspace_id = ? AND client_id = ?`
    ).bind(linkedId, t.workspaceId, run.clientId).first();
    if (!linkedRun) {
      throw new Error("Analysis completion reservation points to an unknown terminal run.");
    }
    return linkedId;
  }
  if (reservation.finished_at !== null || reservation.failed !== 0) {
    throw new Error("Analysis completion reservation is already terminal without a linked run.");
  }
  if (!await existsInWorkspace(t, "clients", run.clientId)) {
    throw new CrossWorkspaceError(`analysis run for client ${run.clientId} not in this workspace`);
  }
  for (const row of opportunities) {
    if (!await existsInWorkspace(t, "services", row.suggestedServiceId)) {
      throw new CrossWorkspaceError(
        `opportunity maps to service ${row.suggestedServiceId} not in this workspace`
      );
    }
  }
  const statements = [
    evidenceStatement(t, evidence),
    ...insightSnapshotStatements(insightSnapshot),
    insightAccountingStatement(insightSnapshot, persistence),
    ...opportunities.map((row) => opportunityStatement(t, row)),
    analysisRunStatement(t, run),
    linkCompletionReservationStatement(t, reservationId3, run, fingerprint)
  ];
  let results;
  try {
    results = await t.db.batch(statements);
  } catch (error3) {
    try {
      const linkedAfterFailure = await t.db.prepare(
        `SELECT analysis_run_id, completion_fingerprint
           FROM analysis_limit_reservations
           WHERE workspace_id = ? AND id = ? AND client_id = ?`
      ).bind(t.workspaceId, reservationId3, run.clientId).first();
      if (linkedAfterFailure?.analysis_run_id !== null && linkedAfterFailure?.analysis_run_id !== void 0) {
        if (linkedAfterFailure.completion_fingerprint === fingerprint) {
          return Number(linkedAfterFailure.analysis_run_id);
        }
        throw new Error("Analysis completion raced with a conflicting completion.", { cause: error3 });
      }
    } catch (recoveryError) {
      if (recoveryError instanceof Error && recoveryError.message.includes("conflicting completion")) {
        throw recoveryError;
      }
    }
    throw error3;
  }
  const analysisRunResult = results[results.length - 2];
  const insertedRunId = analysisRunResult?.lastRowId !== void 0 && analysisRunResult.lastRowId > 0 ? analysisRunResult.lastRowId : null;
  const linked = await t.db.prepare(
    `SELECT analysis_run_id, completion_fingerprint FROM analysis_limit_reservations
       WHERE workspace_id = ? AND id = ? AND client_id = ?`
  ).bind(t.workspaceId, reservationId3, run.clientId).first();
  if (linked?.analysis_run_id !== null && linked?.analysis_run_id !== void 0) {
    if (linked.completion_fingerprint !== fingerprint) {
      throw new Error("Analysis completion link has a conflicting completion fingerprint.");
    }
    return Number(linked.analysis_run_id);
  }
  throw new Error(
    insertedRunId === null ? "Analysis completion was written but its terminal run id was unavailable." : "Analysis completion was written but its reservation link could not be persisted."
  );
}
__name(saveAnalysisCompletion, "saveAnalysisCompletion");
function toAnalysisRun(row) {
  const outcome = ANALYSIS_OUTCOMES.includes(row.outcome) ? row.outcome : "inconclusive";
  let stats = {};
  try {
    const parsed = JSON.parse(row.stats);
    if (parsed && typeof parsed === "object") stats = parsed;
  } catch {
  }
  return {
    id: row.id,
    clientId: row.client_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    source: row.source,
    outcome,
    summary: row.summary,
    limitation: row.limitation,
    pagesRead: row.pages_read,
    pagesFetched: row.pages_fetched,
    blockedEvents: row.blocked_events,
    inconclusiveEvents: row.inconclusive_events,
    surfaced: row.surfaced,
    stats,
    trigger: RUN_TRIGGERS.includes(row.trigger) ? row.trigger : "manual",
    newCount: Number(row.new_count) || 0,
    resolvedCount: Number(row.resolved_count) || 0,
    evaluatorCalls: Number(row.evaluator_calls) || 0,
    evaluatorRejections: Number(row.evaluator_rejections) || 0,
    evaluatorErrors: Number(row.evaluator_errors) || 0,
    crawlExhaustive: row.crawl_exhaustive === 1,
    suggestedOfferings: parseOfferingLabels(row.suggested_offerings),
    offeringDrift: parseOfferingLabels(row.offering_drift)
  };
}
__name(toAnalysisRun, "toAnalysisRun");
async function recordAnalysisRun(t, run) {
  if (!await existsInWorkspace(t, "clients", run.clientId)) {
    throw new CrossWorkspaceError(`analysis run for client ${run.clientId} not in this workspace`);
  }
  await t.db.prepare(
    `INSERT INTO analysis_runs (
         workspace_id, client_id, started_at, finished_at, source, outcome, summary, limitation,
         pages_read, pages_fetched, blocked_events, inconclusive_events, surfaced, stats,
         trigger, new_count, resolved_count, evaluator_calls, evaluator_rejections, evaluator_errors,
         crawl_exhaustive, suggested_offerings, offering_drift
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    t.workspaceId,
    run.clientId,
    run.startedAt,
    run.finishedAt,
    run.source,
    run.outcome,
    run.summary,
    run.limitation ?? null,
    run.pagesRead,
    run.pagesFetched,
    run.blockedEvents,
    run.inconclusiveEvents,
    run.surfaced,
    JSON.stringify(run.stats),
    run.trigger,
    run.newCount,
    run.resolvedCount,
    run.evaluatorCalls,
    run.evaluatorRejections,
    run.evaluatorErrors,
    run.crawlExhaustive ? 1 : 0,
    JSON.stringify(run.suggestedOfferings ?? []),
    JSON.stringify(run.offeringDrift ?? [])
  ).run();
  const saved = await t.db.prepare(
    `SELECT id FROM analysis_runs
       WHERE workspace_id = ? AND client_id = ? AND started_at = ?
       ORDER BY id DESC LIMIT 1`
  ).bind(t.workspaceId, run.clientId, run.startedAt).first();
  if (!saved) throw new Error("Analysis run was written but could not be read back.");
  return Number(saved.id);
}
__name(recordAnalysisRun, "recordAnalysisRun");
async function getLatestExhaustiveAnalysisRun(t, clientId2) {
  const row = await t.db.prepare(
    `SELECT * FROM analysis_runs
       WHERE client_id = ? AND workspace_id = ? AND crawl_exhaustive = 1
       ORDER BY finished_at DESC, id DESC
       LIMIT 1`
  ).bind(clientId2, t.workspaceId).first();
  return row ? toAnalysisRun(row) : null;
}
__name(getLatestExhaustiveAnalysisRun, "getLatestExhaustiveAnalysisRun");
