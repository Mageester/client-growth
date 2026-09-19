import { ConversionDefectSchema, CandidateSchema, VerificationSchema, type Candidate, type Service } from "@/core/schema";
import { definitionForProblemType } from "@/core/insightTaxonomy";
import type { DiagnosticDraft } from "@/core/insightSchema";
import { RULE_SERVICE_LINKS, serviceForRule } from "@/core/rules/registry";

/**
 * Adapt a typed diagnostic back to the legacy candidate contract used by the
 * opportunity pipeline. Non-observed, broad, and unpriceable diagnostics are
 * intentionally not candidates.
 */
export function candidateFromDiagnostic(draft: DiagnosticDraft, catalog: Service[]): Candidate | null {
  if (draft.state !== "observed") return null;
  if (draft.details?.kind === "broad") return null;
  const legacyRuleId = definitionForProblemType(draft.problemType).legacyRuleId;
  if (legacyRuleId === null) return null;
  const link = RULE_SERVICE_LINKS.find((entry) => entry.ruleId === legacyRuleId);
  if (!link) return null;
  const match = serviceForRule(catalog, link.tag);
  if (!match) return null;

  const candidate: Record<string, unknown> = {
    ruleId: legacyRuleId,
    subject: draft.subject.key,
    detected: draft.observation,
    evidenceRefs: [...draft.legacyEvidenceRefs],
    rawConfidence: draft.rawConfidence,
    suggestedServiceId: match.id,
  };
  if (draft.details?.kind === "verification") {
    candidate.verification = VerificationSchema.parse(draft.details.verification);
  }
  if (draft.details?.kind === "conversion_defect") {
    candidate.conversionDefect = ConversionDefectSchema.parse(draft.details.conversionDefect);
  }
  const suppressedEvidenceRefs = draft.details?.kind === "legacy" ? draft.details.suppressedEvidenceRefs : undefined;
  if (suppressedEvidenceRefs !== undefined) candidate.suppressedEvidenceRefs = [...suppressedEvidenceRefs];
  return CandidateSchema.parse(candidate);
}
