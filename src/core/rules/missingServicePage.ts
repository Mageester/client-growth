import type { Candidate, Client, EvidenceBundle, Service } from "@/core/schema";
import { significantTokens } from "@/core/text";
import { verifyOfferingAbsence, type PageFetcher } from "@/core/absenceVerification";

/** Agency services tagged like this are what this rule proposes. */
const LANDING_PAGE_TAG = "landing-page";

export interface RuleContext {
  client: Client;
  catalog: Service[];
  evidence: EvidenceBundle;
  /** Optional: pull one specific page during targeted absence verification. */
  fetchPage?: PageFetcher;
  /** Shared fetch budget across all offerings in one analysis run. */
  verifyBudget?: { remaining: number };
}

/**
 * missing-service-page
 *
 * The client sells a service ("offering") but the site has no page for it.
 *
 * Discovery starts from the bounded crawl, but a small page set is NOT proof of
 * absence. Each offering that is not obviously present goes through a targeted
 * verification pass (see absenceVerification.ts): crawled pages, nav labels,
 * every discovered link (label + href), and sitemap URLs are searched with
 * normalized/singularized matching, and a plausible existing page is fetched to
 * confirm. Only offerings that survive verification become candidates, and the
 * verification record is attached for audit.
 */
export async function missingServicePageRule(ctx: RuleContext): Promise<Candidate[]> {
  const { client, catalog, evidence } = ctx;

  const service = catalog.find(
    (s) => s.active && s.tags.includes(LANDING_PAGE_TAG),
  );
  if (!service) return [];

  const pageCount = evidence.site.pages.length;
  const candidates: Candidate[] = [];

  for (const offering of client.offerings) {
    if (significantTokens(offering).length === 0) continue;

    const verification = await verifyOfferingAbsence({
      offering,
      allOfferings: client.offerings,
      evidence,
      fetchPage: ctx.fetchPage,
      budget: ctx.verifyBudget,
    });

    if (verification.conclusion !== "absent") continue;

    const inspectedNote =
      verification.inspectedUrls.length > 0
        ? ` Verification fetched ${verification.inspectedUrls.length} candidate page(s); none covered it.`
        : "";
    const consideredNote =
      verification.closeMatches.length > 0
        ? ` Nearest matches considered: ${verification.closeMatches
            .map((m) => `"${m.value}"`)
            .slice(0, 4)
            .join(", ")}.`
        : "";

    // Confidence rises with how much of the site we actually saw and whether
    // verification had to reject near-matches (a cleaner "nothing there" is
    // stronger than "we rejected three lookalikes").
    const coverageFactor = Math.min(1, pageCount / 8);
    const rawConfidence = Math.min(
      0.8,
      0.45 + coverageFactor * 0.2 + (verification.closeMatches.length === 0 ? 0.1 : 0),
    );

    candidates.push({
      ruleId: "missing-service-page",
      subject: offering,
      detected:
        `The client offers "${offering}" but targeted verification found no dedicated page for it. ` +
        `Checked ${pageCount} crawled page(s), ${evidence.site.nav.length} navigation label(s), ` +
        `${evidence.site.links.length} discovered link(s)` +
        (evidence.site.sitemapUrls.length > 0
          ? `, and ${evidence.site.sitemapUrls.length} sitemap URL(s)`
          : "") +
        `.${inspectedNote}${consideredNote}`,
      evidenceRefs: [
        ...evidence.site.pages.map((p) => p.url),
        ...verification.inspectedUrls.map((u) => `verified:${u}`),
        ...verification.closeMatches.filter((m) => m.url).map((m) => `considered:${m.url}`),
      ],
      rawConfidence,
      suggestedServiceId: service.id,
      verification,
    });
  }

  return candidates;
}
