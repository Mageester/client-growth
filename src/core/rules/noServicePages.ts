import type { Candidate } from "@/core/schema";
import type { RuleContext } from "@/core/rules/context";
import { serviceForRule } from "@/core/rules/registry";

/** Agency services tagged like this are what this rule proposes. */
const SERVICE_PAGES_TAG = "service-pages-build";

function count(n: number, singular: string, plural = singular + "s"): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * no-service-pages
 *
 * The client's website does not describe what the business sells anywhere.
 *
 * This is the exact inverse of missing-service-page, and the two are mutually
 * exclusive by construction: that rule requires `coverage.analyzable`, this one
 * requires the coverage assessment to have failed for the one reason that is a
 * fact about the SITE rather than about the crawl — `site-too-thin`, which is
 * set only when the crawl ran out of links before it ran out of budget.
 *
 * That distinction is what makes this claimable at all. "We read every page on
 * this site and none of them describes a service" is a complete crawl with a
 * definitive negative, not a crawl that fell short, so it is the strongest
 * evidence the product ever holds — and the largest piece of work it can put in
 * front of an agency. Reporting it as "we could not tell" understated the one
 * case the crawler is most certain about.
 */
export async function noServicePagesRule(ctx: RuleContext): Promise<Candidate[]> {
  const { client, catalog, evidence, coverage } = ctx;

  // Only an exhaustive crawl can support this claim. Without a coverage
  // assessment we do not know whether the crawl finished, so we claim nothing.
  if (!coverage || coverage.analyzable) return [];
  if (coverage.limitation !== "site-too-thin") return [];

  // A site that returned nothing readable is a crawl failure, not a thin site.
  // classifyAnalysis already reports that case, and it must not become a
  // finding here.
  const readablePages = evidence.site.pages.filter(
    (page) => page.status >= 200 && page.status < 300 && page.wordCount > 0,
  ).length;
  if (readablePages === 0) return [];

  // The agency has to have something to sell for this, and the finding is
  // priced from it.
  const service = serviceForRule(catalog, SERVICE_PAGES_TAG);
  if (!service) return [];

  // Nothing to build pages *for* if the client's own profile is empty. The
  // readiness check asks for offerings first, and without them this finding
  // could not say which services the site should be describing.
  if (client.offerings.length === 0) return [];

  const offerings = client.offerings;
  const named =
    offerings.length <= 3
      ? offerings.join(", ")
      : `${offerings.slice(0, 3).join(", ")} and ${offerings.length - 3} more`;

  return [
    {
      ruleId: "no-service-pages",
      // One finding for the whole site, not one per offering: the work is a set
      // of pages, and splitting it would invent a price per page that the
      // agency never quoted.
      subject: client.domain,
      detected:
        `The crawl followed every link on ${client.domain} and read ${count(readablePages, "page")}, ` +
        `and none of them describes a service this business sells. ` +
        `Nothing was blocked and nothing was left unread, so this is the whole site. ` +
        `The client is recorded as offering ${named}, ` +
        `so the site currently gives a visitor no page to land on for any of it.`,
      evidenceRefs: evidence.site.pages.map((page) => page.url),
      // A complete crawl with a definitive negative. There is no absence to
      // verify page-by-page here — the absence IS the whole finding, and it was
      // established by reading everything.
      rawConfidence: 0.9,
      suggestedServiceId: service.id,
    },
  ];
}
