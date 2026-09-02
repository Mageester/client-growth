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
export interface RuleServiceLink {
  ruleId: RuleId;
  /** Machine tag stored on the service. */
  tag: string;
  /** What the agency owner is choosing, in their language. */
  label: string;
  hint: string;
}

export const RULE_SERVICE_LINKS: readonly RuleServiceLink[] = [
  {
    ruleId: "missing-service-page",
    tag: "landing-page",
    label: "A missing service page",
    hint: "Sell this when a client offers something their website never gives its own page.",
  },
  {
    ruleId: "broken-conversion-path",
    tag: "conversion-fix",
    label: "A broken conversion path",
    hint: "Sell this when a call-to-action, form or phone link on the site is broken.",
  },
] as const;

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
