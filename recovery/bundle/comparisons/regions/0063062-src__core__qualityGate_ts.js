// src/core/qualityGate.ts
var GRADE_ORDER = [
  "strong",
  "moderate",
  "limited",
  "insufficient"
];
var COVERAGE_ORDER = ["complete", "partial", "stale", "blocked"];
function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
__name(compareStrings, "compareStrings");
function uniqueStrings2(values) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
__name(uniqueStrings2, "uniqueStrings");
function sortedStrings(values) {
  return uniqueStrings2(values).sort(compareStrings);
}
__name(sortedStrings, "sortedStrings");
function boundedPolicyInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Diagnostic draft must be an object.");
  }
  return DiagnosticDraftSchema.parse(value);
}
__name(boundedPolicyInput, "boundedPolicyInput");
function coverageState(input) {
  if (typeof input === "string") {
    if (COVERAGE_ORDER.includes(input)) return input;
    throw new Error(`Unknown coverage state: ${input}`);
  }
  if (!input || typeof input !== "object") throw new Error("Coverage state is required.");
  const candidate = input.state ?? input.coverage;
  if (typeof candidate === "string" && COVERAGE_ORDER.includes(candidate)) {
    return candidate;
  }
  if (input.complete === true) return "complete";
  if (input.complete === false) return "partial";
  throw new Error("Coverage state is required and cannot be inferred.");
}
__name(coverageState, "coverageState");
function confidenceGrade(confidence) {
  if (confidence >= 0.85) return "strong";
  if (confidence >= 0.65) return "moderate";
  if (confidence > 0) return "limited";
  return "insufficient";
}
__name(confidenceGrade, "confidenceGrade");
function weakerGrade(left, right) {
  return GRADE_ORDER[Math.max(GRADE_ORDER.indexOf(left), GRADE_ORDER.indexOf(right))];
}
__name(weakerGrade, "weakerGrade");
function capGrade(grade, cap) {
  return GRADE_ORDER[Math.max(GRADE_ORDER.indexOf(grade), GRADE_ORDER.indexOf(cap))];
}
__name(capGrade, "capGrade");
function claimScopeFor(draft) {
  if (draft.claimScope === "observed" || draft.claimScope === "supported_inference" || draft.claimScope === "hypothesis") {
    return draft.claimScope;
  }
  const definition3 = definitionForProblemType(draft.problemType);
  return definition3.claimKind === "supported_inference" ? "supported_inference" : "observed";
}
__name(claimScopeFor, "claimScopeFor");
function counterEvidenceStateRank(state) {
  return {
    present: 0,
    checked_none: 1,
    not_checked: 2,
    unknown: 3,
    contradictory: 4
  }[state];
}
__name(counterEvidenceStateRank, "counterEvidenceStateRank");
function worstCounterEvidenceState(left, right) {
  return counterEvidenceStateRank(left) >= counterEvidenceStateRank(right) ? left : right;
}
__name(worstCounterEvidenceState, "worstCounterEvidenceState");
function counterEvidenceFor(draft) {
  const values = sortedStrings(draft.counterEvidence ?? []);
  const explicitState = draft.counterEvidenceState;
  let state = explicitState ?? (values.length > 0 ? "present" : "not_checked");
  let derivedState;
  if (draft.details?.kind === "verification") {
    const verification = draft.details.verification;
    const closeMatches = verification.closeMatches.map(
      (match) => match.satisfied ? `Existing matching evidence: ${match.value}` : `Rejected near-match evidence: ${match.value}`
    );
    if (closeMatches.length > 0) {
      values.push(...closeMatches);
      derivedState = verification.closeMatches.some((match) => match.satisfied) ? "contradictory" : "present";
    } else if (verification.inspectedUrls.length > 0) {
      derivedState = verification.conclusion === "absent" ? "checked_none" : "unknown";
    } else if (verification.conclusion === "present") {
      derivedState = "contradictory";
      values.push(`Verification concluded that matching evidence is present.`);
    } else if (verification.conclusion === "inconclusive" || verification.conclusion === "weak") {
      derivedState = "unknown";
    }
  }
  if (derivedState) {
    state = explicitState ? worstCounterEvidenceState(explicitState, derivedState) : values.length > 0 ? worstCounterEvidenceState(state, derivedState) : derivedState;
  }
  if (state === "checked_none" || state === "not_checked") return { values: [], state };
  return { values: sortedStrings(values), state };
}
__name(counterEvidenceFor, "counterEvidenceFor");
function resolutionValues(resolution) {
  if (!resolution || !Array.isArray(resolution.ids) || !Array.isArray(resolution.unresolved)) {
    throw new Error("Diagnostic evidence resolution must contain ids and unresolved arrays.");
  }
  const ids = sortedStrings(resolution.ids);
  const unresolved = sortedStrings(resolution.unresolved);
  const overlap = ids.find((id) => unresolved.includes(id));
  if (overlap) throw new Error(`Evidence resolution cannot resolve and leave unresolved: ${overlap}`);
  return { ids, unresolved };
}
__name(resolutionValues, "resolutionValues");
function assessDiagnostic(draftInput, coverageInput3, resolutionInput) {
  const draft = boundedPolicyInput(draftInput);
  const definition3 = definitionForProblemType(draft.problemType);
  const coverage = coverageState(coverageInput3);
  const resolution = resolutionValues(resolutionInput);
  const counterEvidence = counterEvidenceFor(draft);
  const claimScope = claimScopeFor(draft);
  let grade = confidenceGrade(draft.rawConfidence);
  const limitations = [];
  const unassessedEvidence = [];
  const externalLimitations = typeof coverageInput3 === "object" && Array.isArray(coverageInput3.limitations) ? coverageInput3.limitations.filter((item) => typeof item === "string") : [];
  limitations.push(...externalLimitations);
  if (typeof coverageInput3 === "object" && typeof coverageInput3.reason === "string" && coverageInput3.reason.trim()) {
    limitations.push(coverageInput3.reason.trim());
  }
  if (typeof coverageInput3 === "object" && Array.isArray(coverageInput3.unassessedEvidence)) {
    unassessedEvidence.push(
      ...coverageInput3.unassessedEvidence.filter((item) => typeof item === "string")
    );
  }
  if (draft.state !== "observed") {
    limitations.push(`Diagnostic state is ${draft.state}; the condition was not fully observed.`);
    grade = capGrade(grade, "limited");
  }
  if (coverage === "partial") {
    if (definition3.requiresCompleteCoverage) {
      limitations.push("Partial coverage cannot support an absence claim.");
      grade = capGrade(grade, "limited");
    }
  } else if (coverage === "blocked") {
    limitations.push("Coverage was blocked before the required evidence could be assessed.");
    grade = capGrade(grade, "limited");
  } else if (coverage === "stale") {
    limitations.push("The available evidence is stale and needs a current read.");
    grade = capGrade(grade, "limited");
  }
  if (resolution.unresolved.length > 0) {
    limitations.push(
      `Unresolved ledger evidence references: ${resolution.unresolved.join(", ")}.`
    );
    unassessedEvidence.push(...resolution.unresolved);
    grade = capGrade(grade, "limited");
  }
  if (draft.legacyEvidenceRefs.length > 0 && resolution.ids.length === 0) {
    limitations.push("No cited evidence reference resolved in the current ledger.");
    grade = capGrade(grade, "limited");
  }
  if (draft.legacyEvidenceRefs.length === 0) {
    limitations.push("The diagnostic cites no evidence reference.");
    grade = "insufficient";
  }
  if (definition3.requiresCounterEvidence) {
    if (counterEvidence.state === "contradictory") {
      limitations.push("Counter-evidence conflicts with the diagnostic condition.");
      grade = "insufficient";
    } else if (counterEvidence.state === "not_checked" || counterEvidence.state === "unknown") {
      limitations.push("Required counter-evidence was not recorded.");
      grade = capGrade(grade, "limited");
    }
  }
  if (counterEvidence.state === "unknown") {
    limitations.push("Counter-evidence could not be assessed.");
    grade = capGrade(grade, "limited");
  }
  if (claimScope === "hypothesis") {
    limitations.push("Hypothesis claims are not publishable as supported evidence.");
  }
  return EvidenceAssessmentSchema.parse({
    grade,
    claimScope,
    coverage,
    limitations: sortedStrings(limitations),
    counterEvidence: counterEvidence.values,
    counterEvidenceState: counterEvidence.state,
    unassessedEvidence: sortedStrings(unassessedEvidence)
  });
}
__name(assessDiagnostic, "assessDiagnostic");
function qualityGateForDiagnostic(draftInput, assessment) {
  const draft = boundedPolicyInput(draftInput);
  const parsedAssessment = EvidenceAssessmentSchema.parse(assessment);
  const definition3 = definitionForProblemType(draft.problemType);
  const minimum = GRADE_ORDER.indexOf(definition3.minimumGrade);
  const actual = GRADE_ORDER.indexOf(parsedAssessment.grade);
  if (parsedAssessment.claimScope === "hypothesis") return "rejected";
  if (parsedAssessment.counterEvidenceState === "contradictory") return "rejected";
  if (parsedAssessment.grade === "insufficient") return "rejected";
  if (actual > minimum) return "limited";
  if (definition3.requiresCompleteCoverage && parsedAssessment.coverage !== "complete") return "limited";
  if (draft.state !== "observed") return "limited";
  if (parsedAssessment.unassessedEvidence.length > 0) return "limited";
  if (definition3.requiresCounterEvidence && parsedAssessment.counterEvidenceState !== "checked_none" && parsedAssessment.counterEvidenceState !== "present") {
    return "limited";
  }
  return "supported";
}
__name(qualityGateForDiagnostic, "qualityGateForDiagnostic");
function weakestEvidenceGrade(grades) {
  if (grades.length === 0) return "insufficient";
  return grades.reduce((weakest, grade) => weakerGrade(weakest, grade), "strong");
}
__name(weakestEvidenceGrade, "weakestEvidenceGrade");
function weakestCoverage(coverages) {
  if (coverages.length === 0) return "blocked";
  return coverages.reduce(
    (weakest, coverage) => COVERAGE_ORDER.indexOf(coverage) > COVERAGE_ORDER.indexOf(weakest) ? coverage : weakest,
    "complete"
  );
}
__name(weakestCoverage, "weakestCoverage");
function parseQualityDiagnostic(value) {
  return boundedPolicyInput(value);
}
__name(parseQualityDiagnostic, "parseQualityDiagnostic");
