// src/core/semanticDrafts.ts
var SEMANTIC_DETECTOR_ID = "site-understanding";
var SEMANTIC_DRAFT_CONFIDENCE = 0.8;
function pageKeyFor(draft, byId) {
  const cited = draft.evidenceIds.map((id) => byId.get(id)).filter((entry2) => entry2 !== void 0);
  const page = cited.find((entry2) => entry2.kind === "page")?.locator ?? cited.find((entry2) => entry2.pageUrl !== void 0)?.pageUrl;
  if (page) return page;
  return draft.canonicalSurface;
}
__name(pageKeyFor, "pageKeyFor");
function semanticDiagnosticDrafts(drafts, ledger) {
  const byId = new Map(ledger.map((entry2) => [entry2.id, entry2]));
  const built = [];
  for (const draft of drafts) {
    if (draft.diagnosticIds.length > 0) continue;
    if (!MODEL_ANCHORED_PROBLEM_TYPES.has(draft.problemType)) continue;
    const evidenceIds = draft.evidenceIds.filter((id) => byId.has(id));
    if (evidenceIds.length === 0) continue;
    built.push(
      DiagnosticDraftSchema.parse({
        detectorId: SEMANTIC_DETECTOR_ID,
        detectorVersion: "1",
        category: definitionForProblemType(draft.problemType).category,
        problemType: draft.problemType,
        subject: { kind: "page", key: pageKeyFor(draft, byId) },
        observation: draft.statement,
        // Exact ledger IDs, so resolution is authoritative rather than aliased.
        legacyEvidenceRefs: evidenceIds,
        rawConfidence: SEMANTIC_DRAFT_CONFIDENCE,
        state: "observed",
        origin: "SOURCE_HTTP",
        details: {
          kind: "semantic",
          source: "site-understanding",
          reason: `A bounded site-understanding pass read the cited ${evidenceIds.length} evidence row(s) and reported this condition.`
        }
      })
    );
  }
  return built;
}
__name(semanticDiagnosticDrafts, "semanticDiagnosticDrafts");
function isSemanticDiagnostic(diagnostic) {
  return diagnostic.detectorId === SEMANTIC_DETECTOR_ID;
}
__name(isSemanticDiagnostic, "isSemanticDiagnostic");
