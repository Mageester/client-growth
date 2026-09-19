// src/core/judgment.ts
var CONFIDENCE_FLOOR = 0.5;
var SELLABLE_SUBJECT_TYPES = /* @__PURE__ */ new Set([
  "distinct_service"
]);
var SUBJECT_TYPE_REASON = {
  distinct_service: "classified as a distinct service",
  trust_signal: "classified as a trust signal, not a service the client sells",
  promotion: "classified as a promotion or sales mechanic, not a service",
  generic_claim: "classified as a generic claim, not a service",
  ambiguous: "could not be confidently classified, so it fails closed",
  conversion_defect: "classified as a conversion defect"
};
function judge(candidate, evaluation) {
  if (evaluation.verdict !== "surface") {
    return { surface: false, reason: "evaluator returned a reject verdict" };
  }
  if (evaluation.commerciallyActionable === false) {
    return { surface: false, reason: "evaluator judged it not commercially actionable" };
  }
  if (candidate.ruleId === "missing-service-page" || candidate.ruleId === "competitor-service-gap") {
    const subjectType = evaluation.subjectType;
    if (subjectType === void 0) {
      return {
        surface: false,
        reason: "evaluator returned no subject classification"
      };
    }
    if (!SELLABLE_SUBJECT_TYPES.has(subjectType)) {
      return { surface: false, reason: SUBJECT_TYPE_REASON[subjectType] };
    }
    if (evaluation.commerciallyActionable !== true) {
      return {
        surface: false,
        reason: "evaluator did not confirm the work is commercially actionable"
      };
    }
  }
  if (evaluation.confidence < CONFIDENCE_FLOOR) {
    return { surface: false, reason: "evidence strength is below the floor" };
  }
  return { surface: true, reason: "distinct, commercially actionable work" };
}
__name(judge, "judge");
