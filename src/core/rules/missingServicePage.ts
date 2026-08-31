import type { Candidate, Client, EvidenceBundle, Service } from "@/core/schema";
import { coreTokens } from "@/core/text";

/** Agency services tagged like this are what this rule proposes. */
const LANDING_PAGE_TAG = "landing-page";

export interface RuleContext {
  client: Client;
  catalog: Service[];
  evidence: EvidenceBundle;
}

/**
 * missing-service-page
 *
 * The client sells a service (an "offering") but the crawled site has no page
 * whose title, headings, or navigation targets that service. A dedicated service
 * landing page is well-scoped, individually sellable work.
 *
 * Deliberately structural: a passing mention in body text does NOT count as a
 * dedicated page, so we only match against title / h1s / headings / nav.
 */
export function missingServicePageRule(ctx: RuleContext): Candidate[] {
  const { client, catalog, evidence } = ctx;

  const service = catalog.find(
    (s) => s.active && s.tags.includes(LANDING_PAGE_TAG),
  );
  // The agency does not sell landing pages -> nothing this rule could propose.
  if (!service) return [];

  const pageStructuralText = evidence.site.pages.map((p) =>
    [p.title, ...p.h1s, ...p.headings].join(" ").toLowerCase(),
  );
  const navText = evidence.site.nav.map((n) => n.toLowerCase());

  const candidates: Candidate[] = [];

  for (const offering of client.offerings) {
    const tokens = coreTokens(offering);
    if (tokens.length === 0) continue;

    const targetedByPage = pageStructuralText.some((text) =>
      tokens.every((tok) => text.includes(tok)),
    );
    const targetedByNav = navText.some((entry) =>
      tokens.every((tok) => entry.includes(tok)),
    );
    if (targetedByPage || targetedByNav) continue;

    const pageCount = evidence.site.pages.length;
    const rawConfidence = Math.min(0.8, 0.5 + Math.min(pageCount, 8) * 0.05);

    candidates.push({
      ruleId: "missing-service-page",
      subject: offering,
      detected:
        `The client offers "${offering}" but no crawled page targets it. ` +
        `Checked ${pageCount} page(s) and ${evidence.site.nav.length} navigation link(s); ` +
        `none carry this service in the page title, headings, or main navigation.`,
      evidenceRefs: [
        ...evidence.site.pages.map((p) => p.url),
        ...evidence.site.nav.map((n) => `nav:${n}`),
      ],
      rawConfidence,
      suggestedServiceId: service.id,
    });
  }

  return candidates;
}
