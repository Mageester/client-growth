import { z } from "zod";

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
export const EvidencePageSchema = z.object({
  url: z.string().url(),
  title: z.string().default(""),
  h1s: z.array(z.string()).default([]),
  headings: z.array(z.string()).default([]),
  /** Short excerpt kept for provenance, not for analysis. */
  textExcerpt: z.string().default(""),
  wordCount: z.number().int().nonnegative().default(0),
});
export type EvidencePage = z.infer<typeof EvidencePageSchema>;

/** A same-origin link discovered while crawling: its href and its anchor text. */
export const EvidenceLinkSchema = z.object({
  href: z.string().min(1),
  label: z.string().default(""),
  /** True when this link appeared inside a <nav> / role="navigation" region. */
  inNav: z.boolean().default(false),
});
export type EvidenceLink = z.infer<typeof EvidenceLinkSchema>;

export const EvidenceBundleSchema = z.object({
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
  }),
});
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

// ---------------------------------------------------------------------------
// Rule output (deterministic candidates, pre-AI)
// ---------------------------------------------------------------------------
export const RuleIdSchema = z.enum(["missing-service-page"]);
export type RuleId = z.infer<typeof RuleIdSchema>;

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
  /** Deterministic pre-AI signal strength, 0..1. */
  rawConfidence: z.number().min(0).max(1),
  suggestedServiceId: z.string().min(1),
  verification: VerificationSchema.optional(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

// ---------------------------------------------------------------------------
// Evaluator output (cheap AI judgement + explanation)
// ---------------------------------------------------------------------------
export const EvaluationSchema = z.object({
  verdict: z.enum(["surface", "reject"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  suggestedScope: z.array(z.string().min(1)).default([]),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

// ---------------------------------------------------------------------------
// Opportunity (surfaced output + persisted agency decision)
// ---------------------------------------------------------------------------
export const BillabilityStatusSchema = z.enum(["billable", "already_covered"]);
export type BillabilityStatus = z.infer<typeof BillabilityStatusSchema>;

export const OpportunityStatusSchema = z.enum([
  "new",
  "proposal_prepared",
  "dismissed",
  "already_covered",
  "snoozed",
]);
export type OpportunityStatus = z.infer<typeof OpportunityStatusSchema>;

export const OpportunitySchema = z.object({
  id: z.string().min(1),
  /** Stable key = hash(clientId, ruleId, subject); re-runs reconcile against this. */
  dedupeKey: z.string().min(1),
  clientId: z.string().min(1),
  ruleId: RuleIdSchema,
  title: z.string().min(1),
  detected: z.string().min(1),
  evidenceRefs: z.array(z.string()).default([]),
  rationale: z.string().min(1),
  suggestedServiceId: z.string().min(1),
  suggestedScope: z.array(z.string()).default([]),
  verification: VerificationSchema.optional(),
  priceMin: z.number().nonnegative(),
  priceMax: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  billableStatus: BillabilityStatusSchema,
  status: OpportunityStatusSchema,
  snoozeUntil: z.string().optional(),
  proposalMd: z.string().optional(),
  updatedAt: z.string().min(1),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;
