import { z } from "zod";
import { RenderedPageObservationSchema, VisualReviewSchema } from "@/core/visualSchema";

/**
 * Every cross-boundary contract in the product is defined here as a Zod schema.
 * Types are inferred, never hand-written, so validation and types cannot drift.
 */

// ---------------------------------------------------------------------------
// Agency service catalog
// ---------------------------------------------------------------------------
export const ServiceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default(""),
    priceMin: z.number().nonnegative(),
    priceMax: z.number().nonnegative(),
    /** Machine tags used by rules to map a detection to a service, e.g. "landing-page". */
    tags: z.array(z.string()).default([]),
    active: z.boolean().default(true),
  })
  .refine((s) => s.priceMax >= s.priceMin, {
    message: "priceMax must be greater than or equal to priceMin",
    path: ["priceMax"],
  });
export type Service = z.infer<typeof ServiceSchema>;

// ---------------------------------------------------------------------------
// Existing clients
// ---------------------------------------------------------------------------
export const ClientSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Bare hostname or URL of the client's site, e.g. "coolbreezehvac.example". */
  domain: z.string().min(1),
  /** The CLIENT's own business services (what they sell to their customers). */
  offerings: z.array(z.string().min(1)).default([]),
  /**
   * What one typical job is worth to THIS CLIENT'S business — not to the
   * agency. Optional, and supplied by the agency rather than inferred.
   *
   * It exists so a finding can be expressed in the only currency that moves a
   * client: their own work. "$900-$1,800" is an invoice line; "less than one
   * job" is a reason to say yes. Everything derived from it is arithmetic on
   * this number (see core/clientValue.ts) — there is no model, no traffic
   * estimate and no multiplier, because a confident-sounding invented number
   * is precisely what this product refuses to produce.
   */
  averageJobValue: z.number().positive().optional(),
  notes: z.string().default(""),
});
export type Client = z.infer<typeof ClientSchema>;

/**
 * Contract coverage. A single concept: the agency service `serviceId` is already
 * covered by this client's contract (whether "already paid for" or "included").
 * Work that maps to a covered service is never surfaced as a billable upsell.
 */
export const CoverageSchema = z.object({
  clientId: z.string().min(1),
  serviceId: z.string().min(1),
  covered: z.literal(true),
  note: z.string().optional(),
});
export type Coverage = z.infer<typeof CoverageSchema>;

// ---------------------------------------------------------------------------
// Website evidence (provenance preserved, no unsupported claims)
// ---------------------------------------------------------------------------
export const EvidenceTextSchema = z.string().trim().max(500);
export const EvidenceElementKeySchema = z.string().trim().min(1).max(120);
export const EvidenceRegionSchema = z.enum(["header", "hero", "nav", "main", "form", "proof", "footer", "page", "unknown"]);
export const EvidenceGeometrySchema = z.object({
  left: z.number().finite().nonnegative(),
  top: z.number().finite().nonnegative(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
  viewportWidth: z.number().int().positive(),
  viewportHeight: z.number().int().positive(),
  horizontallyClipped: z.boolean(),
}).strict();

function safeEvidenceHref(value: string): boolean {
  if (value === "") return true;
  try {
    const parsed = new URL(value, "https://client-growth.invalid/");
    if (!["http:", "https:", "tel:", "mailto:"].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password) return false;
    if ((parsed.protocol === "tel:" || parsed.protocol === "mailto:") && parsed.search) return false;
    return ![...parsed.searchParams.keys()].some((key) => /pass(word)?|token|secret|api[-_]?key|auth|credential/i.test(key));
  } catch { return false; }
}

function safeEvidenceFormAction(value: string): boolean {
  if (value === "") return true;
  try {
    const parsed = new URL(value, "https://client-growth.invalid/");
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password) return false;
    return ![...parsed.searchParams.keys()].some((key) => /pass(word)?|token|secret|api[-_]?key|auth|credential/i.test(key));
  } catch { return false; }
}

export const EvidenceAvailabilityKindSchema = z.enum(["page", "element", "link", "form", "screenshot", "performance", "accessibility", "contact-fact", "competitor", "probe"]);
export const EvidenceAvailabilitySchema = z.object({ kind: EvidenceAvailabilityKindSchema, state: z.enum(["available", "partial", "unavailable"]), observedCount: z.number().int().nonnegative().max(10_000), reason: EvidenceTextSchema.optional() }).strict();

export const EvidenceFormFieldSchema = z.object({
  elementKey: EvidenceElementKeySchema,
  controlType: z.string().trim().min(1).max(50),
  name: z.string().trim().max(200).default(""),
  required: z.boolean().default(false),
  autocomplete: z.string().trim().max(100).optional(),
  label: EvidenceTextSchema.default(""),
  accessibleName: EvidenceTextSchema.default(""),
  labelSource: z.enum(["label", "aria-label", "aria-labelledby", "placeholder", "name", "none"]).default("none"),
}).strict();
export const EvidenceCtaSchema = z.object({
  elementKey: EvidenceElementKeySchema,
  href: z.string().trim().max(2_000).refine(safeEvidenceHref, "CTA href must use a safe URL scheme").default(""),
  label: EvidenceTextSchema.default(""),
  accessibleName: EvidenceTextSchema.default(""),
  actionKind: z.enum(["navigation", "contact", "submit", "button"]),
  sourceRegion: EvidenceRegionSchema.default("page"),
  geometry: EvidenceGeometrySchema.optional(),
}).strict();
export const EvidenceLandmarkSchema = z.object({ elementKey: EvidenceElementKeySchema, role: z.enum(["banner", "header", "navigation", "main", "complementary", "contentinfo", "search", "form", "region"]), label: EvidenceTextSchema.default("") }).strict();
export const EvidenceContentSectionSchema = z.object({ elementKey: EvidenceElementKeySchema, kind: z.enum(["hero", "services", "proof", "contact", "faq", "pricing", "content", "unknown"]), heading: EvidenceTextSchema.default(""), textExcerpt: EvidenceTextSchema.default("") }).strict();
export const EvidenceProofSignalSchema = z.object({ sourceKey: EvidenceElementKeySchema, kind: z.enum(["testimonial", "review", "case-study", "credential", "guarantee", "rating", "logo", "unknown"]), text: EvidenceTextSchema.default("") }).strict();
export const EvidenceContactFactSchema = z.object({ sourceKey: EvidenceElementKeySchema, kind: z.enum(["phone", "email", "address", "hours", "social"]), value: EvidenceTextSchema, origin: z.enum(["visible_text", "action_target", "structured_data"]).optional() }).strict();
export const EvidenceDateFactSchema = z.object({ sourceKey: EvidenceElementKeySchema, kind: z.enum(["published", "updated", "offer-expiry", "event", "copyright", "unknown"]), value: EvidenceTextSchema }).strict();
export const EvidenceAccessibilityObservationSchema = z.object({ elementKey: EvidenceElementKeySchema, issue: z.enum(["missing-alt", "missing-accessible-name", "missing-label", "empty-label", "invalid-aria-reference"]), source: z.enum(["parsed", "rendered"]).default("parsed"), detail: EvidenceTextSchema.optional() }).strict();

/** A <form> discovered on a page: how it submits and whether it has a submit control. */
export const EvidenceFormSchema = z.object({
  /** Raw `action` attribute after credential redaction. */
  action: z.string().trim().max(2_000).refine(safeEvidenceFormAction, "Form action must use a safe credential-free HTTP target").default(""),
  /** Uppercased method; defaults to GET per the HTML spec. */
  method: z.enum(["GET", "POST"]).default("GET"),
  hasSubmit: z.boolean().default(false),
  fields: z.array(EvidenceFormFieldSchema).max(50).optional(),
  submitLabel: EvidenceTextSchema.optional(),
  actionTargetState: z.enum(["empty", "same-site", "off-site", "invalid", "redacted"]).optional(),
  submitDisabled: z.boolean().optional(),
  hasEnabledSubmitAlternative: z.boolean().optional(),
});
export type EvidenceForm = z.infer<typeof EvidenceFormSchema>;

/** A discovered image. An omitted alt attribute is distinct from alt="". */
export const EvidenceImageSchema = z.object({
  /** Raw or resolved image source, when the element exposed one. */
  src: z.string().default(""),
  /** Undefined means the attribute was absent; an empty string is decorative. */
  alt: z.string().optional(),
});
export type EvidenceImage = z.infer<typeof EvidenceImageSchema>;

export const EvidencePageSchema = z.object({
  url: z.string().url(),
  /** HTTP status the crawler received for this page. */
  status: z.number().int().default(200),
  title: z.string().default(""),
  h1s: z.array(z.string()).default([]),
  headings: z.array(z.string()).default([]),
  /** Short excerpt kept for provenance, not for analysis. */
  textExcerpt: z.string().default(""),
  wordCount: z.number().int().nonnegative().default(0),
  forms: z.array(EvidenceFormSchema).default([]),
  /**
   * These fields are optional on purpose. Bundles captured before the parser
   * learned to observe them must remain unknown rather than becoming an
   * observed absence through a default empty value.
   */
  metaDescription: z.string().optional(),
  structuredDataTypes: z.array(z.string()).optional(),
  /** Whether any JSON-LD, microdata, or RDFa structured data was observed. */
  structuredDataPresent: z.boolean().optional(),
  images: z.array(EvidenceImageSchema).optional(),
  ctas: z.array(EvidenceCtaSchema).max(100).optional(),
  landmarks: z.array(EvidenceLandmarkSchema).max(50).optional(),
  sections: z.array(EvidenceContentSectionSchema).max(100).optional(),
  proofSignals: z.array(EvidenceProofSignalSchema).max(100).optional(),
  contactFacts: z.array(EvidenceContactFactSchema).max(100).optional(),
  datedFacts: z.array(EvidenceDateFactSchema).max(100).optional(),
  accessibility: z.array(EvidenceAccessibilityObservationSchema).max(200).optional(),
});
export type EvidencePage = z.infer<typeof EvidencePageSchema>;

/** A link discovered while crawling: its href, anchor text, and where it was seen. */
export const EvidenceLinkSchema = z.object({
  href: z.string().min(1),
  label: z.string().default(""),
  /** http (same-origin page link), or a tel:/mailto: contact link. */
  scheme: z.enum(["http", "tel", "mailto"]).default("http"),
  ariaLabel: z.string().default(""),
  title: z.string().default(""),
  /** True when this link appeared inside a <nav> / role="navigation" region. */
  inNav: z.boolean().default(false),
  /** True when the site grouped this link below a Services/Treatments menu heading. */
  inServiceNav: z.boolean().default(false),
  /** URLs of the crawled pages this link appeared on. */
  foundOn: z.array(z.string()).default([]),
});
export type EvidenceLink = z.infer<typeof EvidenceLinkSchema>;

/** Stable categories for transport and evidence-boundary diagnostics. */
export const EvidenceFailureCodeSchema = z.enum([
  "policy",
  "robots",
  "timeout",
  "network",
  "redirect",
  "request-budget",
  "content-type",
  "response-size",
  "response-body",
  "http-status",
  "aborted",
  "js-shell",
]);
export type EvidenceFailureCode = z.infer<typeof EvidenceFailureCodeSchema>;

/** Which part of the crawl observed the limitation. */
export const EvidenceNetworkStageSchema = z.enum([
  "robots",
  "sitemap",
  "page",
  "targeted-page",
  "probe",
]);
export type EvidenceNetworkStage = z.infer<typeof EvidenceNetworkStageSchema>;

/** A network-policy failure preserved with an HTTP evidence run. */
export const EvidenceNetworkEventSchema = z.object({
  /** Redacted/canonical URL when it was parseable. */
  url: z.string().min(1),
  outcome: z.enum(["blocked", "inconclusive"]),
  reason: z.string().min(1),
  /** Optional on old bundles; every new provider event supplies it. */
  code: EvidenceFailureCodeSchema.optional(),
  /** Optional on old bundles; every new provider event supplies it. */
  stage: EvidenceNetworkStageSchema.optional(),
  /** HTTP status when a response was received but was not usable. */
  status: z.number().int().optional(),
  /** Validated redirect hops observed before the failure. */
  redirects: z.number().int().nonnegative().optional(),
});
export type EvidenceNetworkEvent = z.infer<typeof EvidenceNetworkEventSchema>;

export const CrawlIgnoredReasonSchema = z.enum(["invalid-url", "off-site", "duplicate", "robots", "page-budget", "platform-path"]);
export const CrawlCoverageSchema = z.object({
  discoveredUrls: z.number().int().nonnegative(),
  attemptedUrls: z.number().int().nonnegative(),
  retrievedUrls: z.number().int().nonnegative(),
  renderedUrls: z.number().int().nonnegative(),
  failedUrls: z.number().int().nonnegative(),
  ignoredUrls: z.array(z.object({ url: z.string().min(1), reason: CrawlIgnoredReasonSchema })).max(100),
  redirectHops: z.number().int().nonnegative(),
  canonicalPages: z.number().int().nonnegative(),
  maxDepth: z.number().int().nonnegative(),
  screenshotsCaptured: z.number().int().nonnegative(),
});
export const EvidenceObservedPageUrlSchema = z.string().max(2_000).url();
export const EvidenceResourceFailureSchema = z.object({
  pageUrl: EvidenceObservedPageUrlSchema,
  url: EvidenceObservedPageUrlSchema,
  resourceType: z.enum(["document", "stylesheet", "script", "image", "font", "xhr", "fetch", "other"]),
  status: z.number().int().min(100).max(599).optional(),
  reason: z.string().trim().min(1).max(500),
  source: z.enum(["http", "rendered"]),
  cause: z.enum(["site", "orbit-limit"]).optional(),
  observedAt: z.string().trim().min(1).max(200).optional(),
}).strict();
export const EvidenceConsoleErrorSchema = z.object({
  pageUrl: EvidenceObservedPageUrlSchema,
  level: z.enum(["error", "warning"]),
  message: z.string().trim().min(1).max(1_000),
  source: z.literal("rendered"),
  sourceUrl: EvidenceObservedPageUrlSchema.optional(),
  lineNumber: z.number().int().nonnegative().max(10_000_000).optional(),
  columnNumber: z.number().int().nonnegative().max(10_000_000).optional(),
  observedAt: z.string().trim().min(1).max(200).optional(),
}).strict();
export const EvidencePerformanceObservationSchema = z.object({
  pageUrl: EvidenceObservedPageUrlSchema,
  status: z.number().int().min(100).max(599).optional(),
  responseTimeMs: z.number().finite().nonnegative().max(120_000),
  transferSizeBytes: z.number().int().nonnegative().max(20_000_000),
  source: z.enum(["http", "rendered"]),
  observedAt: z.string().trim().min(1).max(200).optional(),
}).strict();

export const EvidenceBundleSchema = z.object({
  visualReview: VisualReviewSchema.optional(),
  clientId: z.string().min(1),
  source: z.enum(["fixture", "http"]),
  capturedAt: z.string().min(1), // ISO timestamp
  site: z.object({
    pages: z.array(EvidencePageSchema),
    /** Navigation labels (kept for display / back-compat). */
    nav: z.array(z.string()).default([]),
    /** All discovered same-origin links with anchor text. */
    links: z.array(EvidenceLinkSchema).default([]),
    /** URLs listed in /sitemap.xml when cheaply available. */
    sitemapUrls: z.array(z.string()).default([]),
    /**
     * The crawl ran out of links before it ran out of budget, and nothing was
     * refused or unreadable along the way — so this is the whole site, not a
     * sample of it.
     *
     * This is the difference between "we looked everywhere and this business
     * has no service pages" and "we could not get far enough to tell", which
     * are the same silence and need opposite messages. Defaults to false so an
     * evidence bundle persisted before this field existed is treated as the
     * weaker claim rather than the stronger one.
     */
    crawlExhaustive: z.boolean().default(false),
    coverage: CrawlCoverageSchema.optional(),
  }),
  /** Network-policy failures are evidence limitations, never website defects. */
  networkEvents: z.array(EvidenceNetworkEventSchema).default([]),
  resourceFailures: z.array(EvidenceResourceFailureSchema).max(200).optional(),
  consoleErrors: z.array(EvidenceConsoleErrorSchema).max(100).optional(),
  performanceObservations: z.array(EvidencePerformanceObservationSchema).max(100).optional(),
  renderedPages: z.array(RenderedPageObservationSchema).max(8).optional(),
  evidenceAvailability: z.array(EvidenceAvailabilitySchema).max(20).optional(),
});
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

// ---------------------------------------------------------------------------
// Rule output (deterministic candidates, pre-AI)
// ---------------------------------------------------------------------------
export const RuleIdSchema = z.enum([
  "visual-conversion-opportunity",
  "missing-service-page",
  "no-service-pages",
  "broken-conversion-path",
  /**
   * The only rule that reads a site the client does not own. Two or more of the
   * client's named competitors have a page for a service the client neither
   * offers nor has a page for.
   */
  "competitor-service-gap",
  "missing-title",
  "duplicate-title",
  "thin-service-page",
  "missing-h1",
  "broken-internal-link",
  "missing-meta-description",
  "missing-structured-data",
  "missing-image-alt",
]);
export type RuleId = z.infer<typeof RuleIdSchema>;

/**
 * Deterministic record of a broken conversion element. Every field is something
 * literally observed — never inferred from an aesthetic opinion.
 */
export const ConversionDefectSchema = z.object({
  kind: z.enum([
    "dead-conversion-link",
    "conversion-page-error",
    "malformed-tel",
    "broken-form-target",
  ]),
  /** The crawled page the broken element sits on (first occurrence). */
  pageUrl: z.string().min(1),
  /** Visible text / aria-label of the element. */
  elementText: z.string().default(""),
  /** The raw href / action of the element. */
  elementHref: z.string().default(""),
  /** The URL that was probed (for link/form defects), if any. */
  target: z.string().optional(),
  /** HTTP status observed for `target`, if probed. */
  observedStatus: z.number().int().optional(),
  /** All crawled pages the element appeared on. */
  seenOn: z.array(z.string()).default([]),
  note: z.string().default(""),
});
export type ConversionDefect = z.infer<typeof ConversionDefectSchema>;

/**
 * Deterministic record of the targeted "does a page for this offering already
 * exist?" check. Preserved on the candidate/opportunity so a human can audit
 * exactly what was inspected before the absence was claimed.
 */
export const VerificationSchema = z.object({
  // absent      = positively verified: no adequate page exists -> may surface
  // present     = an adequate existing page/section was found -> suppress
  // inconclusive= an existence signal was found but could not be verified
  //               (e.g. a matching nav label with no link) -> suppress
  // weak        = the offering has no distinctive words to verify -> suppress
  conclusion: z.enum(["absent", "present", "inconclusive", "weak"]),
  /** URLs actually fetched during targeted verification. */
  inspectedUrls: z.array(z.string()).default([]),
  /** Near-matches considered, and why each did or did not satisfy the offering. */
  closeMatches: z
    .array(
      z.object({
        where: z.enum([
          "crawled-page",
          "page-title",
          "heading",
          "nav-label",
          "link-label",
          "link-href",
          "sitemap-url",
          "fetched-page",
        ]),
        value: z.string(),
        url: z.string().optional(),
        score: z.number().min(0).max(1),
        satisfied: z.boolean(),
        reason: z.string(),
      }),
    )
    .default([]),
  reason: z.string().default(""),
});
export type Verification = z.infer<typeof VerificationSchema>;

export const CandidateSchema = z.object({
  ruleId: RuleIdSchema,
  /** What the candidate is about, e.g. "heat pump installation". */
  subject: z.string().min(1),
  /** Human-readable statement of what was detected. */
  detected: z.string().min(1),
  /** URLs / nav labels that justify the detection. */
  evidenceRefs: z.array(z.string()).default([]),
  /**
   * Evidence from legacy page-level findings the agency dismissed. Technical
   * aggregation keeps it with the canonical row so a re-run cannot turn an old
   * dismissal into a newly actionable site-level finding.
   */
  suppressedEvidenceRefs: z.array(z.string()).optional(),
  /** Deterministic pre-AI signal strength, 0..1. */
  rawConfidence: z.number().min(0).max(1),
  suggestedServiceId: z.string().min(1),
  verification: VerificationSchema.optional(),
  conversionDefect: ConversionDefectSchema.optional(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

// ---------------------------------------------------------------------------
// Evaluator output (cheap AI judgement + explanation)
// ---------------------------------------------------------------------------
/**
 * What the evaluator decided the candidate's subject actually IS.
 *
 * The deterministic rules already answer "is there evidence?". This is the
 * question they cannot answer: is the thing we are about to price a $900-$1,800
 * landing page for a service a customer hires this business for, or is it
 * something the business merely says about itself?
 *
 *   distinct_service  heat pump installation, drain cleaning, Invisalign
 *   trust_signal      fully insured, family owned, licensed technicians
 *   promotion         free quotes, financing available, satisfaction guarantee
 *   generic_claim     quality service, fast response, affordable pricing
 *   ambiguous         the evaluator cannot confidently place it
 *   conversion_defect not a subject classification at all - the candidate is a
 *                     probed broken conversion element, so the taxonomy above
 *                     does not apply
 *
 * Only `distinct_service` may become a missing-service-page opportunity;
 * everything else - `ambiguous` included - fails closed. See core/judgment.ts.
 */
export const SubjectTypeSchema = z.enum([
  "distinct_service",
  "trust_signal",
  "promotion",
  "generic_claim",
  "ambiguous",
  "conversion_defect",
]);
export type SubjectType = z.infer<typeof SubjectTypeSchema>;

export const EvaluationSchema = z.object({
  verdict: z.enum(["surface", "reject"]),
  /**
   * Evidence strength for the surfaced finding, 0..1.
   *
   * NOT a model self-report. A measured calibration run showed provider-supplied
   * confidence carried no usable signal (near-identical values for a real
   * service line and for "fully insured"), so DeepSeekEvaluator no longer asks
   * for one and derives this from the deterministic candidate instead.
   */
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  suggestedScope: z.array(z.string().min(1)).default([]),
  /**
   * Structured judgment. Optional on the type so offline/legacy evaluators stay
   * constructible, but a missing-service-page candidate with no `subjectType`
   * is REJECTED by the judgment policy rather than trusted.
   */
  subjectType: SubjectTypeSchema.optional(),
  commerciallyActionable: z.boolean().optional(),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

/**
 * The wire contract a real provider must satisfy for a missing-service-page
 * candidate. Deliberately different from `EvaluationSchema`: the model is asked
 * for a classification and a verdict, never for a confidence number, and every
 * field here is required so a partial answer fails closed instead of being
 * quietly defaulted into a surfaced opportunity.
 */
export const ServiceJudgmentSchema = z.object({
  subjectType: SubjectTypeSchema.exclude(["conversion_defect"]),
  commerciallyActionable: z.boolean(),
  verdict: z.enum(["surface", "reject"]),
  rationale: z.string().min(1),
  suggestedScope: z.array(z.string().min(1)).default([]),
});
export type ServiceJudgment = z.infer<typeof ServiceJudgmentSchema>;

/**
 * The wire contract for a broken-conversion-path candidate. The defect is a
 * probed HTTP fact, so there is no subject to classify - only whether it is
 * worth raising and what the fix is.
 */
export const DefectJudgmentSchema = z.object({
  commerciallyActionable: z.boolean(),
  verdict: z.enum(["surface", "reject"]),
  rationale: z.string().min(1),
  suggestedScope: z.array(z.string().min(1)).default([]),
});
export type DefectJudgment = z.infer<typeof DefectJudgmentSchema>;

// ---------------------------------------------------------------------------
// Opportunity (surfaced output + persisted agency decision)
// ---------------------------------------------------------------------------
export const BillabilityStatusSchema = z.enum(["billable", "already_covered"]);
export type BillabilityStatus = z.infer<typeof BillabilityStatusSchema>;

export const OpportunityStatusSchema = z.enum([
  "new",
  /** Agency explicitly decided this is worth pursuing. See core/salesFunnel.ts. */
  "accepted",
  "proposal_prepared",
  /** The client was actually presented with the opportunity (call, meeting, proposal...). */
  "pitched",
  /** Presented to the client but it did not close. A CLIENT decision — never conflated with dismissed. */
  "lost",
  "dismissed",
  "already_covered",
  "snoozed",
  /**
   * The agency sold this work. The single most valuable fact the product can
   * hold: it is the only signal that says which findings are worth surfacing,
   * as opposed to which ones are merely true.
   *
   * Distinct from every other terminal state. "dismissed" is the agency
   * declining to sell it, "already_covered" is work the contract includes, and
   * "resolved" is the client fixing it themselves. Only this one is a win, and
   * conflating it with any of the others would destroy the measurement.
   */
  "sold",
  /**
   * Retained for audit after a page-level technical row has been folded into
   * its canonical site-level opportunity. Superseded rows are never listed or
   * actionable, so an old decision cannot re-enter the agency's feed.
   */
  "superseded",
  /**
   * The client fixed it. Set only by a re-analysis that demonstrably re-checked
   * this finding and no longer sees it — never by a run that could not look.
   * Distinct from "dismissed", which is the agency deciding not to sell it.
   */
  "resolved",
]);
export type OpportunityStatus = z.infer<typeof OpportunityStatusSchema>;

export const OpportunitySchema = z.object({
  id: z.string().min(1),
  /**
   * Stable identity used for reconciliation. Technical rows use
   * `technical::<clientId>::<ruleId>`; other rules retain their subject hash.
   */
  dedupeKey: z.string().min(1),
  clientId: z.string().min(1),
  ruleId: RuleIdSchema,
  title: z.string().min(1),
  detected: z.string().min(1),
  evidenceRefs: z.array(z.string()).default([]),
  /** Evidence excluded after the agency dismissed legacy page-level work. */
  suppressedEvidenceRefs: z.array(z.string()).default([]),
  rationale: z.string().min(1),
  suggestedServiceId: z.string().min(1),
  suggestedScope: z.array(z.string()).default([]),
  verification: VerificationSchema.optional(),
  conversionDefect: ConversionDefectSchema.optional(),
  priceMin: z.number().nonnegative(),
  priceMax: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  billableStatus: BillabilityStatusSchema,
  status: OpportunityStatusSchema,
  /**
   * What the agency actually charged, recorded when they mark the work sold.
   * Optional even on a sold finding: knowing that it sold is worth capturing
   * on its own, and forcing a number would cost the more important fact.
   */
  soldAmount: z.number().nonnegative().optional(),
  soldAt: z.string().optional(),
  /**
   * Durable funnel milestones: the FIRST time each stage was reached. Optional
   * because legacy rows recorded none, and unknown is never read as happened
   * or backfilled from guesses. See core/salesFunnel.ts and migration 0022.
   */
  acceptedAt: z.string().optional(),
  proposalPreparedAt: z.string().optional(),
  pitchedAt: z.string().optional(),
  lostAt: z.string().optional(),
  dismissedAt: z.string().optional(),
  snoozeUntil: z.string().optional(),
  proposalMd: z.string().optional(),
  updatedAt: z.string().min(1),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;
