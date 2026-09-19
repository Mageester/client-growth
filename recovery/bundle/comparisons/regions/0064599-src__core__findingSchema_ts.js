// src/core/findingSchema.ts
var FINDING_CALIBRATIONS = [
  /** An observed, evidence-supported condition of the website. */
  "VERIFIED_DEFECT",
  /** Supported inference about commercial opportunity, not a defect claim. */
  "EVIDENCE_BACKED_COMMERCIAL_OPPORTUNITY",
  /** A real observation whose meaning depends on client context we do not have. */
  "NEEDS_CLIENT_CONTEXT",
  /** Not publishable: rejected, contradictory, or hypothesis-only. */
  "UNSUPPORTED",
  /** Orbit's own measurement/capture limit. Never a claim about the website. */
  "ORBIT_MEASUREMENT_LIMITATION"
];
var FindingCalibrationSchema = external_exports.enum(FINDING_CALIBRATIONS);
var FINDING_TIERS = [
  "broken_conversion",
  "unreachable_content",
  "placeholder_production",
  "contact_action_mismatch",
  "trust_content_inconsistency",
  "accessibility_usability",
  "commercial_opportunity",
  "minor_metadata",
  "maintenance"
];
var FindingTierSchema = external_exports.enum(FINDING_TIERS);
var FINDING_TIER_RANK = {
  broken_conversion: 1,
  unreachable_content: 2,
  placeholder_production: 3,
  contact_action_mismatch: 4,
  trust_content_inconsistency: 5,
  accessibility_usability: 6,
  commercial_opportunity: 7,
  minor_metadata: 8,
  maintenance: 9
};
var FINDING_SOURCES = [
  "deterministic",
  "broad_detector",
  "visual",
  "semantic"
];
var FindingSourceSchema = external_exports.enum(FINDING_SOURCES);
var boundedId3 = external_exports.string().trim().min(1).max(200);
var boundedText3 = external_exports.string().trim().max(5e3);
var boundedShort = external_exports.string().trim().max(500);
var boundedList = /* @__PURE__ */ __name((maxItems, maxLength = 2e3) => external_exports.array(external_exports.string().trim().min(1).max(maxLength)).max(maxItems), "boundedList");
var FindingCatalogMatchSchema = external_exports.object({
  serviceId: boundedId3,
  serviceName: external_exports.string().trim().max(300),
  /** Which catalog rule tag this finding maps to, if any. */
  tag: external_exports.string().trim().max(200).optional(),
  state: external_exports.enum(["direct", "adjacent", "manual_review"])
}).strict();
var FindingEvidenceCapSchema = external_exports.object({
  detectorId: boundedId3,
  limit: external_exports.number().int().nonnegative(),
  observed: external_exports.number().int().nonnegative(),
  emitted: external_exports.number().int().nonnegative(),
  omitted: external_exports.number().int().nonnegative()
}).strict();
var PublishedFindingSchema = external_exports.object({
  /** Stable run-scoped identity, inherited from the source diagnostic/problem/draft. */
  id: boundedId3,
  /**
   * Content address that survives a re-run against an unchanged site:
   * problem type + canonical surface + affected pages. Deliberately excludes
   * model prose.
   */
  fingerprint: boundedId3,
  statement: boundedText3,
  whyItMatters: boundedText3,
  businessConsequence: boundedText3.nullable(),
  category: InsightCategorySchema2,
  problemType: ProblemTypeSchema2,
  calibration: FindingCalibrationSchema,
  origin: EvidenceOriginSchema,
  tier: FindingTierSchema,
  rank: external_exports.number().int().min(1).max(9),
  confidence: EvidenceGradeSchema,
  claimScope: ClaimScopeSchema,
  pages: boundedList(1e3),
  evidenceIds: boundedList(1e3),
  evidenceLabels: boundedList(1e3),
  validationSteps: boundedList(50),
  limitations: boundedList(100),
  /** null is valid and expected: the finding exists without a sellable match. */
  catalogMatch: FindingCatalogMatchSchema.nullable(),
  /** Set only when this finding was also priced into an opportunity. */
  opportunityId: boundedId3.nullable(),
  source: FindingSourceSchema,
  /** True when the evidence critic retained this item. */
  reviewed: external_exports.boolean(),
  /** Only present for measurement limitations: what Orbit could not measure. */
  measurementLimitation: boundedShort.optional(),
  /**
   * Detector evidence caps that bound this finding's population. Present only
   * when a detector that produced the cited evidence stopped at its cap, so
   * every count in the statement is a lower bound and says so.
   */
  evidenceCaps: external_exports.array(FindingEvidenceCapSchema).max(20).optional()
}).strict();
var FindingSetSchema = external_exports.object({
  runId: boundedId3,
  /**
   * Customer-facing findings: conditions of the website, ranked by business
   * impact. This collection is deliberately free of Orbit's own measurement
   * ceilings — see `limitations`.
   */
  findings: external_exports.array(PublishedFindingSchema).max(2e3),
  /**
   * Orbit's own measurement and capture ceilings, kept in full.
   *
   * These are real and must stay auditable: a reduced audit is not the same
   * as a clean site, and hiding reduced coverage would be a silent lie. They
   * are simply not claims about the customer's website, so they no longer
   * share a collection with the defects. Every entry still carries its
   * calibration, evidence and `measurementLimitation` text.
   */
  limitations: external_exports.array(PublishedFindingSchema).max(2e3).default([]),
  /** Findings that exist but are not publishable, kept for internal audit. */
  withheld: external_exports.number().int().nonnegative()
}).strict();
