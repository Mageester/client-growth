import type { Candidate, Evaluation, SubjectType } from "@/core/schema";

/**
 * The commercial gate.
 *
 * Deterministic rules prove the FACT ("no page exists for this offering", "this
 * CTA returns 404"). This module decides the separate question the rules cannot
 * answer: is this a legitimate, distinct piece of client work an agency should
 * reasonably consider pitching?
 *
 * It fails closed by construction. A missing-service-page candidate surfaces
 * only when the evaluator POSITIVELY identifies the subject as a distinct
 * service AND commercially actionable. Anything else - a trust signal, a
 * promotion, a generic claim, an ambiguous call, or an evaluator that simply did
 * not answer the question - is rejected. The asymmetry is deliberate: a missed
 * gap costs the agency a quote, a "Fully Insured" landing page priced at
 * $900-$1,800 costs them the client.
 */

/** Evidence-strength floor, applied after the structured gate. */
export const CONFIDENCE_FLOOR = 0.5;

/** Subject types that may become billable missing-service-page work. */
const SELLABLE_SUBJECT_TYPES: ReadonlySet<SubjectType> = new Set<SubjectType>([
  "distinct_service",
]);

export interface JudgmentDecision {
  surface: boolean;
  /** Why, in words an operator can read in a log line. */
  reason: string;
}

const SUBJECT_TYPE_REASON: Record<SubjectType, string> = {
  distinct_service: "classified as a distinct service",
  trust_signal: "classified as a trust signal, not a service the client sells",
  promotion: "classified as a promotion or sales mechanic, not a service",
  generic_claim: "classified as a generic claim, not a service",
  ambiguous: "could not be confidently classified, so it fails closed",
  conversion_defect: "classified as a conversion defect",
};

export function judge(candidate: Candidate, evaluation: Evaluation): JudgmentDecision {
  if (evaluation.verdict !== "surface") {
    return { surface: false, reason: "evaluator returned a reject verdict" };
  }

  if (evaluation.commerciallyActionable === false) {
    return { surface: false, reason: "evaluator judged it not commercially actionable" };
  }

  if (candidate.ruleId === "missing-service-page") {
    const subjectType = evaluation.subjectType;
    if (subjectType === undefined) {
      // Fail closed: an evaluator that does not classify the subject has not
      // done the job this gate exists for.
      return {
        surface: false,
        reason: "evaluator returned no subject classification",
      };
    }
    if (!SELLABLE_SUBJECT_TYPES.has(subjectType)) {
      return { surface: false, reason: SUBJECT_TYPE_REASON[subjectType] };
    }
    if (evaluation.commerciallyActionable !== true) {
      return {
        surface: false,
        reason: "evaluator did not confirm the work is commercially actionable",
      };
    }
  }

  if (evaluation.confidence < CONFIDENCE_FLOOR) {
    return { surface: false, reason: "evidence strength is below the floor" };
  }

  return { surface: true, reason: "distinct, commercially actionable work" };
}
