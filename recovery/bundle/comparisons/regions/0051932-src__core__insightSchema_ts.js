// src/core/insightSchema.ts
var boundedId = external_exports.string().trim().min(1).max(200);
var boundedShortText = external_exports.string().trim().min(1).max(500);
var boundedText = external_exports.string().trim().min(1).max(5e3);
var boundedLongText = external_exports.string().trim().min(1).max(1e4);
var boundedStringList = /* @__PURE__ */ __name((maxItems, maxLength = 500) => external_exports.array(external_exports.string().trim().min(1).max(maxLength)).max(maxItems), "boundedStringList");
var InsightCategorySchema2 = external_exports.enum(INSIGHT_CATEGORIES);
var ProblemTypeSchema2 = external_exports.enum(INSIGHT_PROBLEM_TYPES);
var EvidenceGradeSchema = external_exports.enum(EVIDENCE_GRADES);
var ClaimScopeSchema = external_exports.enum([
  "observed",
  "supported_inference",
  "hypothesis"
]);
var CounterEvidenceStateSchema = external_exports.enum([
  "not_checked",
  "checked_none",
  "present",
  "contradictory",
  "unknown"
]);
var CoverageStateSchema = external_exports.enum([
  "complete",
  "partial",
  "blocked",
  "stale"
]);
var DiagnosticStateSchema = external_exports.enum([
  "observed",
  "unknown",
  "blocked",
  "stale"
]);
var ProblemQualityGateSchema = external_exports.enum([
  "supported",
  "limited",
  "rejected"
]);
var EVIDENCE_ORIGINS = [
  "SOURCE_HTTP",
  "RENDERED_DOM",
  "ACCESSIBILITY",
  "VISUAL",
  "INTERACTION",
  "MEASUREMENT",
  "CLIENT_CONTEXT"
];
var EvidenceOriginSchema = external_exports.enum(EVIDENCE_ORIGINS);
var EvidenceKindSchema = external_exports.enum([
  "page",
  "element",
  "link",
  "form",
  "screenshot",
  "performance",
  "accessibility",
  "contact-fact",
  "competitor",
  "probe"
]);
var EvidenceScalarSchema = external_exports.union([
  external_exports.string().max(4e3),
  external_exports.number().finite(),
  external_exports.boolean(),
  external_exports.null()
]);
var EvidencePayloadKeySchema = external_exports.string().trim().min(1).max(200);
var EvidencePayloadSchema = external_exports.record(EvidencePayloadKeySchema, EvidenceScalarSchema).superRefine((payload, context) => {
  if (Object.keys(payload).length > 100) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "Evidence payloads may contain at most 100 fields."
    });
  }
});
var EvidenceRefSchema = external_exports.object({
  id: boundedId,
  runId: boundedId,
  kind: EvidenceKindSchema,
  locator: boundedText,
  pageUrl: external_exports.string().trim().min(1).max(2e3).optional(),
  screenshotId: boundedId.optional(),
  viewport: external_exports.enum(["desktop", "mobile"]).optional(),
  observedAt: boundedId,
  payload: EvidencePayloadSchema
}).strict();
var EvidenceAssessmentObjectSchema = external_exports.object({
  grade: EvidenceGradeSchema,
  claimScope: ClaimScopeSchema,
  coverage: CoverageStateSchema,
  limitations: boundedStringList(50),
  counterEvidence: boundedStringList(50),
  counterEvidenceState: CounterEvidenceStateSchema,
  unassessedEvidence: boundedStringList(50)
}).strict().superRefine((assessment, context) => {
  const hasDetails = assessment.counterEvidence.length > 0;
  if (assessment.counterEvidenceState === "checked_none" && hasDetails) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["counterEvidenceState"],
      message: "checked_none cannot carry counter-evidence details."
    });
  }
  if ((assessment.counterEvidenceState === "present" || assessment.counterEvidenceState === "contradictory") && !hasDetails) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["counterEvidence"],
      message: `${assessment.counterEvidenceState} requires counter-evidence details.`
    });
  }
  if (assessment.counterEvidenceState === "not_checked" && hasDetails) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["counterEvidenceState"],
      message: "not_checked cannot carry counter-evidence details."
    });
  }
});
var EvidenceAssessmentSchema = external_exports.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record2 = value;
  if (record2.counterEvidenceState !== void 0) return value;
  const details = Array.isArray(record2.counterEvidence) ? record2.counterEvidence : [];
  return {
    ...record2,
    counterEvidenceState: details.length > 0 ? "present" : "not_checked"
  };
}, EvidenceAssessmentObjectSchema);
var SubjectSchema = external_exports.object({
  kind: external_exports.enum(["site", "page", "element", "journey", "competitor"]),
  key: boundedText
}).strict();
var LegacyDiagnosticDetailsSchema = external_exports.object({
  kind: external_exports.literal("legacy"),
  legacyRuleId: RuleIdSchema,
  /** Historical aggregate suppression refs retained for legacy candidates. */
  suppressedEvidenceRefs: boundedStringList(500, 2e3).optional()
}).strict();
var CompatibilityUrlSchema = external_exports.string().min(1).max(2e3);
var CompatibilityUrlListItemSchema = external_exports.string().max(2e3);
var CompatibilityTextSchema = external_exports.string().max(4e3);
var CompatibilityStringListSchema = external_exports.array(CompatibilityUrlListItemSchema).max(100);
var CompatibilityCloseMatchSchema = external_exports.object({
  where: external_exports.enum([
    "crawled-page",
    "page-title",
    "heading",
    "nav-label",
    "link-label",
    "link-href",
    "sitemap-url",
    "fetched-page"
  ]),
  value: CompatibilityTextSchema,
  url: external_exports.string().max(2e3).optional(),
  score: external_exports.number().finite().min(0).max(1),
  satisfied: external_exports.boolean(),
  reason: CompatibilityTextSchema
}).strict();
var StrictVerificationSchema = external_exports.object({
  conclusion: external_exports.enum(["absent", "present", "inconclusive", "weak"]),
  inspectedUrls: CompatibilityStringListSchema.default([]),
  closeMatches: external_exports.array(CompatibilityCloseMatchSchema).max(100).default([]),
  reason: CompatibilityTextSchema.default("")
}).strict();
var StrictConversionDefectSchema = external_exports.object({
  kind: external_exports.enum([
    "dead-conversion-link",
    "conversion-page-error",
    "malformed-tel",
    "broken-form-target"
  ]),
  pageUrl: CompatibilityUrlSchema,
  elementText: CompatibilityTextSchema.default(""),
  elementHref: CompatibilityTextSchema.default(""),
  target: external_exports.string().max(2e3).optional(),
  observedStatus: external_exports.number().finite().int().min(-9999).max(9999).optional(),
  seenOn: external_exports.array(CompatibilityUrlSchema).max(100).default([]),
  note: CompatibilityTextSchema.default("")
}).strict();
var VerificationDiagnosticDetailsSchema = external_exports.object({
  kind: external_exports.literal("verification"),
  verification: StrictVerificationSchema,
  /**
   * Where the offering this verification searched for came from. Recorded
   * here because "the site has no page for X" means something different when
   * X was read off the site than when X was typed into the client profile.
   */
  offeringProvenance: OfferingProvenanceClassSchema.optional()
}).strict();
var ConversionDiagnosticDetailsSchema = external_exports.object({
  kind: external_exports.literal("conversion_defect"),
  conversionDefect: StrictConversionDefectSchema
}).strict();
var BroadEvidenceTypeSchema = external_exports.enum([
  "page",
  "element",
  "link",
  "form",
  "screenshot",
  "performance",
  "accessibility",
  "contact-fact",
  "competitor",
  "probe",
  "cta",
  "form-field",
  "landmark",
  "section",
  "proof",
  "date-fact",
  "resource",
  "console",
  "rendered"
]);
function containsUrlLikeValue(value) {
  return /[a-z][a-z\d+.-]*:\/\//i.test(value) || /(?:^|[\s=])\/\/[^\s]+/.test(value) || /\b(?:mailto|tel|sms|ftp|file|data|javascript):[^\s]+/i.test(value) || /(?:^|[\s=(])(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,62}\.)+[a-z]{2,}(?:[/:?#][^\s]*)?/i.test(value);
}
__name(containsUrlLikeValue, "containsUrlLikeValue");
var BroadObservationKeySchema = external_exports.string().trim().min(1).max(200).refine((value) => !containsUrlLikeValue(value), {
  message: "Broad observation keys must reference supplied evidence, not URLs."
}).refine((value) => !/[<>]/.test(value), {
  message: "Broad observation keys cannot contain markup."
}).refine((value) => !/(?:price|revenue|traffic|demand|password|credential|secret|token|api[-_ ]?key|authorization|auth(?:entication)?|cookie|session|bearer|access[-_ ]?key|private[-_ ]?key|client[-_ ]?secret|raw[-_ ]?html)/i.test(value), {
  message: "Broad observation keys cannot identify commercial or sensitive payloads."
});
var BroadReasonSchema = boundedShortText.refine(
  (value) => !containsUrlLikeValue(value) && !/[<>]/.test(value) && !/\b(?:price|revenue|traffic|demand|password|credential|secret|token|api[-_ ]?key|authorization|auth(?:entication)?|cookie|session|bearer|access[-_ ]?key|private[-_ ]?key|client[-_ ]?secret|raw[-_ ]?html)\b/i.test(value),
  "Broad reasons cannot contain URLs, commercial claims, or sensitive payloads."
);
var BroadMeasurementKeySchema = external_exports.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_.:-]*$/i, "Measurement keys must be bounded identifiers.").refine(
  (value) => !/(?:price|revenue|traffic|demand|html|credential|password|secret|token|query|request[-_ ]?body|email[-_ ]?value|phone[-_ ]?value)/i.test(
    value
  ),
  "Measurement keys cannot carry commercial or sensitive values."
);
var BroadMeasurementUnitSchema = external_exports.enum([
  "count",
  "items",
  "px",
  "ms",
  "s",
  "bytes",
  "ratio",
  "percent",
  "score",
  "status"
]);
var BroadMeasurementSchema = external_exports.object({
  key: BroadMeasurementKeySchema,
  value: external_exports.number().finite().min(-1e9).max(1e9),
  unit: BroadMeasurementUnitSchema
}).strict();
var BroadDiagnosticDetailsSchema = external_exports.object({
  kind: external_exports.literal("broad"),
  evidenceType: BroadEvidenceTypeSchema,
  observationKeys: external_exports.array(BroadObservationKeySchema).min(1).max(100),
  measurements: external_exports.array(BroadMeasurementSchema).max(20).optional(),
  reason: BroadReasonSchema,
  /**
   * Which contact fact a mismatch or conflict concerns ("email", "phone", …).
   *
   * The detector already knows it; recording it as data rather than leaving
   * it inside the prose is what lets the publication layer recognise that the
   * same fact conflicts on ten pages, instead of publishing the condition
   * once per page.
   */
  contactFactKind: external_exports.string().trim().min(1).max(40).regex(/^[a-z][a-z0-9 -]*$/, "Contact fact kinds are plain lowercase labels.").optional()
}).strict();
var SemanticDiagnosticDetailsSchema = external_exports.object({
  kind: external_exports.literal("semantic"),
  source: external_exports.literal("site-understanding"),
  reason: BroadReasonSchema
}).strict();
var DiagnosticDetailsSchema = external_exports.discriminatedUnion("kind", [
  LegacyDiagnosticDetailsSchema,
  VerificationDiagnosticDetailsSchema,
  ConversionDiagnosticDetailsSchema,
  BroadDiagnosticDetailsSchema,
  SemanticDiagnosticDetailsSchema
]);
var DiagnosticDraftSchema = external_exports.object({
  detectorId: boundedId,
  detectorVersion: boundedId,
  category: InsightCategorySchema2,
  problemType: ProblemTypeSchema2,
  subject: SubjectSchema,
  observation: boundedLongText,
  legacyEvidenceRefs: boundedStringList(500, 2e3),
  rawConfidence: external_exports.number().finite().min(0).max(1),
  state: DiagnosticStateSchema,
  details: DiagnosticDetailsSchema.optional(),
  claimScope: ClaimScopeSchema.optional(),
  counterEvidence: boundedStringList(50, 2e3).optional(),
  counterEvidenceState: CounterEvidenceStateSchema.optional(),
  /** Provenance: which kind of observation produced this draft. */
  origin: EvidenceOriginSchema.optional()
}).strict().superRefine((draft, context) => {
  const definition3 = definitionForProblemType(draft.problemType);
  if (definition3.category !== draft.category) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["category"],
      message: `Problem type ${draft.problemType} belongs to ${definition3.category}.`
    });
  }
  if ((definition3.legacyRuleId === null || draft.details?.kind === "broad" || draft.details?.kind === "semantic") && draft.state === "observed" && draft.legacyEvidenceRefs.length === 0) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["legacyEvidenceRefs"],
      message: "An observed non-legacy diagnostic requires typed evidence."
    });
  }
  const counterEvidence = draft.counterEvidence ?? [];
  if (draft.counterEvidenceState === "checked_none" && counterEvidence.length > 0) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["counterEvidenceState"],
      message: "checked_none cannot carry counter-evidence details."
    });
  }
  if ((draft.counterEvidenceState === "present" || draft.counterEvidenceState === "contradictory") && counterEvidence.length === 0) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["counterEvidence"],
      message: `${draft.counterEvidenceState} requires counter-evidence details.`
    });
  }
  if (draft.counterEvidenceState === "not_checked" && counterEvidence.length > 0) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["counterEvidenceState"],
      message: "not_checked cannot carry counter-evidence details."
    });
  }
});
var DiagnosticSchema = external_exports.object({
  id: boundedId,
  workspaceId: boundedId,
  runId: boundedId,
  clientId: boundedId,
  detectorId: boundedId,
  detectorVersion: boundedId,
  category: InsightCategorySchema2,
  problemType: ProblemTypeSchema2,
  subject: SubjectSchema,
  observation: boundedLongText,
  evidenceRefs: boundedStringList(1e3, 2e3),
  assessment: EvidenceAssessmentSchema,
  state: DiagnosticStateSchema,
  fingerprint: boundedText,
  affectedPages: boundedStringList(1e3, 2e3).default([]),
  details: DiagnosticDetailsSchema.optional(),
  /** Provenance: which kind of observation produced this diagnostic. */
  origin: EvidenceOriginSchema.optional(),
  createdAt: boundedId
}).strict().superRefine((diagnostic, context) => {
  const definition3 = definitionForProblemType(diagnostic.problemType);
  if (definition3.category !== diagnostic.category) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["category"],
      message: `Problem type ${diagnostic.problemType} belongs to ${definition3.category}.`
    });
  }
  if ((definition3.legacyRuleId === null || diagnostic.details?.kind === "broad" || diagnostic.details?.kind === "semantic") && diagnostic.state === "observed" && diagnostic.evidenceRefs.length === 0) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["evidenceRefs"],
      message: "An observed non-legacy diagnostic requires typed evidence."
    });
  }
  if (definition3.requiresCompleteCoverage && diagnostic.state === "observed" && diagnostic.assessment.coverage !== "complete") {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["assessment", "coverage"],
      message: "An absence diagnostic cannot be observed from partial coverage."
    });
  }
});
var ProblemSchema = external_exports.object({
  id: boundedId,
  workspaceId: boundedId,
  runId: boundedId,
  clientId: boundedId,
  canonicalKey: boundedText,
  category: InsightCategorySchema2,
  problemType: ProblemTypeSchema2,
  surfaceKey: boundedText,
  statement: boundedLongText,
  whyItMatters: boundedLongText,
  businessConsequence: boundedLongText,
  diagnosticIds: boundedStringList(1e3, 2e3),
  evidenceRefs: boundedStringList(1e3, 2e3),
  affectedPages: boundedStringList(1e3, 2e3),
  assessment: EvidenceAssessmentSchema,
  validationSteps: boundedStringList(50),
  qualityGate: ProblemQualityGateSchema,
  rejectionReasons: boundedStringList(50),
  createdAt: boundedId
}).strict().superRefine((problem, context) => {
  const definition3 = definitionForProblemType(problem.problemType);
  if (definition3.category !== problem.category) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["category"],
      message: `Problem type ${problem.problemType} belongs to ${definition3.category}.`
    });
  }
  if (problem.qualityGate === "supported" && problem.assessment.claimScope === "hypothesis") {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["qualityGate"],
      message: "A hypothesis cannot be published as a supported problem."
    });
  }
  if (problem.qualityGate === "supported" && definition3.requiresCompleteCoverage && problem.assessment.coverage !== "complete") {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["assessment", "coverage"],
      message: "An absence problem requires complete coverage before support."
    });
  }
});
var CategoryAssessmentStateSchema = external_exports.enum([
  "assessed",
  "limited",
  "blocked",
  "unavailable",
  "not_applicable",
  "unassessed"
]);
var AnalysisCategoryAssessmentSchema = external_exports.object({
  category: InsightCategorySchema2,
  state: CategoryAssessmentStateSchema,
  diagnosticCount: external_exports.number().int().nonnegative().max(1e4),
  problemCount: external_exports.number().int().nonnegative().max(1e4),
  reason: boundedShortText.optional(),
  limitations: boundedStringList(50)
}).strict().superRefine((assessment, context) => {
  if (assessment.state !== "assessed" && !assessment.reason) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["reason"],
      message: "A category that was not fully assessed requires a bounded reason."
    });
  }
});
var CrawlCoverageSchema2 = external_exports.object({
  exhaustive: external_exports.boolean(),
  discovered: external_exports.number().int().nonnegative(),
  attempted: external_exports.number().int().nonnegative(),
  retrieved: external_exports.number().int().nonnegative(),
  failed: external_exports.number().int().nonnegative(),
  rendered: external_exports.number().int().nonnegative(),
  /** Discovered URLs deliberately left unread once the page budget was spent. */
  deferredByPageBudget: external_exports.number().int().nonnegative(),
  /** Discovered URLs recognised as another URL of a page already read. */
  duplicatesOfPagesAlreadyRead: external_exports.number().int().nonnegative(),
  offSite: external_exports.number().int().nonnegative(),
  otherReasons: external_exports.number().int().nonnegative()
}).strict();
var InsightSnapshotSchema = external_exports.object({
  workspaceId: boundedId,
  runId: boundedId,
  clientId: boundedId,
  evidence: external_exports.array(EvidenceRefSchema).max(1e4),
  diagnostics: external_exports.array(DiagnosticSchema).max(5e3),
  problems: external_exports.array(ProblemSchema).max(2e3),
  categories: external_exports.array(AnalysisCategoryAssessmentSchema).max(INSIGHT_CATEGORIES.length),
  limitations: boundedStringList(100).optional(),
  crawlCoverage: CrawlCoverageSchema2.optional(),
  accounting: InsightAccountingSchema.default(() => legacyInsightAccounting())
}).strict().superRefine((snapshot, context) => {
  const categoryNames = snapshot.categories.map((category) => category.category);
  const uniqueCategories = new Set(categoryNames);
  if (categoryNames.length !== INSIGHT_CATEGORIES.length || uniqueCategories.size !== INSIGHT_CATEGORIES.length || INSIGHT_CATEGORIES.some((category) => !uniqueCategories.has(category))) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["categories"],
      message: "An insight snapshot must contain each category exactly once."
    });
  }
  const mismatchedDiagnostic = snapshot.diagnostics.find(
    (diagnostic) => diagnostic.workspaceId !== snapshot.workspaceId || diagnostic.runId !== snapshot.runId || diagnostic.clientId !== snapshot.clientId
  );
  if (mismatchedDiagnostic) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["diagnostics"],
      message: "Snapshot diagnostics must belong to the snapshot workspace, run, and client."
    });
  }
  const mismatchedProblem = snapshot.problems.find(
    (problem) => problem.workspaceId !== snapshot.workspaceId || problem.runId !== snapshot.runId || problem.clientId !== snapshot.clientId
  );
  if (mismatchedProblem) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["problems"],
      message: "Snapshot problems must belong to the snapshot workspace, run, and client."
    });
  }
  const mismatchedEvidence = snapshot.evidence.find(
    (evidence) => evidence.runId !== snapshot.runId
  );
  if (mismatchedEvidence) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["evidence"],
      message: "Snapshot evidence must belong to the snapshot run."
    });
  }
});
