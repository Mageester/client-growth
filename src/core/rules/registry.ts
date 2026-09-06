import type { RuleId, Service } from "@/core/schema";

/**
 * The single source of truth linking a rule to the agency service it sells.
 *
 * A rule can only produce a finding when an ACTIVE service in the catalog is
 * offered for its kind of gap — every candidate is priced from that service. The
 * tag strings therefore appear in three places at once (the rule, the catalog
 * screen's checkboxes, and the readiness check before an analysis runs), and a
 * mismatch between them silently disables a rule. They live here instead.
 */
/**
 * What kind of claim a rule makes, which decides where its findings appear.
 *
 * "commercial" findings answer the question this product exists for: what
 * legitimate, billable work could this agency offer this client right now?
 * They depend on knowing what the client's business SELLS — which comes from
 * the offerings the agency recorded, and which no site crawler has.
 *
 * "health" findings are site hygiene: a missing title, an absent meta
 * description, an image without alt text. They are real, they are evidenced,
 * and they are also what Screaming Frog, Lighthouse and every SEO suite
 * already produce for free. Mixed into one list they outnumber the commercial
 * findings and bury them, and a queue of alt-text warnings makes the whole
 * product read like a free tool with a login.
 *
 * So they are separated at the point where the meaning lives, not in the view:
 * the commercial findings are the work, the health findings are the appendix
 * that supports it.
 */
export type RuleTier = "commercial" | "health";

export interface RuleServiceLink {
  ruleId: RuleId;
  /** Machine tag stored on the service. */
  tag: string;
  /** What the agency owner is choosing, in their language. */
  label: string;
  hint: string;
  tier: RuleTier;
}

export const RULE_SERVICE_LINKS: readonly RuleServiceLink[] = [
  {
    ruleId: "missing-service-page",
    tier: "commercial",
    tag: "landing-page",
    label: "A missing service page",
    hint: "Sell this when a client offers something their website never gives its own page.",
  },
  {
    ruleId: "no-service-pages",
    tier: "commercial",
    tag: "service-pages-build",
    label: "A site with no service pages at all",
    hint: "Sell this when a client's whole website never describes anything they sell — the work is a set of pages, not one.",
  },
  {
    ruleId: "competitor-service-gap",
    tier: "commercial",
    tag: "competitor-gap",
    label: "A service the competition sells and this client does not",
    hint: "Sell this when two or more of the client's named competitors have a page for something the client has no page for.",
  },
  {
    ruleId: "broken-conversion-path",
    tier: "commercial",
    tag: "conversion-fix",
    label: "A broken conversion path",
    hint: "Sell this when a call-to-action, form or phone link on the site is broken.",
  },
  {
    ruleId: "missing-title",
    tier: "health",
    tag: "missing-title",
    label: "Repair a missing page title",
    hint: "Sell this when a readable page has no non-empty HTML title.",
  },
  {
    ruleId: "duplicate-title",
    tier: "health",
    tag: "duplicate-title",
    label: "Repair duplicate page titles",
    hint: "Sell this when two or more readable pages expose the same title text.",
  },
  {
    ruleId: "thin-service-page",
    tier: "health",
    tag: "thin-service-page",
    label: "Expand a thin service page",
    hint: "Sell this when a service-shaped page contains very little readable body text.",
  },
  {
    ruleId: "missing-h1",
    tier: "health",
    tag: "missing-h1",
    label: "Repair a missing H1",
    hint: "Sell this when a readable page has no non-empty H1 heading.",
  },
  {
    ruleId: "broken-internal-link",
    tier: "health",
    tag: "broken-internal-link",
    label: "Repair a broken internal link",
    hint: "Sell this when a same-site link is verified to return HTTP 404 or 410.",
  },
  {
    ruleId: "missing-meta-description",
    tier: "health",
    tag: "missing-meta-description",
    label: "Repair a missing meta description",
    hint: "Sell this when a readable page has no non-empty meta description.",
  },
  {
    ruleId: "missing-structured-data",
    tier: "health",
    tag: "missing-structured-data",
    label: "Add LocalBusiness or Service schema",
    hint: "Sell this when a readable page has no observed LocalBusiness or Service structured-data type.",
  },
  {
    ruleId: "missing-image-alt",
    tier: "health",
    tag: "missing-image-alt",
    label: "Add missing image alt attributes",
    hint: "Sell this when an image has no alt attribute; decorative alt=\"\" is left alone.",
  },
] as const;

/**
 * Rules that are NOT produced by `runRules`.
 *
 * Every other rule is a function of one evidence bundle, so the pipeline can
 * run it. A competitor gap is a function of several — the client's bundle and
 * one per competitor — so it is produced by app/lib/competitors.server.ts from
 * its own explicit action. It still needs everything else in this registry: a
 * catalog tag to be priceable, a tier to be ranked, and a starter price.
 *
 * Listing them here keeps `RULE_SERVICE_LINKS.length === allRules.length +
 * this.length` a checkable invariant, so a rule cannot be added to the registry
 * and silently never run.
 */
export const RULES_PRODUCED_OUTSIDE_PIPELINE: readonly RuleId[] = [
  "competitor-service-gap",
];

const TIER_BY_RULE = new Map<RuleId, RuleTier>(
  RULE_SERVICE_LINKS.map((link) => [link.ruleId, link.tier]),
);

/**
 * The tier a finding belongs to.
 *
 * Unknown rule ids fall back to "health": a finding whose meaning this build
 * does not recognise must not be promoted into the queue an agency reads as
 * "work to sell". Erring toward the appendix is the recoverable direction.
 */
export function tierForRule(ruleId: RuleId): RuleTier {
  return TIER_BY_RULE.get(ruleId) ?? "health";
}

export function isCommercialRule(ruleId: RuleId): boolean {
  return tierForRule(ruleId) === "commercial";
}

/** The active service a rule would price its findings from, or null. */
export function serviceForRule(catalog: Service[], tag: string): Service | null {
  return catalog.find((s) => s.active && s.tags.includes(tag)) ?? null;
}

export interface CatalogCoverage {
  /** One entry per rule, in the order the agency sees them. */
  rules: Array<RuleServiceLink & { serviceId: string | null }>;
  /** Rules that can actually run against this catalog. */
  matched: number;
  total: number;
  /** Human labels of the gaps nothing in the catalog is offered for. */
  unmatchedLabels: string[];
}

/**
 * Which of today's rules this catalog can actually reach.
 *
 * `matched === 0` means an analysis cannot produce a finding no matter what the
 * website looks like. Reporting such a run as "we looked and found nothing" is
 * the single most misleading thing the product could say, so callers use this to
 * classify the run honestly and to warn before it is even started.
 */
export function assessCatalogCoverage(catalog: Service[]): CatalogCoverage {
  const rules = RULE_SERVICE_LINKS.map((link) => ({
    ...link,
    serviceId: serviceForRule(catalog, link.tag)?.id ?? null,
  }));
  return {
    rules,
    matched: rules.filter((r) => r.serviceId !== null).length,
    total: rules.length,
    unmatchedLabels: rules.filter((r) => r.serviceId === null).map((r) => r.label),
  };
}
