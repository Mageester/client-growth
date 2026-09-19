import { z } from "zod";
import {
  EVIDENCE_GRADES,
  INSIGHT_CATEGORIES,
  INSIGHT_PROBLEM_TYPES,
  OfferingProvenanceClassSchema,
  definitionForProblemType,
} from "@/core/insightTaxonomy";
import { RuleIdSchema } from "@/core/ruleIds";
import { InsightAccountingSchema, legacyInsightAccounting } from "@/core/analysisAccounting";

const boundedId = z.string().trim().min(1).max(200);
const boundedShortText = z.string().trim().min(1).max(500);
const boundedText = z.string().trim().min(1).max(5_000);
const boundedLongText = z.string().trim().min(1).max(10_000);
const boundedStringList = (maxItems: number, maxLength = 500) => z.array(z.string().trim().min(1).max(maxLength)).max(maxItems);

export const InsightCategorySchema = z.enum(INSIGHT_CATEGORIES);
export const ProblemTypeSchema = z.enum(INSIGHT_PROBLEM_TYPES);
export const EvidenceGradeSchema = z.enum(EVIDENCE_GRADES);
export const ClaimScopeSchema = z.enum(["observed", "supported_inference", "hypothesis"]);
export const CounterEvidenceStateSchema = z.enum(["not_checked", "checked_none", "present", "contradictory", "unknown"]);
export const CoverageStateSchema = z.enum(["complete", "partial", "blocked", "stale"]);
export const DiagnosticStateSchema = z.enum(["observed", "unknown", "blocked", "stale"]);
export const ProblemQualityGateSchema = z.enum(["supported", "limited", "rejected"]);

export const EVIDENCE_ORIGINS = ["SOURCE_HTTP", "RENDERED_DOM", "ACCESSIBILITY", "VISUAL", "INTERACTION", "MEASUREMENT", "CLIENT_CONTEXT"] as const;
export const EvidenceOriginSchema = z.enum(EVIDENCE_ORIGINS);
export const EvidenceKindSchema = z.enum(["page", "element", "link", "form", "screenshot", "performance", "accessibility", "contact-fact", "competitor", "probe"]);
export const EvidenceScalarSchema = z.union([z.string().max(4_000), z.number().finite(), z.boolean(), z.null()]);
export const EvidencePayloadKeySchema = z.string().trim().min(1).max(200);
export const EvidencePayloadSchema = z.record(EvidencePayloadKeySchema, EvidenceScalarSchema).superRefine((payload, context) => {
  if (Object.keys(payload).length > 100) context.addIssue({ code: z.ZodIssueCode.custom, message: "Evidence payloads may contain at most 100 fields." });
});

export const EvidenceRefSchema = z.object({
  id: boundedId,
  runId: boundedId,
  kind: EvidenceKindSchema,
  locator: boundedText,
  pageUrl: z.string().trim().min(1).max(2_000).optional(),
  screenshotId: boundedId.optional(),
  viewport: z.enum(["desktop", "mobile"]).optional(),
  observedAt: boundedId,
  payload: EvidencePayloadSchema,
}).strict();

const EvidenceAssessmentObjectSchema = z.object({
  grade: EvidenceGradeSchema,
  claimScope: ClaimScopeSchema,
  coverage: CoverageStateSchema,
  limitations: boundedStringList(50),
  counterEvidence: boundedStringList(50),
  counterEvidenceState: CounterEvidenceStateSchema,
  unassessedEvidence: boundedStringList(50),
}).strict().superRefine((assessment, context) => {
  const hasDetails = assessment.counterEvidence.length > 0;
  if (assessment.counterEvidenceState === "checked_none" && hasDetails) context.addIssue({ code: z.ZodIssueCode.custom, path: ["counterEvidenceState"], message: "checked_none cannot carry counter-evidence details." });
  if ((assessment.counterEvidenceState === "present" || assessment.counterEvidenceState === "contradictory") && !hasDetails) context.addIssue({ code: z.ZodIssueCode.custom, path: ["counterEvidence"], message: `${assessment.counterEvidenceState} requires counter-evidence details.` });
  if (assessment.counterEvidenceState === "not_checked" && hasDetails) context.addIssue({ code: z.ZodIssueCode.custom, path: ["counterEvidenceState"], message: "not_checked cannot carry counter-evidence details." });
});

export const EvidenceAssessmentSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.counterEvidenceState !== undefined) return value;
  const details = Array.isArray(record.counterEvidence) ? record.counterEvidence : [];
  return { ...record, counterEvidenceState: details.length > 0 ? "present" : "not_checked" };
}, EvidenceAssessmentObjectSchema);

export const SubjectSchema = z.object({ kind: z.enum(["site", "page", "element", "journey", "competitor"]), key: boundedText }).strict();
export const LegacyDiagnosticDetailsSchema = z.object({
  kind: z.literal("legacy"),
  legacyRuleId: RuleIdSchema,
  suppressedEvidenceRefs: boundedStringList(500, 2_000).optional(),
}).strict();

const CompatibilityUrlSchema = z.string().min(1).max(2_000);
const CompatibilityUrlListItemSchema = z.string().max(2_000);
const CompatibilityTextSchema = z.string().max(4_000);
const CompatibilityStringListSchema = z.array(CompatibilityUrlListItemSchema).max(100);
const CompatibilityCloseMatchSchema = z.object({
  where: z.enum(["crawled-page", "page-title", "heading", "nav-label", "link-label", "link-href", "sitemap-url", "fetched-page"]),
  value: CompatibilityTextSchema,
  url: z.string().max(2_000).optional(),
  score: z.number().finite().min(0).max(1),
  satisfied: z.boolean(),
  reason: CompatibilityTextSchema,
}).strict();
const StrictVerificationSchema = z.object({
  conclusion: z.enum(["absent", "present", "inconclusive", "weak"]),
  inspectedUrls: CompatibilityStringListSchema.default([]),
  closeMatches: z.array(CompatibilityCloseMatchSchema).max(100).default([]),
  reason: CompatibilityTextSchema.default(""),
}).strict();
const StrictConversionDefectSchema = z.object({
  kind: z.enum(["dead-conversion-link", "conversion-page-error", "malformed-tel", "broken-form-target"]),
  pageUrl: CompatibilityUrlSchema,
  elementText: CompatibilityTextSchema.default(""),
  elementHref: CompatibilityTextSchema.default(""),
  target: z.string().max(2_000).optional(),
  observedStatus: z.number().finite().int().min(-9_999).max(9_999).optional(),
  seenOn: z.array(CompatibilityUrlSchema).max(100).default([]),
  note: CompatibilityTextSchema.default(""),
}).strict();
export const VerificationDiagnosticDetailsSchema = z.object({
  kind: z.literal("verification"),
  verification: StrictVerificationSchema,
  offeringProvenance: OfferingProvenanceClassSchema.optional(),
}).strict();
export const ConversionDiagnosticDetailsSchema = z.object({ kind: z.literal("conversion_defect"), conversionDefect: StrictConversionDefectSchema }).strict();

export const BroadEvidenceTypeSchema = z.enum(["page", "element", "link", "form", "screenshot", "performance", "accessibility", "contact-fact", "competitor", "probe", "cta", "form-field", "landmark", "section", "proof", "date-fact", "resource", "console", "rendered"]);
export function containsUrlLikeValue(value: string): boolean {
  return /[a-z][a-z\d+.-]*:\/\//i.test(value) || /(?:^|[\s=])\/\/[^\s]+/.test(value) || /\b(?:mailto|tel|sms|ftp|file|data|javascript):[^\s]+/i.test(value) || /(?:^|[\s=(])(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,62}\.)+[a-z]{2,}(?:[/:?#][^\s]*)?/i.test(value);
}
export const BroadObservationKeySchema = z.string().trim().min(1).max(200)
  .refine((value) => !containsUrlLikeValue(value), "Broad observation keys must reference supplied evidence, not URLs.")
  .refine((value) => !/[<>]/.test(value), "Broad observation keys cannot contain markup.")
  .refine((value) => !/(?:price|revenue|traffic|demand|password|credential|secret|token|api[-_ ]?key|authorization|auth(?:entication)?|cookie|session|bearer|access[-_ ]?key|private[-_ ]?key|client[-_ ]?secret|raw[-_ ]?html)/i.test(value), "Broad observation keys cannot identify commercial or sensitive payloads.");
export const BroadReasonSchema = boundedShortText.refine(
  (value) => !containsUrlLikeValue(value) && !/[<>]/.test(value) && !/\b(?:price|revenue|traffic|demand|password|credential|secret|token|api[-_ ]?key|authorization|auth(?:entication)?|cookie|session|bearer|access[-_ ]?key|private[-_ ]?key|client[-_ ]?secret|raw[-_ ]?html)\b/i.test(value),
  "Broad reasons cannot contain URLs, commercial claims, or sensitive payloads.",
);
export const BroadMeasurementKeySchema = z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_.:-]*$/i, "Measurement keys must be bounded identifiers.").refine((value) => !/(?:price|revenue|traffic|demand|html|credential|password|secret|token|query|request[-_ ]?body|email[-_ ]?value|phone[-_ ]?value)/i.test(value), "Measurement keys cannot carry commercial or sensitive values.");
export const BroadMeasurementUnitSchema = z.enum(["count", "items", "px", "ms", "s", "bytes", "ratio", "percent", "score", "status"]);
export const BroadMeasurementSchema = z.object({ key: BroadMeasurementKeySchema, value: z.number().finite().min(-1e9).max(1e9), unit: BroadMeasurementUnitSchema }).strict();
export const BroadDiagnosticDetailsSchema = z.object({
  kind: z.literal("broad"),
  evidenceType: BroadEvidenceTypeSchema,
  observationKeys: z.array(BroadObservationKeySchema).min(1).max(100),
  measurements: z.array(BroadMeasurementSchema).max(20).optional(),
  reason: BroadReasonSchema,
  contactFactKind: z.string().trim().min(1).max(40).regex(/^[a-z][a-z0-9 -]*$/, "Contact fact kinds are plain lowercase labels.").optional(),
}).strict();
export const SemanticDiagnosticDetailsSchema = z.object({ kind: z.literal("semantic"), source: z.literal("site-understanding"), reason: BroadReasonSchema }).strict();
export const DiagnosticDetailsSchema = z.discriminatedUnion("kind", [LegacyDiagnosticDetailsSchema, VerificationDiagnosticDetailsSchema, ConversionDiagnosticDetailsSchema, BroadDiagnosticDetailsSchema, SemanticDiagnosticDetailsSchema]);

export const DiagnosticDraftSchema = z.object({
  detectorId: boundedId,
  detectorVersion: boundedId,
  category: InsightCategorySchema,
  problemType: ProblemTypeSchema,
  subject: SubjectSchema,
  observation: boundedLongText,
  legacyEvidenceRefs: boundedStringList(500, 2_000),
  rawConfidence: z.number().finite().min(0).max(1),
  state: DiagnosticStateSchema,
  details: DiagnosticDetailsSchema.optional(),
  claimScope: ClaimScopeSchema.optional(),
  counterEvidence: boundedStringList(50, 2_000).optional(),
  counterEvidenceState: CounterEvidenceStateSchema.optional(),
  origin: EvidenceOriginSchema.optional(),
}).strict().superRefine((draft, context) => {
  const definition = definitionForProblemType(draft.problemType);
  if (definition.category !== draft.category) context.addIssue({ code: z.ZodIssueCode.custom, path: ["category"], message: `Problem type ${draft.problemType} belongs to ${definition.category}.` });
  if ((definition.legacyRuleId === null || draft.details?.kind === "broad" || draft.details?.kind === "semantic") && draft.state === "observed" && draft.legacyEvidenceRefs.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["legacyEvidenceRefs"], message: "An observed non-legacy diagnostic requires typed evidence." });
  const counterEvidence = draft.counterEvidence ?? [];
  if (draft.counterEvidenceState === "checked_none" && counterEvidence.length > 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["counterEvidenceState"], message: "checked_none cannot carry counter-evidence details." });
  if ((draft.counterEvidenceState === "present" || draft.counterEvidenceState === "contradictory") && counterEvidence.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["counterEvidence"], message: `${draft.counterEvidenceState} requires counter-evidence details.` });
  if (draft.counterEvidenceState === "not_checked" && counterEvidence.length > 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["counterEvidenceState"], message: "not_checked cannot carry counter-evidence details." });
});

export const DiagnosticSchema = z.object({
  id: boundedId,
  workspaceId: boundedId,
  runId: boundedId,
  clientId: boundedId,
  detectorId: boundedId,
  detectorVersion: boundedId,
  category: InsightCategorySchema,
  problemType: ProblemTypeSchema,
  subject: SubjectSchema,
  observation: boundedLongText,
  evidenceRefs: boundedStringList(1_000, 2_000),
  assessment: EvidenceAssessmentSchema,
  state: DiagnosticStateSchema,
  fingerprint: boundedText,
  affectedPages: boundedStringList(1_000, 2_000).default([]),
  details: DiagnosticDetailsSchema.optional(),
  origin: EvidenceOriginSchema.optional(),
  createdAt: boundedId,
}).strict().superRefine((diagnostic, context) => {
  const definition = definitionForProblemType(diagnostic.problemType);
  if (definition.category !== diagnostic.category) context.addIssue({ code: z.ZodIssueCode.custom, path: ["category"], message: `Problem type ${diagnostic.problemType} belongs to ${definition.category}.` });
  if ((definition.legacyRuleId === null || diagnostic.details?.kind === "broad" || diagnostic.details?.kind === "semantic") && diagnostic.state === "observed" && diagnostic.evidenceRefs.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidenceRefs"], message: "An observed non-legacy diagnostic requires typed evidence." });
  if (definition.requiresCompleteCoverage && diagnostic.state === "observed" && diagnostic.assessment.coverage !== "complete") context.addIssue({ code: z.ZodIssueCode.custom, path: ["assessment", "coverage"], message: "An absence diagnostic cannot be observed from partial coverage." });
});

export const ProblemSchema = z.object({
  id: boundedId,
  workspaceId: boundedId,
  runId: boundedId,
  clientId: boundedId,
  canonicalKey: boundedText,
  category: InsightCategorySchema,
  problemType: ProblemTypeSchema,
  surfaceKey: boundedText,
  statement: boundedLongText,
  whyItMatters: boundedLongText,
  businessConsequence: boundedLongText,
  diagnosticIds: boundedStringList(1_000, 2_000),
  evidenceRefs: boundedStringList(1_000, 2_000),
  affectedPages: boundedStringList(1_000, 2_000),
  assessment: EvidenceAssessmentSchema,
  validationSteps: boundedStringList(50),
  qualityGate: ProblemQualityGateSchema,
  rejectionReasons: boundedStringList(50),
  createdAt: boundedId,
}).strict().superRefine((problem, context) => {
  const definition = definitionForProblemType(problem.problemType);
  if (definition.category !== problem.category) context.addIssue({ code: z.ZodIssueCode.custom, path: ["category"], message: `Problem type ${problem.problemType} belongs to ${definition.category}.` });
  if (problem.qualityGate === "supported" && problem.assessment.claimScope === "hypothesis") context.addIssue({ code: z.ZodIssueCode.custom, path: ["qualityGate"], message: "A hypothesis cannot be published as a supported problem." });
  if (problem.qualityGate === "supported" && definition.requiresCompleteCoverage && problem.assessment.coverage !== "complete") context.addIssue({ code: z.ZodIssueCode.custom, path: ["assessment", "coverage"], message: "An absence problem requires complete coverage before support." });
});

export const CategoryAssessmentStateSchema = z.enum(["assessed", "limited", "blocked", "unavailable", "not_applicable", "unassessed"]);
export const AnalysisCategoryAssessmentSchema = z.object({
  category: InsightCategorySchema,
  state: CategoryAssessmentStateSchema,
  diagnosticCount: z.number().int().nonnegative().max(10_000),
  problemCount: z.number().int().nonnegative().max(10_000),
  reason: boundedShortText.optional(),
  limitations: boundedStringList(50),
}).strict().superRefine((assessment, context) => {
  if (assessment.state !== "assessed" && !assessment.reason) context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "A category that was not fully assessed requires a bounded reason." });
});

export const CrawlCoverageSchema = z.object({
  exhaustive: z.boolean(),
  discovered: z.number().int().nonnegative(),
  attempted: z.number().int().nonnegative(),
  retrieved: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  rendered: z.number().int().nonnegative(),
  deferredByPageBudget: z.number().int().nonnegative(),
  duplicatesOfPagesAlreadyRead: z.number().int().nonnegative(),
  offSite: z.number().int().nonnegative(),
  otherReasons: z.number().int().nonnegative(),
}).strict();

export const InsightSnapshotSchema = z.object({
  workspaceId: boundedId,
  runId: boundedId,
  clientId: boundedId,
  evidence: z.array(EvidenceRefSchema).max(10_000),
  diagnostics: z.array(DiagnosticSchema).max(5_000),
  problems: z.array(ProblemSchema).max(2_000),
  categories: z.array(AnalysisCategoryAssessmentSchema).max(INSIGHT_CATEGORIES.length),
  limitations: boundedStringList(100).optional(),
  crawlCoverage: CrawlCoverageSchema.optional(),
  accounting: InsightAccountingSchema.default(() => legacyInsightAccounting()),
}).strict().superRefine((snapshot, context) => {
  const categoryNames = snapshot.categories.map((category) => category.category);
  const uniqueCategories = new Set(categoryNames);
  if (categoryNames.length !== INSIGHT_CATEGORIES.length || uniqueCategories.size !== INSIGHT_CATEGORIES.length || INSIGHT_CATEGORIES.some((category) => !uniqueCategories.has(category))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["categories"], message: "An insight snapshot must contain each category exactly once." });
  const mismatchedDiagnostic = snapshot.diagnostics.find((diagnostic) => diagnostic.workspaceId !== snapshot.workspaceId || diagnostic.runId !== snapshot.runId || diagnostic.clientId !== snapshot.clientId);
  if (mismatchedDiagnostic) context.addIssue({ code: z.ZodIssueCode.custom, path: ["diagnostics"], message: "Snapshot diagnostics must belong to the snapshot workspace, run, and client." });
  const mismatchedProblem = snapshot.problems.find((problem) => problem.workspaceId !== snapshot.workspaceId || problem.runId !== snapshot.runId || problem.clientId !== snapshot.clientId);
  if (mismatchedProblem) context.addIssue({ code: z.ZodIssueCode.custom, path: ["problems"], message: "Snapshot problems must belong to the snapshot workspace, run, and client." });
  const mismatchedEvidence = snapshot.evidence.find((evidence) => evidence.runId !== snapshot.runId);
  if (mismatchedEvidence) context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence"], message: "Snapshot evidence must belong to the snapshot run." });
});

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
export type DiagnosticDraft = z.infer<typeof DiagnosticDraftSchema>;
export type Problem = z.infer<typeof ProblemSchema>;
export type InsightSnapshot = z.infer<typeof InsightSnapshotSchema>;
