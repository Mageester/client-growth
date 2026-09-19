// src/core/diagnosticCompatibility.ts
function candidateFromDiagnostic(draft, catalog) {
  if (draft.state !== "observed") return null;
  if (draft.details?.kind === "broad") return null;
  const legacyRuleId = definitionForProblemType(draft.problemType).legacyRuleId;
  if (legacyRuleId === null) return null;
  const link = RULE_SERVICE_LINKS.find((entry2) => entry2.ruleId === legacyRuleId);
  if (!link) return null;
  const match = matchServiceForRule(catalog, link.tag);
  if (!match) return null;
  const candidate = {
    ruleId: legacyRuleId,
    subject: draft.subject.key,
    detected: draft.observation,
    evidenceRefs: [...draft.legacyEvidenceRefs],
    rawConfidence: draft.rawConfidence,
    suggestedServiceId: match.service.id
  };
  if (draft.details?.kind === "verification") {
    candidate.verification = VerificationSchema.parse(draft.details.verification);
  }
  if (draft.details?.kind === "conversion_defect") {
    candidate.conversionDefect = ConversionDefectSchema.parse(
      draft.details.conversionDefect
    );
  }
  const suppressedEvidenceRefs = draft.details?.kind === "legacy" ? draft.details.suppressedEvidenceRefs : void 0;
  if (suppressedEvidenceRefs !== void 0) {
    candidate.suppressedEvidenceRefs = [...suppressedEvidenceRefs];
  }
  return CandidateSchema.parse(candidate);
}
__name(candidateFromDiagnostic, "candidateFromDiagnostic");
