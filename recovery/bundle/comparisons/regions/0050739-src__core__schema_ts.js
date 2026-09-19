// src/core/schema.ts
var ServiceSchema = external_exports.object({
  id: external_exports.string().min(1),
  name: external_exports.string().min(1),
  description: external_exports.string().default(""),
  priceMin: external_exports.number().nonnegative(),
  priceMax: external_exports.number().nonnegative(),
  /** Machine tags used by rules to map a detection to a service, e.g. "landing-page". */
  tags: external_exports.array(external_exports.string()).default([]),
  active: external_exports.boolean().default(true)
}).refine((s) => s.priceMax >= s.priceMin, {
  message: "priceMax must be greater than or equal to priceMin",
  path: ["priceMax"]
});
var ClientSchema = external_exports.object({
  id: external_exports.string().min(1),
  name: external_exports.string().min(1),
  /** Bare hostname or URL of the client's site, e.g. "coolbreezehvac.example". */
  domain: external_exports.string().min(1),
  /** The CLIENT's own business services (what they sell to their customers). */
  offerings: external_exports.array(external_exports.string().min(1)).default([]),
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
  averageJobValue: external_exports.number().positive().optional(),
  notes: external_exports.string().default("")
});
var CoverageSchema = external_exports.object({
  clientId: external_exports.string().min(1),
  serviceId: external_exports.string().min(1),
  covered: external_exports.literal(true),
  note: external_exports.string().optional()
});
var EvidenceTextSchema = external_exports.string().trim().max(500);
var EvidenceElementKeySchema = external_exports.string().trim().min(1).max(120);
var EvidenceRegionSchema = external_exports.enum([
  "header",
  "hero",
  "nav",
  "main",
  "form",
  "proof",
  "footer",
  "page",
  "unknown"
]);
var EvidenceGeometrySchema = external_exports.object({
  left: external_exports.number().finite().nonnegative(),
  top: external_exports.number().finite().nonnegative(),
  width: external_exports.number().finite().nonnegative(),
  height: external_exports.number().finite().nonnegative(),
  viewportWidth: external_exports.number().int().positive(),
  viewportHeight: external_exports.number().int().positive(),
  horizontallyClipped: external_exports.boolean()
}).strict();
function safeEvidenceHref(value) {
  if (value === "") return true;
  try {
    const parsed = new URL(value, "https://client-growth.invalid/");
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "tel:" && parsed.protocol !== "mailto:") {
      return false;
    }
    if (parsed.username || parsed.password) return false;
    if ((parsed.protocol === "tel:" || parsed.protocol === "mailto:") && parsed.search) {
      return false;
    }
    return ![...parsed.searchParams.keys()].some(
      (key) => /pass(word)?|token|secret|api[-_]?key|auth|credential/i.test(key)
    );
  } catch {
    return false;
  }
}
__name(safeEvidenceHref, "safeEvidenceHref");
function safeEvidenceFormAction(value) {
  if (value === "") return true;
  try {
    const parsed = new URL(value, "https://client-growth.invalid/");
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    return ![...parsed.searchParams.keys()].some(
      (key) => /pass(word)?|token|secret|api[-_]?key|auth|credential/i.test(key)
    );
  } catch {
    return false;
  }
}
__name(safeEvidenceFormAction, "safeEvidenceFormAction");
var EvidenceAvailabilityKindSchema = external_exports.enum([
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
var EvidenceAvailabilitySchema = external_exports.object({
  kind: EvidenceAvailabilityKindSchema,
  state: external_exports.enum(["available", "partial", "unavailable"]),
  observedCount: external_exports.number().int().nonnegative().max(1e4),
  reason: EvidenceTextSchema.optional()
}).strict();
var EvidenceFormFieldSchema = external_exports.object({
  elementKey: EvidenceElementKeySchema,
  controlType: external_exports.string().trim().min(1).max(50),
  name: external_exports.string().trim().max(200).default(""),
  required: external_exports.boolean().default(false),
  autocomplete: external_exports.string().trim().max(100).optional(),
  label: EvidenceTextSchema.default(""),
  accessibleName: EvidenceTextSchema.default(""),
  labelSource: external_exports.enum(["label", "aria-label", "aria-labelledby", "placeholder", "name", "none"]).default("none")
}).strict();
var EvidenceCtaSchema = external_exports.object({
  elementKey: EvidenceElementKeySchema,
  href: external_exports.string().trim().max(2e3).refine(safeEvidenceHref, "CTA href must use a safe URL scheme").default(""),
  label: EvidenceTextSchema.default(""),
  accessibleName: EvidenceTextSchema.default(""),
  actionKind: external_exports.enum(["navigation", "contact", "submit", "button"]),
  sourceRegion: EvidenceRegionSchema.default("page"),
  geometry: EvidenceGeometrySchema.optional()
}).strict();
var EvidenceLandmarkSchema = external_exports.object({
  elementKey: EvidenceElementKeySchema,
  role: external_exports.enum(["banner", "header", "navigation", "main", "complementary", "contentinfo", "search", "form", "region"]),
  label: EvidenceTextSchema.default("")
}).strict();
var EvidenceContentSectionSchema = external_exports.object({
  elementKey: EvidenceElementKeySchema,
  kind: external_exports.enum(["hero", "services", "proof", "contact", "faq", "pricing", "content", "unknown"]),
  heading: EvidenceTextSchema.default(""),
  textExcerpt: EvidenceTextSchema.default("")
}).strict();
var EvidenceProofSignalSchema = external_exports.object({
  sourceKey: EvidenceElementKeySchema,
  kind: external_exports.enum(["testimonial", "review", "case-study", "credential", "guarantee", "rating", "logo", "unknown"]),
  text: EvidenceTextSchema.default("")
}).strict();
var ContactFactOrigins = [
  /** A value the visitor can read on the page. */
  "visible_text",
  /** A value carried by an action target (`mailto:`/`tel:` href). */
  "action_target",
  /** A value from embedded structured data (JSON-LD). */
  "structured_data"
];
var EvidenceContactFactSchema = external_exports.object({
  sourceKey: EvidenceElementKeySchema,
  kind: external_exports.enum(["phone", "email", "address", "hours", "social"]),
  value: EvidenceTextSchema,
  /**
   * Where this value came from. Kept because source metadata and visible text
   * are different evidence facts: a stale JSON-LD address is not the same
   * claim as the address a visitor reads. Absent on pre-Audit-V2 rows.
   */
  origin: external_exports.enum(ContactFactOrigins).optional()
}).strict();
var EvidenceDateFactSchema = external_exports.object({
  sourceKey: EvidenceElementKeySchema,
  kind: external_exports.enum(["published", "updated", "offer-expiry", "event", "copyright", "unknown"]),
  value: EvidenceTextSchema
}).strict();
var EvidenceAccessibilityObservationSchema = external_exports.object({
  elementKey: EvidenceElementKeySchema,
  issue: external_exports.enum(["missing-alt", "missing-accessible-name", "missing-label", "empty-label", "invalid-aria-reference"]),
  source: external_exports.enum(["parsed", "rendered"]).default("parsed"),
  detail: EvidenceTextSchema.optional()
}).strict();
var EvidenceFormSchema = external_exports.object({
  /** Raw `action` attribute after credential redaction. */
  action: external_exports.string().trim().max(2e3).refine(safeEvidenceFormAction, "Form action must be a safe credential-free HTTP target").default(""),
  /** Uppercased method; defaults to GET per the HTML spec. */
  method: external_exports.enum(["GET", "POST"]).default("GET"),
  hasSubmit: external_exports.boolean().default(false),
  /** Optional so pre-rich bundles retain their legacy form shape. */
  fields: external_exports.array(EvidenceFormFieldSchema).max(50).optional(),
  submitLabel: EvidenceTextSchema.optional(),
  actionTargetState: external_exports.enum(["empty", "same-site", "off-site", "invalid", "redacted"]).optional(),
  /**
   * A submit control that is present but inactive in the served DOM. This is
   * commonly validation behaviour — a control that enables once the required
   * fields are valid — so it is recorded as a state, never as a defect. No
   * submission, click or fill is attempted anywhere in Orbit.
   */
  submitDisabled: external_exports.boolean().optional(),
  /** Another submit control in the same form is not disabled. */
  hasEnabledSubmitAlternative: external_exports.boolean().optional()
}).strict();
var EvidenceImageSchema = external_exports.object({
  /** Raw or resolved image source, when the element exposed one. */
  src: external_exports.string().default(""),
  /** Undefined means the attribute was absent; an empty string is decorative. */
  alt: external_exports.string().optional()
});
var EvidencePageSchema = external_exports.object({
  url: external_exports.string().url(),
  /** HTTP status the crawler received for this page. */
  status: external_exports.number().int().default(200),
  title: external_exports.string().default(""),
  h1s: external_exports.array(external_exports.string()).default([]),
  headings: external_exports.array(external_exports.string()).default([]),
  /** Short excerpt kept for provenance, not for analysis. */
  textExcerpt: external_exports.string().default(""),
  wordCount: external_exports.number().int().nonnegative().default(0),
  forms: external_exports.array(EvidenceFormSchema).default([]),
  /**
   * These fields are optional on purpose. Bundles captured before the parser
   * learned to observe them must remain unknown rather than becoming an
   * observed absence through a default empty value.
   */
  metaDescription: external_exports.string().optional(),
  structuredDataTypes: external_exports.array(external_exports.string()).optional(),
  /** Whether any JSON-LD, microdata, or RDFa structured data was observed. */
  structuredDataPresent: external_exports.boolean().optional(),
  images: external_exports.array(EvidenceImageSchema).optional(),
  /** Rich parser observations are optional so legacy bundles remain unknown. */
  ctas: external_exports.array(EvidenceCtaSchema).max(100).optional(),
  landmarks: external_exports.array(EvidenceLandmarkSchema).max(50).optional(),
  sections: external_exports.array(EvidenceContentSectionSchema).max(100).optional(),
  proofSignals: external_exports.array(EvidenceProofSignalSchema).max(100).optional(),
  contactFacts: external_exports.array(EvidenceContactFactSchema).max(100).optional(),
  datedFacts: external_exports.array(EvidenceDateFactSchema).max(100).optional(),
  accessibility: external_exports.array(EvidenceAccessibilityObservationSchema).max(200).optional()
});
var EvidenceLinkSchema = external_exports.object({
  href: external_exports.string().min(1),
  label: external_exports.string().default(""),
  /** http (same-origin page link), or a tel:/mailto: contact link. */
  scheme: external_exports.enum(["http", "tel", "mailto"]).default("http"),
  ariaLabel: external_exports.string().default(""),
  title: external_exports.string().default(""),
  /** True when this link appeared inside a <nav> / role="navigation" region. */
  inNav: external_exports.boolean().default(false),
  /** True when the site grouped this link below a Services/Treatments menu heading. */
  inServiceNav: external_exports.boolean().default(false),
  /** URLs of the crawled pages this link appeared on. */
  foundOn: external_exports.array(external_exports.string()).default([])
});
var EvidenceFailureCodeSchema = external_exports.enum([
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
  "js-shell"
]);
var EvidenceNetworkStageSchema = external_exports.enum([
  "robots",
  "sitemap",
  "page",
  "targeted-page",
  "probe"
]);
var EvidenceNetworkEventSchema = external_exports.object({
  /** Redacted/canonical URL when it was parseable. */
  url: external_exports.string().min(1),
  outcome: external_exports.enum(["blocked", "inconclusive"]),
  reason: external_exports.string().min(1),
  /** Optional on old bundles; every new provider event supplies it. */
  code: EvidenceFailureCodeSchema.optional(),
  /** Optional on old bundles; every new provider event supplies it. */
  stage: EvidenceNetworkStageSchema.optional(),
  /** HTTP status when a response was received but was not usable. */
  status: external_exports.number().int().optional(),
  /** Validated redirect hops observed before the failure. */
  redirects: external_exports.number().int().nonnegative().optional()
});
var CrawlIgnoredReasonSchema = external_exports.enum([
  "invalid-url",
  "off-site",
  "duplicate",
  "robots",
  "page-budget",
  "platform-path"
]);
var CrawlCoverageSchema = external_exports.object({
  discoveredUrls: external_exports.number().int().nonnegative(),
  attemptedUrls: external_exports.number().int().nonnegative(),
  retrievedUrls: external_exports.number().int().nonnegative(),
  renderedUrls: external_exports.number().int().nonnegative(),
  failedUrls: external_exports.number().int().nonnegative(),
  ignoredUrls: external_exports.array(
    external_exports.object({
      url: external_exports.string().min(1),
      reason: CrawlIgnoredReasonSchema
    })
  ).max(100),
  redirectHops: external_exports.number().int().nonnegative(),
  canonicalPages: external_exports.number().int().nonnegative(),
  maxDepth: external_exports.number().int().nonnegative(),
  screenshotsCaptured: external_exports.number().int().nonnegative()
});
var EvidenceObservedPageUrlSchema = external_exports.string().max(2e3).url();
var EvidenceResourceFailureSchema = external_exports.object({
  pageUrl: EvidenceObservedPageUrlSchema,
  url: EvidenceObservedPageUrlSchema,
  resourceType: external_exports.enum(["document", "stylesheet", "script", "image", "font", "xhr", "fetch", "other"]),
  status: external_exports.number().int().min(100).max(599).optional(),
  reason: external_exports.string().trim().min(1).max(500),
  source: external_exports.enum(["http", "rendered"]),
  /**
   * Whose limit this was. `orbit-limit` records a ceiling Orbit imposed
   * (response-size cap, capture budget) and must never be read as a condition
   * of the customer's website. Absent on rows written before Audit V2.
   */
  cause: external_exports.enum(["site", "orbit-limit"]).optional(),
  observedAt: external_exports.string().trim().min(1).max(200).optional()
}).strict();
var EvidenceConsoleErrorSchema = external_exports.object({
  pageUrl: EvidenceObservedPageUrlSchema,
  level: external_exports.enum(["error", "warning"]),
  message: external_exports.string().trim().min(1).max(1e3),
  source: external_exports.literal("rendered"),
  sourceUrl: EvidenceObservedPageUrlSchema.optional(),
  lineNumber: external_exports.number().int().nonnegative().max(1e7).optional(),
  columnNumber: external_exports.number().int().nonnegative().max(1e7).optional(),
  observedAt: external_exports.string().trim().min(1).max(200).optional()
}).strict();
var EvidencePerformanceObservationSchema = external_exports.object({
  pageUrl: EvidenceObservedPageUrlSchema,
  status: external_exports.number().int().min(100).max(599).optional(),
  responseTimeMs: external_exports.number().finite().nonnegative().max(12e4),
  transferSizeBytes: external_exports.number().int().nonnegative().max(2e7),
  source: external_exports.enum(["http", "rendered"]),
  observedAt: external_exports.string().trim().min(1).max(200).optional()
}).strict();
var EvidenceBundleSchema = external_exports.object({
  visualReview: VisualReviewSchema.optional(),
  clientId: external_exports.string().min(1),
  source: external_exports.enum(["fixture", "http"]),
  capturedAt: external_exports.string().min(1),
  // ISO timestamp
  site: external_exports.object({
    pages: external_exports.array(EvidencePageSchema),
    /** Navigation labels (kept for display / back-compat). */
    nav: external_exports.array(external_exports.string()).default([]),
    /** All discovered same-origin links with anchor text. */
    links: external_exports.array(EvidenceLinkSchema).default([]),
    /** URLs listed in /sitemap.xml when cheaply available. */
    sitemapUrls: external_exports.array(external_exports.string()).default([]),
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
    crawlExhaustive: external_exports.boolean().default(false),
    coverage: CrawlCoverageSchema.optional()
  }),
  /** Network-policy failures are evidence limitations, never website defects. */
  networkEvents: external_exports.array(EvidenceNetworkEventSchema).default([]),
  /** Increment 2 observations stay optional so legacy bundles remain unknown. */
  resourceFailures: external_exports.array(EvidenceResourceFailureSchema).max(200).optional(),
  consoleErrors: external_exports.array(EvidenceConsoleErrorSchema).max(100).optional(),
  performanceObservations: external_exports.array(EvidencePerformanceObservationSchema).max(100).optional(),
  renderedPages: external_exports.array(RenderedPageObservationSchema).max(8).optional(),
  evidenceAvailability: external_exports.array(EvidenceAvailabilitySchema).max(20).optional()
});
var ConversionDefectSchema = external_exports.object({
  kind: external_exports.enum([
    "dead-conversion-link",
    "conversion-page-error",
    "malformed-tel",
    "broken-form-target"
  ]),
  /** The crawled page the broken element sits on (first occurrence). */
  pageUrl: external_exports.string().min(1),
  /** Visible text / aria-label of the element. */
  elementText: external_exports.string().default(""),
  /** The raw href / action of the element. */
  elementHref: external_exports.string().default(""),
  /** The URL that was probed (for link/form defects), if any. */
  target: external_exports.string().optional(),
  /** HTTP status observed for `target`, if probed. */
  observedStatus: external_exports.number().int().optional(),
  /** All crawled pages the element appeared on. */
  seenOn: external_exports.array(external_exports.string()).default([]),
  note: external_exports.string().default("")
});
var VerificationSchema = external_exports.object({
  // absent      = positively verified: no adequate page exists -> may surface
  // present     = an adequate existing page/section was found -> suppress
  // inconclusive= an existence signal was found but could not be verified
  //               (e.g. a matching nav label with no link) -> suppress
  // weak        = the offering has no distinctive words to verify -> suppress
  conclusion: external_exports.enum(["absent", "present", "inconclusive", "weak"]),
  /** URLs actually fetched during targeted verification. */
  inspectedUrls: external_exports.array(external_exports.string()).default([]),
  /** Near-matches considered, and why each did or did not satisfy the offering. */
  closeMatches: external_exports.array(
    external_exports.object({
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
      value: external_exports.string(),
      url: external_exports.string().optional(),
      score: external_exports.number().min(0).max(1),
      satisfied: external_exports.boolean(),
      reason: external_exports.string()
    })
  ).default([]),
  reason: external_exports.string().default("")
});
var CandidateSchema = external_exports.object({
  visualTitle: external_exports.string().max(120).optional(),
  ruleId: RuleIdSchema,
  /** What the candidate is about, e.g. "heat pump installation". */
  subject: external_exports.string().min(1),
  /** Human-readable statement of what was detected. */
  detected: external_exports.string().min(1),
  /** URLs / nav labels that justify the detection. */
  evidenceRefs: external_exports.array(external_exports.string()).default([]),
  /**
   * Evidence from legacy page-level findings the agency dismissed. Technical
   * aggregation keeps it with the canonical row so a re-run cannot turn an old
   * dismissal into a newly actionable site-level finding.
   */
  suppressedEvidenceRefs: external_exports.array(external_exports.string()).optional(),
  /** Deterministic pre-AI signal strength, 0..1. */
  rawConfidence: external_exports.number().min(0).max(1),
  suggestedServiceId: external_exports.string().min(1),
  verification: VerificationSchema.optional(),
  conversionDefect: ConversionDefectSchema.optional()
});
var SubjectTypeSchema = external_exports.enum([
  "distinct_service",
  "trust_signal",
  "promotion",
  "generic_claim",
  "ambiguous",
  "conversion_defect"
]);
var EvaluationSchema = external_exports.object({
  verdict: external_exports.enum(["surface", "reject"]),
  /**
   * Evidence strength for the surfaced finding, 0..1.
   *
   * NOT a model self-report. A measured calibration run showed provider-supplied
   * confidence carried no usable signal (near-identical values for a real
   * service line and for "fully insured"), so DeepSeekEvaluator no longer asks
   * for one and derives this from the deterministic candidate instead.
   */
  confidence: external_exports.number().min(0).max(1),
  rationale: external_exports.string().min(1),
  suggestedScope: external_exports.array(external_exports.string().min(1)).default([]),
  /**
   * Structured judgment. Optional on the type so offline/legacy evaluators stay
   * constructible, but a missing-service-page candidate with no `subjectType`
   * is REJECTED by the judgment policy rather than trusted.
   */
  subjectType: SubjectTypeSchema.optional(),
  commerciallyActionable: external_exports.boolean().optional()
});
var ServiceJudgmentSchema = external_exports.object({
  subjectType: SubjectTypeSchema.exclude(["conversion_defect"]),
  commerciallyActionable: external_exports.boolean(),
  verdict: external_exports.enum(["surface", "reject"]),
  rationale: external_exports.string().min(1),
  suggestedScope: external_exports.array(external_exports.string().min(1)).default([])
});
var DefectJudgmentSchema = external_exports.object({
  commerciallyActionable: external_exports.boolean(),
  verdict: external_exports.enum(["surface", "reject"]),
  rationale: external_exports.string().min(1),
  suggestedScope: external_exports.array(external_exports.string().min(1)).default([])
});
var BillabilityStatusSchema = external_exports.enum(["billable", "already_covered"]);
var OpportunityStatusSchema = external_exports.enum([
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
  "resolved"
]);
var OpportunitySchema = external_exports.object({
  id: external_exports.string().min(1),
  /**
   * Stable identity used for reconciliation. Technical rows use
   * `technical::<clientId>::<ruleId>`; other rules retain their subject hash.
   */
  dedupeKey: external_exports.string().min(1),
  clientId: external_exports.string().min(1),
  ruleId: RuleIdSchema,
  title: external_exports.string().min(1),
  detected: external_exports.string().min(1),
  evidenceRefs: external_exports.array(external_exports.string()).default([]),
  /** Evidence excluded after the agency dismissed legacy page-level work. */
  suppressedEvidenceRefs: external_exports.array(external_exports.string()).default([]),
  rationale: external_exports.string().min(1),
  suggestedServiceId: external_exports.string().min(1),
  suggestedScope: external_exports.array(external_exports.string()).default([]),
  verification: VerificationSchema.optional(),
  conversionDefect: ConversionDefectSchema.optional(),
  priceMin: external_exports.number().nonnegative(),
  priceMax: external_exports.number().nonnegative(),
  confidence: external_exports.number().min(0).max(1),
  billableStatus: BillabilityStatusSchema,
  status: OpportunityStatusSchema,
  /**
   * What the agency actually charged, recorded when they mark the work sold.
   * Optional even on a sold finding: knowing that it sold is worth capturing
   * on its own, and forcing a number would cost the more important fact.
   */
  soldAmount: external_exports.number().nonnegative().optional(),
  soldAt: external_exports.string().optional(),
  /**
   * Durable funnel milestones: the FIRST time each stage was reached. Optional
   * because legacy rows recorded none, and unknown is never read as happened
   * or backfilled from guesses. See core/salesFunnel.ts and migration 0022.
   */
  acceptedAt: external_exports.string().optional(),
  proposalPreparedAt: external_exports.string().optional(),
  pitchedAt: external_exports.string().optional(),
  lostAt: external_exports.string().optional(),
  dismissedAt: external_exports.string().optional(),
  snoozeUntil: external_exports.string().optional(),
  proposalMd: external_exports.string().optional(),
  updatedAt: external_exports.string().min(1)
});
