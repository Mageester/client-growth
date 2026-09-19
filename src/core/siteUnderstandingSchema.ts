import { z } from "zod";
import {
  INSIGHT_CATEGORIES,
  MODEL_ANCHORED_PROBLEM_TYPES,
  ProblemPrioritySchema,
  definitionForProblemType,
} from "@/core/insightTaxonomy";
import {
  AnalysisCategoryAssessmentSchema,
  ClaimScopeSchema,
  DiagnosticSchema,
  EvidenceRefSchema,
  InsightCategorySchema,
  ProblemTypeSchema,
} from "@/core/insightSchema";

const boundedId = z.string().trim().min(1).max(200);
const boundedKey = z.string().trim().min(1).max(200)
  .refine((value) => !/[<>]/.test(value), "Keys cannot contain markup.")
  .refine((value) => !/(?:https?:|www\.|\/\/|mailto:|tel:)/i.test(value), "Keys must reference supplied IDs rather than URLs.");
const boundedText = z.string().trim().min(1).max(5_000);
const boundedShortText = z.string().trim().min(1).max(500);
const boundedStringList = (maxItems: number, maxLength = 500) => z.array(z.string().trim().min(1).max(maxLength)).max(maxItems);

const unsafeUrl = /(?:https?:\/\/|www\.|\/\/|mailto:|tel:)[^\s<>{}"']+/i;
const markup = /[<>]/;
const commercialOrSensitive = /(?:\$|€|£|\b(?:usd|cad|aud|gbp|price|pricing|revenue|traffic|demand|conversion\s+rate|metric|analytics|password|credential|secret|token|api[-_ ]?key|authorization|bearer|cookie|session|raw[-_ ]?html)\b)/i;
const inventedMeasurement = /\b\d+(?:\.\d+)?\s*(?:%|percent|milliseconds?|ms|seconds?|secs?|px|bytes?|kb|mb|users?|visitors?|customers?|locations?|employees?|years?)(?![a-z])/i;
const currencyValue = /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?)|(?:\b\d[\d,]*(?:\.\d+)?\s*(?:usd|cad|aud|gbp|dollars?|euros?|pounds?|cents?)\b)/gi;
const contactValue = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b|(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const currencyValueTest = new RegExp(currencyValue.source, "i");
const unsafeUrlGlobal = new RegExp(unsafeUrl.source, "gi");
const measurementGlobal = new RegExp(inventedMeasurement.source, "gi");
const URL_PROSE_ERROR = "Model prose cannot contain URLs outside supplied evidence IDs.";
const MARKUP_PROSE_ERROR = "Model prose cannot contain markup.";
const COMMERCIAL_PROSE_ERROR = "Model prose cannot invent commercial, metric, or sensitive facts.";
const MEASUREMENT_PROSE_ERROR = "Model prose cannot invent measurements or client facts.";
const ADVICE_PROSE_ERROR = "Model prose must describe a supported, specific issue rather than generic advice.";
const genericAdvice = /\b(?:make\s+it\s+modern|moderni[sz]e|redesign\s+the\s+(?:site|website)|follow\s+best\s+practices|improve\s+seo|improve\s+ux|improve\s+user\s+experience|add\s+(?:more\s+)?cta(?:s)?|add\s+more\s+content|refresh\s+the\s+design|optimi[sz]e\s+the\s+website)\b/i;
const adequateSolution = /\b(?:already\s+(?:adequate|adequately\s+\w+|solves|works)|adequately\s+(?:serves|supports|handles)|working\s+well|no\s+change\s+is\s+needed)\b/i;
const serviceClaim = /\b(?:add|offer|provide|sell|create|build|need|needs|launch|introduce)\b[^.!?]{0,100}\b(?:service|services|offering|offerings|product|package)\b/i;
const absenceClaim = /\b(?:no|not|never|without|missing|absent|lack(?:s|ing)?|nowhere|nothing|doesn['’]?t\s+have|does\s+not\s+have)\b/i;

export const BoundedClientFactsSchema = z.object({
  clientId: boundedId,
  name: z.string().trim().min(1).max(300),
  domain: z.string().trim().min(1).max(300),
  offerings: boundedStringList(50, 300),
  notes: z.string().trim().max(1_000).default(""),
  facts: boundedStringList(50, 500).optional(),
}).strict();

export const CapabilityDescriptionSchema = z.object({
  id: boundedId,
  name: boundedShortText,
  description: z.string().trim().max(1_000).default(""),
  deliverableIds: boundedStringList(50, 200).default([]),
  deliverables: boundedStringList(50, 300).optional(),
  intent: z.string().trim().max(500).optional(),
  serviceId: boundedId.optional(),
}).strict();

export const SubtypeDefinitionSchema = z.object({
  id: boundedId.optional(),
  subtypeId: boundedId.optional(),
  version: boundedId.optional(),
  problemType: ProblemTypeSchema.optional(),
  category: InsightCategorySchema,
  claimKind: z.enum(["presence", "absence", "comparison", "measurement", "supported_inference"]),
  minimumGrade: z.enum(["strong", "moderate", "limited", "insufficient"]),
  requiresCompleteCoverage: z.boolean(),
  requiresCounterEvidence: z.boolean(),
  projectWorkstream: boundedKey,
  legacyRuleId: boundedId.nullable(),
  reconciliationPolicy: z.enum(["condition_clears_with_current_evidence", "requires_current_evidence"]),
  eligibleEvidenceKinds: boundedStringList(30, 80).optional(),
  capabilityIntent: boundedStringList(20, 300).optional(),
  deliverableIds: boundedStringList(50, 200).optional(),
  description: z.string().trim().max(1_000).optional(),
  priority: ProblemPrioritySchema.optional(),
  modelAnchored: z.boolean().optional(),
}).strict();

export const SiteUnderstandingInputSchema = z.object({
  clientId: boundedId,
  clientFacts: BoundedClientFactsSchema,
  evidence: z.array(EvidenceRefSchema).max(10_000),
  diagnostics: z.array(DiagnosticSchema).max(5_000),
  categories: z.array(AnalysisCategoryAssessmentSchema).max(10),
  capabilities: z.array(CapabilityDescriptionSchema).max(100),
  subtypeDefinitions: z.array(SubtypeDefinitionSchema).max(100),
}).strict().superRefine((value, context) => {
  if (value.clientId !== value.clientFacts.clientId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["clientId"], message: "The input clientId must match clientFacts.clientId." });
  addUniqueIdIssue(value.evidence.map((item) => item.id), "evidence", context);
  addUniqueIdIssue(value.diagnostics.map((item) => item.id), "diagnostics", context);
  addUniqueIdIssue(value.capabilities.map((item) => item.id), "capabilities", context);
  addUniqueIdIssue(value.categories.map((item) => item.category), "categories", context);
  addSharedEvidenceIdentityIssues(value.evidence, value.diagnostics, value.clientId, context);
  for (const definition of value.subtypeDefinitions) {
    if (definition.problemType) {
      const taxonomy = definitionForProblemType(definition.problemType);
      if (taxonomy.category !== definition.category) context.addIssue({ code: z.ZodIssueCode.custom, path: ["subtypeDefinitions"], message: "Subtype definition category must match the taxonomy." });
    }
  }
});

export const ProblemDraftCandidateSchema = z.object({
  draftId: boundedId.optional(),
  clientId: boundedId,
  category: InsightCategorySchema,
  problemType: ProblemTypeSchema,
  canonicalSurface: boundedKey,
  rootCause: boundedKey,
  diagnosticIds: boundedStringList(100, 200),
  evidenceIds: boundedStringList(100, 200).min(1),
  statement: boundedText,
  whyItMatters: boundedText,
  businessConsequence: boundedText.optional(),
  validationSteps: boundedStringList(4, 500).min(1),
}).strict().superRefine((draft, context) => {
  if (draft.diagnosticIds.length === 0 && !MODEL_ANCHORED_PROBLEM_TYPES.has(draft.problemType)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["diagnosticIds"], message: "A grouped draft must cite at least one supplied diagnostic." });
});

export const ProblemDraftSchema = z.object({
  draftId: z.string().trim().min(1).max(100),
  clientId: boundedId,
  category: InsightCategorySchema,
  problemType: ProblemTypeSchema,
  canonicalSurface: boundedKey,
  rootCause: boundedKey,
  diagnosticIds: boundedStringList(100, 200),
  evidenceIds: boundedStringList(100, 200).min(1),
  statement: boundedText,
  whyItMatters: boundedText,
  businessConsequence: boundedText.optional(),
  validationSteps: boundedStringList(4, 500).min(1),
}).strict().superRefine((draft, context) => {
  if (draft.diagnosticIds.length === 0 && !MODEL_ANCHORED_PROBLEM_TYPES.has(draft.problemType)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["diagnosticIds"], message: "A grouped draft must cite at least one supplied diagnostic." });
});

export const CriticDecisionSchema = z.object({
  draftId: z.string().trim().min(1).max(100),
  decision: z.enum(["retain", "reject"]),
  reasons: boundedStringList(6, 700).min(1),
}).strict();

export const InsightCriticInputSchema = z.object({
  evidence: z.array(EvidenceRefSchema).max(10_000),
  diagnostics: z.array(DiagnosticSchema).max(5_000),
  drafts: z.array(ProblemDraftSchema).max(100),
}).strict().superRefine((value, context) => {
  addUniqueIdIssue(value.evidence.map((item) => item.id), "evidence", context);
  addUniqueIdIssue(value.diagnostics.map((item) => item.id), "diagnostics", context);
  addUniqueIdIssue(value.drafts.map((item) => item.draftId), "drafts", context);
  addSharedEvidenceIdentityIssues(value.evidence, value.diagnostics, undefined, context);
  const evidenceIds = new Set(value.evidence.map((entry) => entry.id));
  const diagnosticIds = new Set(value.diagnostics.map((diagnostic) => diagnostic.id));
  const clientIds = new Set(value.diagnostics.map((diagnostic) => diagnostic.clientId));
  for (const draft of value.drafts) {
    if (clientIds.size > 0 && !clientIds.has(draft.clientId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["drafts"], message: "Every critic draft must belong to the supplied diagnostic client." });
    if (draft.diagnosticIds.some((id) => !diagnosticIds.has(id))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["drafts"], message: "Every critic draft diagnostic reference must resolve in the supplied diagnostics." });
    if (draft.evidenceIds.some((id) => !evidenceIds.has(id))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["drafts"], message: "Every critic draft evidence reference must resolve in the supplied evidence." });
  }
  if (clientIds.size === 0 && value.drafts.length > 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["diagnostics"], message: "Critic drafts require a supplied diagnostic client identity." });
});

export const SiteUnderstandingResultSchema = z.object({
  status: z.enum(["complete", "partial", "unavailable"]),
  drafts: z.array(ProblemDraftSchema).max(100),
  rejectedDrafts: z.number().int().nonnegative().max(100_000),
  limitations: boundedStringList(100, 500),
  providerCalls: z.number().int().nonnegative().max(100),
}).strict();
export const InsightCriticResultSchema = z.object({
  status: z.enum(["complete", "partial", "unavailable"]),
  decisions: z.array(CriticDecisionSchema).max(100),
  rejectedDrafts: z.number().int().nonnegative().max(100_000),
  limitations: boundedStringList(100, 500),
  providerCalls: z.number().int().nonnegative().max(100),
}).strict();

export function normalizeIdentityPart(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
export function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}
function canonicalIds(values: readonly string[]): string[] { return [...new Set(values.map(normalizeIdentityPart))].sort((left, right) => left.localeCompare(right)); }
export function canonicalDraftTuple(input: { clientId: string; category: string; problemType: string; canonicalSurface: string; rootCause: string; diagnosticIds: string[]; evidenceIds: string[] }): string {
  return JSON.stringify({ clientId: normalizeIdentityPart(input.clientId), category: normalizeIdentityPart(input.category), problemType: normalizeIdentityPart(input.problemType), canonicalSurface: normalizeIdentityPart(input.canonicalSurface), rootCause: normalizeIdentityPart(input.rootCause), diagnosticIds: canonicalIds(input.diagnosticIds), evidenceIds: canonicalIds(input.evidenceIds) });
}
export function problemDraftId(input: Parameters<typeof canonicalDraftTuple>[0], hashIdentity: (value: string) => string = fnv1a64): string { return `draft_${hashIdentity(canonicalDraftTuple(input))}`; }

function addUniqueIdIssue(ids: readonly string[], path: string, context: z.RefinementCtx): void {
  if (new Set(ids).size !== ids.length) context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: `${path} IDs must be unique.` });
}

type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
type Diagnostic = z.infer<typeof DiagnosticSchema>;
type SiteUnderstandingInputData = z.infer<typeof SiteUnderstandingInputSchema>;
function addSharedEvidenceIdentityIssues(evidence: EvidenceRef[], diagnostics: Diagnostic[], expectedClientId: string | undefined, context: z.RefinementCtx): void {
  const evidenceRunIds = new Set(evidence.map((entry) => entry.runId));
  if (evidenceRunIds.size > 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence"], message: "All supplied evidence must belong to one analysis run." });
  const diagnosticRunIds = new Set(diagnostics.map((diagnostic) => diagnostic.runId));
  const workspaceIds = new Set(diagnostics.map((diagnostic) => diagnostic.workspaceId));
  const clientIds = new Set(diagnostics.map((diagnostic) => diagnostic.clientId));
  if (diagnosticRunIds.size > 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["diagnostics"], message: "All supplied diagnostics must belong to one analysis run." });
  if (workspaceIds.size > 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["diagnostics"], message: "All supplied diagnostics must belong to one workspace." });
  if (clientIds.size > 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["diagnostics"], message: "All supplied diagnostics must belong to one client." });
  if (expectedClientId && diagnostics.some((diagnostic) => diagnostic.clientId !== expectedClientId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["diagnostics"], message: "Every diagnostic must belong to the supplied client." });
  const [evidenceRunId] = [...evidenceRunIds];
  const [diagnosticRunId] = [...diagnosticRunIds];
  if (evidenceRunId && diagnosticRunId && evidenceRunId !== diagnosticRunId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence"], message: "Supplied evidence and diagnostics must belong to the same analysis run." });
  const evidenceIds = new Set(evidence.map((entry) => entry.id));
  for (const diagnostic of diagnostics) {
    if (diagnostic.evidenceRefs.some((ref) => !evidenceIds.has(ref))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["diagnostics"], message: "Every diagnostic evidence reference must resolve in the supplied evidence." });
      break;
    }
  }
}

function forbiddenProse(value: string): string | null {
  if (unsafeUrl.test(value)) return URL_PROSE_ERROR;
  if (markup.test(value)) return MARKUP_PROSE_ERROR;
  if (commercialOrSensitive.test(value)) return COMMERCIAL_PROSE_ERROR;
  if (inventedMeasurement.test(value)) return MEASUREMENT_PROSE_ERROR;
  if (genericAdvice.test(value)) return ADVICE_PROSE_ERROR;
  return null;
}
function normalizeQuotedText(value: string): string { return value.toLowerCase().replace(/\s+/g, " ").trim(); }
function trimTrailingPunctuation(value: string): string { return value.replace(/[.,;:!?)\]}"']+$/g, ""); }
function sourceFromRows(rows: readonly unknown[]): { text: string; digits: string } { const text = normalizeQuotedText(JSON.stringify(rows)); return { text, digits: text.replace(/\D+/g, "") }; }
function citedSourceText(evidenceIds: readonly string[], diagnosticIds: readonly string[], evidenceById: Map<string, EvidenceRef>, diagnosticById: Map<string, Diagnostic>): { text: string; digits: string } {
  const cited: unknown[] = [];
  const seenEvidence = new Set<string>();
  for (const id of evidenceIds) { if (seenEvidence.has(id)) continue; seenEvidence.add(id); const row = evidenceById.get(id); if (row !== undefined) cited.push(row); }
  const seenDiagnostics = new Set<string>();
  for (const id of diagnosticIds) { if (seenDiagnostics.has(id)) continue; seenDiagnostics.add(id); const row = diagnosticById.get(id); if (row !== undefined) cited.push(row); }
  return sourceFromRows(cited);
}
function quotedFromSource(literal: string, source: { text: string; digits: string }): boolean { const needle = trimTrailingPunctuation(normalizeQuotedText(literal)); return needle.length >= 2 && source.text.includes(needle); }
function phoneQuotedFromSource(literal: string, source: { text: string; digits: string }): boolean { const digits = literal.replace(/\D+/g, ""); return digits.length >= 10 && source.digits.includes(digits); }
function contactQuotedFromSource(literal: string, source: { text: string; digits: string }): boolean { return literal.includes("@") ? quotedFromSource(literal, source) : phoneQuotedFromSource(literal, source); }
function forbiddenDraftProse(value: string, source: { text: string; digits: string }): string | null {
  for (const literal of value.match(unsafeUrlGlobal) ?? []) if (!quotedFromSource(literal, source)) return URL_PROSE_ERROR;
  if (markup.test(value)) return MARKUP_PROSE_ERROR;
  for (const literal of value.match(currencyValue) ?? []) if (!quotedFromSource(literal, source)) return COMMERCIAL_PROSE_ERROR;
  for (const literal of value.match(contactValue) ?? []) if (!contactQuotedFromSource(literal, source)) return COMMERCIAL_PROSE_ERROR;
  if (commercialOrSensitive.test(value.replace(currencyValueTest, " "))) return COMMERCIAL_PROSE_ERROR;
  for (const literal of value.match(measurementGlobal) ?? []) if (!quotedFromSource(literal, source)) return MEASUREMENT_PROSE_ERROR;
  if (genericAdvice.test(value)) return ADVICE_PROSE_ERROR;
  return null;
}
function draftProseError(values: readonly string[], source: { text: string; digits: string }): string | null { for (const value of values) { const error = forbiddenDraftProse(value, source); if (error) return error; } return null; }
function inventsService(value: string, input: SiteUnderstandingInputData): boolean { if (!serviceClaim.test(value)) return false; const normalized = value.toLowerCase(); return !input.clientFacts.offerings.some((offering) => { const candidate = offering.toLowerCase().trim(); return candidate.length > 0 && normalized.includes(candidate); }); }
function absenceSupported(input: SiteUnderstandingInputData, diagnosticIds: readonly string[]): boolean { return input.diagnostics.some((diagnostic) => { if (!diagnosticIds.includes(diagnostic.id) || diagnostic.state !== "observed") return false; const definition = definitionForProblemType(diagnostic.problemType); return definition.claimKind === "absence" || /(?:missing|no_|absence)/i.test(diagnostic.problemType); }); }
function draftText(draft: z.infer<typeof ProblemDraftCandidateSchema>): string[] { return [draft.statement, draft.whyItMatters, draft.businessConsequence ?? "", ...draft.validationSteps]; }
function definitionTypes(input: SiteUnderstandingInputData): Set<string> {
  const explicit: string[] = [];
  for (const definition of input.subtypeDefinitions) {
    if (definition.problemType !== undefined) explicit.push(definition.problemType);
  }
  return new Set(explicit);
}

export interface ProblemDraftValidationResult { drafts: z.infer<typeof ProblemDraftSchema>[]; rejectedDrafts: number; limitations: string[]; }
export interface DraftValidationOptions { hashIdentity?: (value: string) => string; }

export function validateProblemDrafts(rawInput: unknown, rawDrafts: readonly unknown[], maxDrafts = 20, options: DraftValidationOptions = {}): ProblemDraftValidationResult {
  const input = SiteUnderstandingInputSchema.parse(rawInput);
  if (!Number.isInteger(maxDrafts) || maxDrafts < 0 || maxDrafts > 100) throw new Error("maxDrafts must be an integer between 0 and 100.");
  const evidenceIds = new Set(input.evidence.map((entry) => entry.id));
  const diagnosticIds = new Set(input.diagnostics.map((diagnostic) => diagnostic.id));
  const evidenceById = new Map(input.evidence.map((entry) => [entry.id, entry]));
  const diagnosticById = new Map(input.diagnostics.map((diagnostic) => [diagnostic.id, diagnostic]));
  const explicitTypes = definitionTypes(input);
  const drafts: z.infer<typeof ProblemDraftSchema>[] = [];
  const limitations: string[] = [];
  const tuples = new Set<string>();
  const ids = new Map<string, string>();
  let rejectedDrafts = 0;
  let repairedDrafts = 0;
  const reject = (reason: string) => { rejectedDrafts += 1; if (!limitations.includes(reason) && limitations.length < 100) limitations.push(reason); };
  for (const raw of rawDrafts.slice(0, Math.max(rawDrafts.length, maxDrafts))) {
    const parsed = ProblemDraftCandidateSchema.safeParse(raw);
    if (!parsed.success) { reject("A grouped draft did not match the bounded problem contract."); continue; }
    const candidate = parsed.data;
    if (candidate.clientId !== input.clientId) { reject("A grouped draft referenced a different client."); continue; }
    const taxonomy = definitionForProblemType(candidate.problemType);
    if (taxonomy.category !== candidate.category) { reject("A grouped draft used a category outside the approved taxonomy."); continue; }
    if (explicitTypes.size > 0 && !explicitTypes.has(candidate.problemType)) { reject("A grouped draft used a subtype that was not supplied in the approved definitions."); continue; }
    if (candidate.evidenceIds.length === 0) { reject("Every grouped draft must cite at least one supplied evidence ID."); continue; }
    if (candidate.diagnosticIds.length === 0 && !MODEL_ANCHORED_PROBLEM_TYPES.has(candidate.problemType)) { reject("Every grouped draft must cite at least one supplied diagnostic ID."); continue; }
    if (new Set(candidate.diagnosticIds).size !== candidate.diagnosticIds.length || new Set(candidate.evidenceIds).size !== candidate.evidenceIds.length) { reject("A grouped draft must cite each diagnostic and evidence ID at most once."); continue; }
    if (candidate.diagnosticIds.some((id) => !diagnosticIds.has(id))) { reject("A grouped draft referenced an unknown diagnostic ID."); continue; }
    const unresolvedEvidence = candidate.evidenceIds.filter((id) => !evidenceIds.has(id));
    if (unresolvedEvidence.length > 0) {
      const resolvedEvidence = candidate.evidenceIds.filter((id) => evidenceIds.has(id));
      if (resolvedEvidence.length === 0) { reject("A grouped draft referenced an unknown evidence ID."); continue; }
      candidate.evidenceIds = resolvedEvidence;
      repairedDrafts += 1;
    }
    const textValues = draftText(candidate);
    const sourceText = citedSourceText(candidate.evidenceIds, candidate.diagnosticIds, evidenceById, diagnosticById);
    const proseError = draftProseError(textValues, sourceText);
    if (proseError) { reject(proseError); continue; }
    if (textValues.some((value) => inventsService(value, input))) { reject("A grouped draft invented a client service or offering outside the supplied facts."); continue; }
    if (textValues.some((value) => adequateSolution.test(value))) { reject("A grouped draft treated an adequate existing solution as new work."); continue; }
    const firstHandContentReading = candidate.diagnosticIds.length === 0 && MODEL_ANCHORED_PROBLEM_TYPES.has(candidate.problemType);
    if (!firstHandContentReading && !absenceSupported(input, candidate.diagnosticIds) && textValues.some((value) => absenceClaim.test(value))) { reject("An absence claim was not supported by the supplied observed evidence."); continue; }
    const tuple = canonicalDraftTuple(candidate);
    const draftId = problemDraftId(candidate, options.hashIdentity);
    const priorTuple = ids.get(draftId);
    if (priorTuple && priorTuple !== tuple) return { drafts: [], rejectedDrafts: rawDrafts.length, limitations: ["A deterministic draft ID collision was detected; the grouped response was rejected."] };
    if (tuples.has(tuple)) return { drafts: [], rejectedDrafts: rawDrafts.length, limitations: ["Duplicate grouped drafts with the same canonical tuple were rejected."] };
    if (drafts.length >= maxDrafts) { reject("The grouped draft cap was reached; excess drafts were withheld."); continue; }
    const draft = ProblemDraftSchema.parse({ ...candidate, draftId });
    tuples.add(tuple);
    ids.set(draftId, tuple);
    drafts.push(draft);
  }
  if (repairedDrafts > 0) limitations.push(`The bounded repair dropped unresolvable evidence references from ${repairedDrafts} grouped draft(s); no reference was remapped or substituted, and each repaired draft was re-validated against its remaining cited rows.`);
  if (rawDrafts.length > maxDrafts) {
    const excess = rawDrafts.length - maxDrafts;
    if (excess > 0 && rejectedDrafts < excess) rejectedDrafts += excess - rejectedDrafts;
    if (!limitations.some((item) => /cap/i.test(item))) limitations.push(`The grouped understanding output exceeded the ${maxDrafts}-draft cap.`);
  }
  drafts.sort((left, right) => left.draftId.localeCompare(right.draftId));
  return { drafts, rejectedDrafts, limitations };
}

export interface CriticDecisionRepairResult { decisions: z.infer<typeof CriticDecisionSchema>[]; repaired: boolean; undecidedDraftIds: string[]; droppedDecisionCount: number; limitations: string[]; }
export function validateCriticDecisions(rawDecisions: readonly unknown[], rawDrafts: readonly unknown[], evidence: readonly unknown[] = []): z.infer<typeof CriticDecisionSchema>[] {
  const result = validateCriticDecisionsWithRepair(rawDecisions, rawDrafts, evidence);
  if (result.repaired) throw new Error(result.limitations.join(" ") || "Critic output did not satisfy the remove-only decision contract.");
  return result.decisions;
}
export function validateCriticDecisionsWithRepair(rawDecisions: readonly unknown[], rawDrafts: readonly unknown[], evidence: readonly unknown[] = []): CriticDecisionRepairResult {
  const drafts = z.array(ProblemDraftSchema).max(100).parse(rawDrafts);
  if (!Array.isArray(rawDecisions)) throw new Error("Critic output must contain a decisions array.");
  const expected = new Set(drafts.map((draft) => draft.draftId));
  const suppliedText = evidence.length > 0 ? sourceFromRows(evidence) : { text: "", digits: "" };
  const limitations: string[] = [];
  const byDraftId = new Map<string, z.infer<typeof CriticDecisionSchema>>();
  let droppedDecisionCount = 0;
  for (const raw of rawDecisions) {
    const parsed = CriticDecisionSchema.safeParse(raw);
    if (!parsed.success) { droppedDecisionCount += 1; continue; }
    const decision = parsed.data;
    if (!expected.has(decision.draftId) || byDraftId.has(decision.draftId)) { droppedDecisionCount += 1; continue; }
    const reasonError = suppliedText.text.length > 0 ? draftProseError(decision.reasons, suppliedText) : decision.reasons.map(forbiddenProse).find(Boolean);
    if (reasonError) { droppedDecisionCount += 1; continue; }
    byDraftId.set(decision.draftId, decision);
  }
  const undecidedDraftIds = drafts.map((draft) => draft.draftId).filter((draftId) => !byDraftId.has(draftId));
  const decisions = drafts.map((draft) => byDraftId.get(draft.draftId) ?? { draftId: draft.draftId, decision: "reject" as const, reasons: ["The review stage returned no usable decision for this item, so it was withheld rather than published unreviewed."] });
  const reordered = rawDecisions.length === drafts.length && drafts.some((draft, index) => { const raw = rawDecisions[index]; return raw !== null && typeof raw === "object" && (raw as Record<string, unknown>).draftId !== draft.draftId; });
  const repaired = droppedDecisionCount > 0 || undecidedDraftIds.length > 0 || reordered;
  if (droppedDecisionCount > 0) limitations.push(`${droppedDecisionCount} review decision(s) could not be used (malformed, repeated, or naming an unknown item) and were discarded; the affected items were withheld rather than published unreviewed.`);
  if (undecidedDraftIds.length > 0) limitations.push(`The review stage returned no decision for ${undecidedDraftIds.length} of ${drafts.length} item(s); those items were withheld rather than published unreviewed.`);
  if (reordered && droppedDecisionCount === 0 && undecidedDraftIds.length === 0) limitations.push("The review stage returned its decisions in a different order from the supplied items; they were matched by identity before use.");
  return { decisions, repaired, undecidedDraftIds, droppedDecisionCount, limitations };
}

export type SiteUnderstandingInput = z.infer<typeof SiteUnderstandingInputSchema>;
export type ProblemDraftCandidate = z.infer<typeof ProblemDraftCandidateSchema>;
export type ProblemDraft = z.infer<typeof ProblemDraftSchema>;
export type CriticDecision = z.infer<typeof CriticDecisionSchema>;
