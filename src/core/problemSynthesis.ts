import {
  DiagnosticDraftSchema,
  DiagnosticSchema,
  EvidenceAssessmentSchema,
  EvidenceRefSchema,
  ProblemSchema,
  type Diagnostic,
} from "@/core/insightSchema";
import { definitionForProblemType } from "@/core/insightTaxonomy";
import { resolveLegacyEvidenceRefs } from "@/core/evidenceLedger";
import { diagnosticSubjectIdentity, canonicalSubjectLocator } from "@/core/diagnosticIdentity";
import { documentIdentity } from "@/core/pageIdentity";
import { assessDiagnostic, qualityGateForDiagnostic, weakestCoverage, weakestEvidenceGrade } from "@/core/qualityGate";
import { CriticDecisionSchema, ProblemDraftSchema, validateCriticDecisions } from "@/core/siteUnderstandingSchema";

export const MAX_ID_LENGTH = 200;
export function boundedIdentity(value: string, label: string): string { const trimmed = value.trim(); if (!trimmed || trimmed.length > MAX_ID_LENGTH) throw new Error(`${label} must be a non-empty bounded identity.`); return trimmed; }
export function fnv1a64(value: string): string { let hash = 0xcbf29ce484222325n; for (let index = 0; index < value.length; index += 1) { hash ^= BigInt(value.charCodeAt(index)); hash = BigInt.asUintN(64, hash * 0x100000001b3n); } return hash.toString(16).padStart(16, "0"); }
function compareStrings(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
export function uniqueStrings(values: readonly string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
export function sortedStrings(values: readonly string[]): string[] { return uniqueStrings(values).sort(compareStrings); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => compareStrings(left, right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`; return JSON.stringify(value); }

export function assertShadowArtifacts(input: { workspaceId: string; runId: string; clientId: string; evidence: readonly unknown[]; diagnostics: readonly unknown[]; drafts?: readonly unknown[]; criticDecisions?: readonly unknown[] }): void {
  const drafts = (input.drafts ?? []).map((draft) => ProblemDraftSchema.parse(draft));
  const decisions = (input.criticDecisions ?? []).map((decision) => CriticDecisionSchema.parse(decision));
  const evidenceIds = new Set(input.evidence.map((entry) => EvidenceRefSchema.parse(entry).id));
  const diagnosticValues = input.diagnostics.map((diagnostic) => DiagnosticSchema.parse(diagnostic));
  const diagnosticIds = new Set(diagnosticValues.map((diagnostic) => diagnostic.id));
  for (const evidence of input.evidence) if (EvidenceRefSchema.parse(evidence).runId !== input.runId) throw new Error("Shadow evidence crosses the accepted run boundary.");
  for (const diagnostic of diagnosticValues) if (diagnostic.workspaceId !== input.workspaceId || diagnostic.runId !== input.runId || diagnostic.clientId !== input.clientId) throw new Error("Shadow diagnostics cross the accepted workspace, run, or client boundary.");
  const draftIds = new Set<string>();
  for (const draft of drafts) { if (draft.clientId !== input.clientId) throw new Error("Shadow problem draft crosses the accepted client boundary."); if (draftIds.has(draft.draftId)) throw new Error("Shadow problem draft IDs must be unique."); draftIds.add(draft.draftId); if (draft.diagnosticIds.some((id) => !diagnosticIds.has(id))) throw new Error("Shadow problem draft references an unknown diagnostic."); if (draft.evidenceIds.some((id) => !evidenceIds.has(id))) throw new Error("Shadow problem draft references unknown evidence."); }
  if (decisions.length > 0) validateCriticDecisions(decisions, drafts, input.evidence);
}

function displayLocator(value: string): string { try { const parsed = new URL(value.trim()); if (parsed.protocol === "http:" || parsed.protocol === "https:") return canonicalSubjectLocator(parsed.toString()); } catch { /* keep value */ } return value.trim(); }
function hostOf(value: string): string { try { return new URL(value).hostname.toLowerCase(); } catch { return canonicalSubjectLocator(value); } }
function fingerprintFor(draft: ReturnType<typeof DiagnosticDraftSchema.parse>): string { return [draft.detectorId.trim().toLowerCase(), draft.detectorVersion.trim().toLowerCase(), draft.problemType, draft.subject.kind, diagnosticSubjectIdentity(draft.subject), draft.observation.trim().replace(/\s+/g, " ").toLowerCase()].join("|"); }
function assertNoCrossIdentity(value: unknown, identities: { workspaceId: string; runId: string; clientId: string }, label: string): void { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Diagnostic draft must be an object."); const record = value as Record<string, unknown>; for (const key of ["workspaceId", "runId", "clientId"]) if (record[key] !== undefined && record[key] !== identities[key as keyof typeof identities]) throw new Error(`${label} has a cross-${key} identity.`); }
function assertLedger(ledger: readonly unknown[], runId: string) { const records = ledger.map((record) => EvidenceRefSchema.parse(record)); for (const record of records) if (record.runId !== runId) throw new Error("Evidence ledger has a cross-run identity."); const byId = new Map<string, string>(); for (const record of records) { const tuple = `${record.runId}|${record.kind}|${record.locator}`; const previous = byId.get(record.id); if (previous && previous !== tuple) throw new Error(`Evidence ID collision for ${record.id}.`); byId.set(record.id, tuple); } return records; }
function pageUrlFromValue(value: string): string | undefined { try { const parsed = new URL(value.trim()); if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined; return canonicalSubjectLocator(parsed.toString()); } catch { return undefined; } }
function affectedPagesFromResolution(ledger: ReturnType<typeof assertLedger>, resolution: { ids: string[] }, details: ReturnType<typeof DiagnosticDraftSchema.parse>["details"]): string[] { const ids = new Set(resolution.ids); const pages: string[] = []; for (const record of ledger) if (ids.has(record.id) && record.kind === "page") { if (record.pageUrl) pages.push(record.pageUrl); pages.push(record.locator); } if (details?.kind === "conversion_defect") pages.push(details.conversionDefect.pageUrl, ...details.conversionDefect.seenOn); return sortedStrings(pages.map(pageUrlFromValue).filter((page): page is string => page !== undefined)).slice(0, 1_000); }

export function materializeDiagnostics(input: { workspaceId: string; runId: string; clientId: string; coverage: unknown; drafts: readonly unknown[]; ledger: readonly unknown[] }): Diagnostic[] {
  const workspaceId = boundedIdentity(input.workspaceId, "workspaceId"); const runId = boundedIdentity(input.runId, "runId"); const clientId = boundedIdentity(input.clientId, "clientId"); const ledger = assertLedger(input.ledger, runId); const byFingerprint = new Map<string, Array<{ draft: ReturnType<typeof DiagnosticDraftSchema.parse>; resolution: { ids: string[]; unresolved: string[] } }>>();
  for (const raw of input.drafts) { assertNoCrossIdentity(raw, { workspaceId, runId, clientId }, "Diagnostic draft"); const draft = DiagnosticDraftSchema.parse(raw); const resolution = resolveLegacyEvidenceRefs(ledger, draft.legacyEvidenceRefs); const fingerprint = fingerprintFor(draft); byFingerprint.set(fingerprint, [...(byFingerprint.get(fingerprint) ?? []), { draft, resolution }]); }
  const materialized: Diagnostic[] = [];
  for (const fingerprint of [...byFingerprint.keys()].sort(compareStrings)) {
    const entries = byFingerprint.get(fingerprint)!; const first = entries[0]!.draft; const merged = { ...first, state: entries.some((entry) => entry.draft.state === "blocked") ? "blocked" : entries.some((entry) => entry.draft.state !== "observed") ? "unknown" : "observed", rawConfidence: Math.min(...entries.map((entry) => entry.draft.rawConfidence)), legacyEvidenceRefs: sortedStrings(entries.flatMap((entry) => entry.draft.legacyEvidenceRefs)), counterEvidence: sortedStrings(entries.flatMap((entry) => entry.draft.counterEvidence ?? [])), counterEvidenceState: entries.some((entry) => entry.draft.counterEvidenceState === "contradictory") ? "contradictory" : first.counterEvidenceState };
    const resolution = { ids: sortedStrings(entries.flatMap((entry) => entry.resolution.ids)), unresolved: sortedStrings(entries.flatMap((entry) => entry.resolution.unresolved)) };
    const assessment = assessDiagnostic(merged, input.coverage, resolution);
    const definition = definitionForProblemType(merged.problemType);
    const state = definition.requiresCompleteCoverage && assessment.coverage !== "complete" && merged.state === "observed" ? "unknown" : merged.state;
    materialized.push(DiagnosticSchema.parse({ id: `diag_${fnv1a64(`${runId}|${fingerprint}`)}`, workspaceId, runId, clientId, detectorId: merged.detectorId, detectorVersion: merged.detectorVersion, category: merged.category, problemType: merged.problemType, subject: merged.subject, observation: merged.observation, evidenceRefs: resolution.ids, assessment, state, fingerprint: `fp_${fnv1a64(fingerprint)}`, affectedPages: affectedPagesFromResolution(ledger, resolution, merged.details), ...(merged.origin ? { origin: merged.origin } : {}), ...(merged.details ? { details: merged.details } : {}), createdAt: `run:${runId}` }));
  }
  return materialized.sort((left, right) => compareStrings(left.id, right.id));
}

/** Convert internal evidence-key syntax into customer-readable prose. */
export function sanitizeCustomerObservation(observation: string): string {
  return observation
    .replace(/\b(?:cta|input|form|accessibility|rendered-element|form-field|landmark|section):[^\s.,;)]+/gi, "the control")
    .replace(/\bmissing-accessible-names?\b/gi, "no accessible name")
    .replace(/\bmissing-labels?\b/gi, "no label")
    .replace(/\bempty-labels?\b/gi, "an empty label")
    .replace(/\bmissing-alts?\b/gi, "no text alternative")
    .replace(/\binvalid-aria-references?\b/gi, "an invalid aria reference")
    .replace(/\btyped accessibility observations?\b/gi, "accessibility evidence")
    .replace(/\s+/g, " ")
    .trim();
}

function rootKey(diagnostic: Diagnostic): string { const definition = definitionForProblemType(diagnostic.problemType); if (diagnostic.details?.kind === "conversion_defect") return diagnostic.details.conversionDefect.target ? `target:${canonicalSubjectLocator(diagnostic.details.conversionDefect.target)}` : `page:${canonicalSubjectLocator(diagnostic.details.conversionDefect.pageUrl)}`; if (definition.category === "technical_reliability" || definition.category === "accessibility_usability") return `rule:${diagnostic.detectorId.toLowerCase()}:${hostOf(diagnostic.subject.key)}`; return `${diagnostic.subject.kind}:${canonicalSubjectLocator(diagnostic.subject.key)}`; }
export function compatibleGroupKey(diagnostic: Diagnostic): string { return [diagnostic.category, diagnostic.problemType, rootKey(diagnostic)].join("|"); }
export function assertCompatibleDiagnostics(diagnostics: readonly Diagnostic[]): void { if (diagnostics.length === 0) return; const first = diagnostics[0]!; for (const diagnostic of diagnostics) { if (diagnostic.workspaceId !== first.workspaceId) throw new Error("Diagnostics cross workspace boundary."); if (diagnostic.runId !== first.runId) throw new Error("Diagnostics cross run boundary."); if (diagnostic.clientId !== first.clientId) throw new Error("Diagnostics cross client boundary."); } }
export function problemKey(diagnostics: readonly Diagnostic[]): string { if (diagnostics.length === 0) throw new Error("Cannot derive a problem key without diagnostics."); assertCompatibleDiagnostics(diagnostics); const first = diagnostics[0]!; const key = compatibleGroupKey(first); if (diagnostics.some((diagnostic) => compatibleGroupKey(diagnostic) !== key)) throw new Error("Problem key requires compatible diagnostics."); return [first.clientId, first.category, first.problemType, rootKey(first)].join("|"); }
function policyInputForDiagnostic(diagnostic: Diagnostic) { return { detectorId: diagnostic.detectorId, detectorVersion: diagnostic.detectorVersion, category: diagnostic.category, problemType: diagnostic.problemType, subject: diagnostic.subject, observation: diagnostic.observation, legacyEvidenceRefs: diagnostic.evidenceRefs, rawConfidence: diagnostic.assessment.grade === "strong" ? 0.95 : diagnostic.assessment.grade === "moderate" ? 0.75 : 0.45, state: diagnostic.state, ...(diagnostic.details ? { details: diagnostic.details } : {}), claimScope: diagnostic.assessment.claimScope, counterEvidence: diagnostic.assessment.counterEvidence, counterEvidenceState: diagnostic.assessment.counterEvidenceState }; }
function combineAssessments(diagnostics: readonly Diagnostic[]) {
  const claimScope: "observed" | "supported_inference" | "hypothesis" = diagnostics.some((diagnostic) => diagnostic.assessment.claimScope === "hypothesis")
    ? "hypothesis"
    : diagnostics.some((diagnostic) => diagnostic.assessment.claimScope === "supported_inference")
      ? "supported_inference"
      : "observed";
  const counterEvidenceState = diagnostics.some((diagnostic) => diagnostic.assessment.counterEvidenceState === "contradictory")
    ? "contradictory"
    : diagnostics.some((diagnostic) => diagnostic.assessment.counterEvidenceState === "unknown")
      ? "unknown"
      : "checked_none";
  return EvidenceAssessmentSchema.parse({
    grade: weakestEvidenceGrade(diagnostics.map((diagnostic) => diagnostic.assessment.grade as "strong" | "moderate" | "limited" | "insufficient")),
    claimScope,
    coverage: weakestCoverage(diagnostics.map((diagnostic) => diagnostic.assessment.coverage as "complete" | "partial" | "stale" | "blocked")),
    limitations: sortedStrings(diagnostics.flatMap((diagnostic) => diagnostic.assessment.limitations)),
    counterEvidence: sortedStrings(diagnostics.flatMap((diagnostic) => diagnostic.assessment.counterEvidence)),
    counterEvidenceState,
    unassessedEvidence: sortedStrings(diagnostics.flatMap((diagnostic) => diagnostic.assessment.unassessedEvidence)),
  });
}
function safeWhyItMatters(problemType: string, claimScope: string): string { if (claimScope === "hypothesis") return "This item is retained for audit only; manual validation is required before any condition is stated."; const values: Record<string, string> = { broken_conversion_path: "A visitor using the recorded path may encounter the observed defect.", visual_conversion_obstacle: "A visitor using the captured viewport may encounter the recorded obstruction.", missing_service_path: "The inspected service path does not expose the requested offering in the available evidence.", no_service_section: "The inspected service path does not expose the requested offering in the available evidence.", missing_image_text_alternative: "People who cannot see the image are given no equivalent text for it.", broken_internal_link: "A visitor following the recorded link reaches a failure instead of the page it names.", thin_service_content: "A visitor deciding whether to enquire has very little on the page describing the service." }; return values[problemType] ?? "The supplied evidence records a site condition that can be checked again after a bounded change."; }
function safeBusinessConsequence(problemType: string, claimScope: string): string { if (claimScope === "hypothesis") return "No business consequence is claimed from this hypothesis."; if (problemType === "broken_conversion_path") return "A visitor using the recorded conversion path may be unable to reach its target."; return "The recorded condition should be validated against the current site and client context."; }
function validationSteps(problemType: string): string[] { if (problemType === "broken_conversion_path") return ["Open the recorded target and confirm the link or form response."]; if (problemType === "missing_service_path" || problemType === "no_service_section") return ["Review the requested service path and re-run the bounded crawl."]; return ["Re-run the crawl and verify the recorded page condition is resolved."]; }

export interface SynthesizeProblemsInput { workspaceId: string; runId: string; clientId: string; diagnostics: readonly unknown[]; }
export function synthesizeProblems(input: SynthesizeProblemsInput) {
  const workspaceId = boundedIdentity(input.workspaceId, "workspaceId"); const runId = boundedIdentity(input.runId, "runId"); const clientId = boundedIdentity(input.clientId, "clientId"); const byId = new Map<string, Diagnostic>();
  for (const raw of input.diagnostics) { const diagnostic = DiagnosticSchema.parse(raw); if (diagnostic.workspaceId !== workspaceId || diagnostic.runId !== runId || diagnostic.clientId !== clientId) throw new Error("Diagnostic crosses workspace, run, or client boundary."); const prior = byId.get(diagnostic.id); if (prior && stableJson(prior) !== stableJson(diagnostic)) throw new Error(`Diagnostic ID conflict for ${diagnostic.id}.`); byId.set(diagnostic.id, diagnostic); }
  const groups = new Map<string, Diagnostic[]>(); for (const diagnostic of byId.values()) groups.set(compatibleGroupKey(diagnostic), [...(groups.get(compatibleGroupKey(diagnostic)) ?? []), diagnostic]);
  const problems = []; const problemIds = new Map<string, string>();
  for (const key of [...groups.keys()].sort(compareStrings)) {
    const group = groups.get(key)!.sort((left, right) => compareStrings(left.id, right.id)); const assessment = combineAssessments(group); const gates = group.map((diagnostic) => qualityGateForDiagnostic(policyInputForDiagnostic(diagnostic), diagnostic.assessment)); const qualityGate = gates.includes("rejected") || assessment.claimScope === "hypothesis" ? "rejected" : gates.includes("limited") ? "limited" : "supported"; const canonicalKey = problemKey(group); const problemId = `problem_${fnv1a64(`${runId}|${canonicalKey}`)}`; if (problemIds.has(problemId) && problemIds.get(problemId) !== canonicalKey) throw new Error(`Problem ID collision for ${problemId}.`); problemIds.set(problemId, canonicalKey); const rejectionReasons = qualityGate === "supported" ? [] : assessment.limitations.length > 0 ? assessment.limitations : ["The evidence is limited by the subtype policy."]; const first = group[0]!; problems.push(ProblemSchema.parse({ id: problemId, workspaceId, runId, clientId, canonicalKey, category: first.category, problemType: first.problemType, surfaceKey: rootKey(first), statement: first.observation.trim().slice(0, 10_000), whyItMatters: safeWhyItMatters(first.problemType, assessment.claimScope), businessConsequence: safeBusinessConsequence(first.problemType, assessment.claimScope), diagnosticIds: sortedStrings(group.map((diagnostic) => diagnostic.id)), evidenceRefs: sortedStrings(group.flatMap((diagnostic) => diagnostic.evidenceRefs)), affectedPages: sortedStrings(group.flatMap((diagnostic) => diagnostic.affectedPages)), assessment, validationSteps: validationSteps(first.problemType), qualityGate, rejectionReasons: sortedStrings(rejectionReasons), createdAt: `run:${runId}` }));
  }
  return problems.sort((left, right) => compareStrings(left.canonicalKey, right.canonicalKey));
}
