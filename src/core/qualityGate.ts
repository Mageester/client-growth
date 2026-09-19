import {
  ClaimScopeSchema,
  DiagnosticDraftSchema,
  EvidenceAssessmentSchema,
  type DiagnosticDraft,
} from "@/core/insightSchema";
import { definitionForProblemType } from "@/core/insightTaxonomy";

const GRADE_ORDER = ["strong", "moderate", "limited", "insufficient"] as const;
const COVERAGE_ORDER = ["complete", "partial", "stale", "blocked"] as const;
type Grade = (typeof GRADE_ORDER)[number];
type Coverage = (typeof COVERAGE_ORDER)[number];

function sortedStrings(values: readonly string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left < right ? -1 : left > right ? 1 : 0); }
function boundedPolicyInput(value: unknown): DiagnosticDraft { return DiagnosticDraftSchema.parse(value); }
function coverageState(input: unknown): Coverage {
  if (typeof input === "string" && (COVERAGE_ORDER as readonly string[]).includes(input)) return input as Coverage;
  if (!input || typeof input !== "object") throw new Error("Coverage state is required.");
  const record = input as Record<string, unknown>;
  const candidate = record.state ?? record.coverage;
  if (typeof candidate === "string" && (COVERAGE_ORDER as readonly string[]).includes(candidate)) return candidate as Coverage;
  if (record.complete === true) return "complete";
  if (record.complete === false) return "partial";
  throw new Error("Coverage state is required and cannot be inferred.");
}
function confidenceGrade(confidence: number): Grade { if (confidence >= 0.85) return "strong"; if (confidence >= 0.65) return "moderate"; if (confidence > 0) return "limited"; return "insufficient"; }
function weakerGrade(left: Grade, right: Grade): Grade { return GRADE_ORDER[Math.max(GRADE_ORDER.indexOf(left), GRADE_ORDER.indexOf(right))]!; }
function capGrade(grade: Grade, cap: Grade): Grade { return weakerGrade(grade, cap); }
function claimScopeFor(draft: DiagnosticDraft): "observed" | "supported_inference" | "hypothesis" { if (draft.claimScope) return ClaimScopeSchema.parse(draft.claimScope); return definitionForProblemType(draft.problemType).claimKind === "supported_inference" ? "supported_inference" : "observed"; }
function counterEvidenceStateRank(state: string): number { return { present: 0, checked_none: 1, not_checked: 2, unknown: 3, contradictory: 4 }[state] ?? 4; }
function worstCounterEvidenceState(left: string, right: string): string { return counterEvidenceStateRank(left) >= counterEvidenceStateRank(right) ? left : right; }
function counterEvidenceFor(draft: DiagnosticDraft): { values: string[]; state: "not_checked" | "checked_none" | "present" | "contradictory" | "unknown" } {
  const values = sortedStrings(draft.counterEvidence ?? []);
  const explicitState = draft.counterEvidenceState;
  let state = explicitState ?? (values.length > 0 ? "present" : "not_checked");
  let derivedState: typeof state | undefined;
  if (draft.details?.kind === "verification") {
    const verification = draft.details.verification;
    const closeMatches = verification.closeMatches.map((match) => match.satisfied ? `Existing matching evidence: ${match.value}` : `Rejected near-match evidence: ${match.value}`);
    if (closeMatches.length > 0) { values.push(...closeMatches); derivedState = verification.closeMatches.some((match) => match.satisfied) ? "contradictory" : "present"; }
    else if (verification.inspectedUrls.length > 0) derivedState = verification.conclusion === "absent" ? "checked_none" : "unknown";
    else if (verification.conclusion === "present") { derivedState = "contradictory"; values.push("Verification concluded that matching evidence is present."); }
    else if (verification.conclusion === "inconclusive" || verification.conclusion === "weak") derivedState = "unknown";
  }
  if (derivedState) state = explicitState ? worstCounterEvidenceState(explicitState, derivedState) as typeof state : values.length > 0 ? worstCounterEvidenceState(state, derivedState) as typeof state : derivedState;
  return { values: state === "checked_none" || state === "not_checked" ? [] : sortedStrings(values), state: state as "not_checked" | "checked_none" | "present" | "contradictory" | "unknown" };
}

export function assessDiagnostic(draftInput: unknown, coverageInput: unknown, resolutionInput: { ids: string[]; unresolved: string[] }) {
  const draft = boundedPolicyInput(draftInput);
  const definition = definitionForProblemType(draft.problemType);
  const coverage = coverageState(coverageInput);
  const ids = sortedStrings(resolutionInput.ids);
  const unresolved = sortedStrings(resolutionInput.unresolved);
  if (ids.some((id) => unresolved.includes(id))) throw new Error("Evidence resolution cannot resolve and leave unresolved.");
  const counterEvidence = counterEvidenceFor(draft);
  const claimScope = claimScopeFor(draft);
  let grade = confidenceGrade(draft.rawConfidence);
  const limitations: string[] = [];
  const unassessedEvidence: string[] = [];
  const coverageRecord = typeof coverageInput === "object" && coverageInput !== null ? coverageInput as Record<string, unknown> : {};
  if (Array.isArray(coverageRecord.limitations)) limitations.push(...coverageRecord.limitations.filter((item): item is string => typeof item === "string"));
  if (typeof coverageRecord.reason === "string" && coverageRecord.reason.trim()) limitations.push(coverageRecord.reason.trim());
  if (Array.isArray(coverageRecord.unassessedEvidence)) unassessedEvidence.push(...coverageRecord.unassessedEvidence.filter((item): item is string => typeof item === "string"));
  if (draft.state !== "observed") { limitations.push(`Diagnostic state is ${draft.state}; the condition was not fully observed.`); grade = capGrade(grade, "limited"); }
  if (coverage === "partial" && definition.requiresCompleteCoverage) { limitations.push("Partial coverage cannot support an absence claim."); grade = capGrade(grade, "limited"); }
  else if (coverage === "blocked") { limitations.push("Coverage was blocked before the required evidence could be assessed."); grade = capGrade(grade, "limited"); }
  else if (coverage === "stale") { limitations.push("The available evidence is stale and needs a current read."); grade = capGrade(grade, "limited"); }
  if (unresolved.length > 0) { limitations.push(`Unresolved ledger evidence references: ${unresolved.join(", ")}.`); unassessedEvidence.push(...unresolved); grade = capGrade(grade, "limited"); }
  if (draft.legacyEvidenceRefs.length > 0 && ids.length === 0) { limitations.push("No cited evidence reference resolved in the current ledger."); grade = capGrade(grade, "limited"); }
  if (draft.legacyEvidenceRefs.length === 0) { limitations.push("The diagnostic cites no evidence reference."); grade = "insufficient"; }
  if (definition.requiresCounterEvidence) { if (counterEvidence.state === "contradictory") { limitations.push("Counter-evidence conflicts with the diagnostic condition."); grade = "insufficient"; } else if (counterEvidence.state === "not_checked" || counterEvidence.state === "unknown") { limitations.push("Required counter-evidence was not recorded."); grade = capGrade(grade, "limited"); } }
  if (counterEvidence.state === "unknown") { limitations.push("Counter-evidence could not be assessed."); grade = capGrade(grade, "limited"); }
  if (claimScope === "hypothesis") limitations.push("Hypothesis claims are not publishable as supported evidence.");
  return EvidenceAssessmentSchema.parse({ grade, claimScope, coverage, limitations: sortedStrings(limitations), counterEvidence: counterEvidence.values, counterEvidenceState: counterEvidence.state, unassessedEvidence: sortedStrings(unassessedEvidence) });
}

export function qualityGateForDiagnostic(draftInput: unknown, assessment: unknown): "supported" | "limited" | "rejected" {
  const draft = boundedPolicyInput(draftInput);
  const parsedAssessment = EvidenceAssessmentSchema.parse(assessment);
  const definition = definitionForProblemType(draft.problemType);
  const minimum = GRADE_ORDER.indexOf(definition.minimumGrade as Grade);
  const actual = GRADE_ORDER.indexOf(parsedAssessment.grade as Grade);
  if (parsedAssessment.claimScope === "hypothesis" || parsedAssessment.counterEvidenceState === "contradictory" || parsedAssessment.grade === "insufficient") return "rejected";
  if (actual > minimum || (definition.requiresCompleteCoverage && parsedAssessment.coverage !== "complete") || draft.state !== "observed" || parsedAssessment.unassessedEvidence.length > 0 || (definition.requiresCounterEvidence && parsedAssessment.counterEvidenceState !== "checked_none" && parsedAssessment.counterEvidenceState !== "present")) return "limited";
  return "supported";
}
export function weakestEvidenceGrade(grades: readonly Grade[]): Grade { return grades.length === 0 ? "insufficient" : grades.reduce((weakest, grade) => weakerGrade(weakest, grade), "strong"); }
export function weakestCoverage(coverages: readonly Coverage[]): Coverage { return coverages.length === 0 ? "blocked" : coverages.reduce((weakest, coverage) => COVERAGE_ORDER.indexOf(coverage) > COVERAGE_ORDER.indexOf(weakest) ? coverage : weakest, "complete" as Coverage); }
export function parseQualityDiagnostic(value: unknown): DiagnosticDraft { return boundedPolicyInput(value); }
