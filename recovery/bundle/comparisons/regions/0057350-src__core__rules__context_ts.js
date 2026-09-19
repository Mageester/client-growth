// src/core/rules/context.ts
function legacyDiagnosticDraft(input) {
  return DiagnosticDraftSchema.parse({
    detectorId: input.detectorId,
    detectorVersion: "1",
    category: definitionForProblemType(input.problemType).category,
    problemType: input.problemType,
    subject: input.subject,
    observation: input.observation,
    legacyEvidenceRefs: input.legacyEvidenceRefs,
    rawConfidence: input.rawConfidence ?? 0.9,
    state: input.state ?? "observed",
    details: input.details ?? { kind: "legacy", legacyRuleId: input.detectorId }
  });
}
__name(legacyDiagnosticDraft, "legacyDiagnosticDraft");
