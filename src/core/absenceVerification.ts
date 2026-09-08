import type { EvidenceBundle, EvidencePage, Verification } from "@/core/schema";
import type { PageFetchFailure, PageFetchResult } from "@/ports/EvidenceProvider";
import { coreTokens, significantTokens, singularize, slugTokens } from "@/core/text";
import {
  looksLikeServiceUrl,
  pathSegments,
  slugSaysNonService,
} from "@/core/siteStructure";

/**
 * Targeted "does a page for this offering already exist?" check.
 *
 * Candidate discovery starts from the bounded crawl, but a limited page set is
 * NOT proof of absence. Before an offering is treated as missing we search the
 * crawled pages, navigation labels, every discovered same-origin link (label AND
 * href), and sitemap URLs with normalized/singularized token matching, and — if
 * a plausible existing page is found but not yet fetched — we fetch that one page
 * to confirm. Only when all of that fails do we conclude the page is absent.
 *
 * Fully deterministic. No AI. The only network is a handful of targeted GETs,
 * capped by `maxFetches`.
 */

export type PageFetcher = (url: string) => Promise<PageFetchResult>;

export interface VerifyOfferingInput {
  offering: string;
  /** All of the client's offerings — used to spot tokens that are generic for
   *  this client (e.g. "plumbing" when every offering mentions it). */
  allOfferings: string[];
  evidence: EvidenceBundle;
  fetchPage?: PageFetcher;
  /** Shared, mutable fetch budget across all offerings in one analysis. */
  budget?: { remaining: number };
  maxFetches?: number;
}

type CloseMatch = Verification["closeMatches"][number];

function isPageFetchFailure(page: PageFetchResult): page is PageFetchFailure {
  return page !== null && "kind" in page && page.kind === "network-failure";
}

const STRONG_SCORE = 0.6;
const CLOSE_SCORE = 0.5;

function textTokenSet(text: string): Set<string> {
  return new Set(coreTokens(text).map(singularize));
}

/** Shared leading characters of two strings. */
function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/**
 * Is `token` represented in `setTokens`? Tolerates a contained substring
 * ("heatpump" ~ "pump") and a shared stem ("hardscape" ~ "hardscaping",
 * "electrical" ~ "electrician") so morphological variants still match.
 */
function has(setTokens: Set<string>, token: string): boolean {
  if (setTokens.has(token)) return true;
  for (const t of setTokens) {
    if (t.length < 4 || token.length < 4) continue;
    if (t.includes(token) || token.includes(t)) return true;
    const shorter = Math.min(t.length, token.length);
    const prefix = commonPrefix(t, token);
    if (prefix >= 5 && prefix >= shorter - 2) return true;
  }
  return false;
}

interface Strength {
  score: number;
  hasAllDiscriminating: boolean;
  /** A long, highly specific token of the offering (e.g. "trenchless",
   *  "geothermal") is present — on its own that near-certainly identifies the
   *  page even if a secondary word ("pipe" vs "sewer line") differs. */
  hasSignature: boolean;
}

const SIGNATURE_MIN_LEN = 7;

function strengthOf(
  candidateTokens: Set<string>,
  head: string[],
  discriminating: string[],
): Strength {
  if (head.length === 0) return { score: 0, hasAllDiscriminating: false, hasSignature: false };
  const overlap = head.filter((t) => has(candidateTokens, t)).length;
  const score = overlap / head.length;
  const hasAllDiscriminating =
    discriminating.length > 0 && discriminating.every((t) => has(candidateTokens, t));
  const signatureToken = discriminating.some(
    (t) => t.length >= SIGNATURE_MIN_LEN && has(candidateTokens, t),
  );

  // The candidate introduces no concept the offering does not already contain.
  //
  // This is what rescues a page named after the ONE word that identifies it.
  // "Invisalign clear aligners" has three head tokens, so the link
  // `/invisalign/` covers a third of the phrase and scores 0.33 — under the 0.5
  // floor below, and therefore, before this existed, invisible. On the real
  // corpus that produced two confident, priced findings ("No page for
  // Invisalign clear aligners") for two dental practices whose Invisalign page
  // is linked from every page of the site. A false claim of absence is the one
  // failure this product cannot afford; erring the other way merely stays
  // quiet, which its own judgment prompt already calls the cheaper mistake.
  //
  // Deliberately narrow. It requires the candidate to be a SUBSET: a slug or a
  // nav label saying nothing beyond the offering's own words. A crawled page's
  // title and headings never qualify, and a candidate naming a different
  // service never qualifies, because either introduces tokens of its own.
  const saysNothingNew =
    candidateTokens.size > 0 &&
    [...candidateTokens].every((t) => head.includes(t));

  // A long distinctive word matches AND either the candidate shares enough of
  // the rest of the phrase to be about the same thing ("trenchless sewer line
  // repair" for "trenchless pipe repair"), or it adds nothing of its own.
  const hasSignature = signatureToken && (score >= 0.5 || saysNothingNew);
  return { score, hasAllDiscriminating, hasSignature };
}

export async function verifyOfferingAbsence(
  input: VerifyOfferingInput,
): Promise<Verification> {
  const { offering, allOfferings, evidence } = input;
  const maxFetches = input.maxFetches ?? 3;
  const budget = input.budget ?? { remaining: maxFetches };

  const head = significantTokens(offering);
  const closeMatches: CloseMatch[] = [];
  const inspectedUrls: string[] = [];

  if (head.length === 0) {
    return {
      conclusion: "weak",
      inspectedUrls,
      closeMatches,
      reason: `"${offering}" has no distinctive words to verify against; not treated as a gap.`,
    };
  }

  // Tokens that recur across the client's offerings carry no discriminating
  // meaning for THIS client and are dropped from the "must be present" set.
  const freq = new Map<string, number>();
  for (const other of allOfferings) {
    for (const t of new Set(significantTokens(other))) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  let discriminating = head.filter((t) => (freq.get(t) ?? 0) < 2);
  if (discriminating.length === 0) discriminating = [...head];

  const record = (m: CloseMatch) => {
    if (!closeMatches.some((c) => c.where === m.where && c.value === m.value)) closeMatches.push(m);
  };

  // ---- A. Already-fetched pages (authoritative content) --------------------
  for (const page of evidence.site.pages) {
    // The homepage cannot prove a service has a page of its own, and neither
    // can a glossary or an about page. This is the whole finding, not a
    // refutation of it: the service being sold is "a dedicated,
    // conversion-focused page for one service line", so a business whose only
    // mention of a service is in a keyword-stuffed homepage title is the exact
    // customer for it.
    //
    // Measured on the analyzability corpus, accepting the homepage here
    // suppressed 62 of 83 "present" verdicts across 19 of 24 sites — six of six
    // offerings on aireserv.com, mrelectric.com, fixitrightplumbing.com.au and
    // thelawnsalon.ca, whose homepage title reads "Winnipeg Deck Builders |
    // Winnipeg Fence Builders | Winnipeg Hardscape Design" and which has a page
    // for none of them. Those agencies were told their client's site was clean.
    //
    // A real service page still satisfies the offering: it is reached through
    // the navigation, link and sitemap evidence in section B below, which is
    // stronger proof of a dedicated page than a token match anywhere on a site.
    if (isHomepage(page.url) || slugSaysNonService(page.url)) continue;

    const tokens = textTokenSet([page.title, ...page.h1s, ...page.headings].join(" "));
    const s = strengthOf(tokens, head, discriminating);
    if ((s.hasAllDiscriminating && s.score >= STRONG_SCORE) || s.hasSignature) {
      record({
        where: "crawled-page",
        value: page.title || page.url,
        url: page.url,
        score: round(s.score),
        satisfied: true,
        reason: "A crawled page already targets this offering in its title/headings.",
      });
      return present(offering, matchedUrlOf(closeMatches), inspectedUrls, closeMatches);
    }
  }

  // ---- B. Navigation labels, links (label + href), sitemap URLs -----------
  const strongLinks: Array<{ url?: string; value: string; where: CloseMatch["where"]; score: number }> = [];
  const closeLinks: Array<{ url?: string; value: string; where: CloseMatch["where"]; score: number }> = [];

  const consider = (value: string, where: CloseMatch["where"], url: string | undefined, isSlug: boolean) => {
    if (!value.trim()) return;
    const tokens = isSlug ? new Set(slugTokens(value)) : textTokenSet(value);
    const s = strengthOf(tokens, head, discriminating);
    if (s.hasAllDiscriminating || s.hasSignature) {
      strongLinks.push({ url, value, where, score: round(s.score) });
    } else if (s.score >= CLOSE_SCORE) {
      closeLinks.push({ url, value, where, score: round(s.score) });
    }
  };

  for (const label of evidence.site.nav) consider(label, "nav-label", undefined, false);
  for (const link of evidence.site.links) {
    consider(link.label, link.inNav ? "nav-label" : "link-label", link.href, false);
    consider(link.href, "link-href", link.href, true);
  }
  for (const url of evidence.site.sitemapUrls) consider(url, "sitemap-url", url, true);

  strongLinks.sort((a, b) => b.score - a.score);
  closeLinks.sort((a, b) => b.score - a.score);

  const strongWithUrl = strongLinks.filter((l) => l.url);
  const strongLabelOnly = strongLinks.filter((l) => !l.url);

  // A strong structural match WITH a link: fetch it for evidence when we can,
  // then conclude the page is present either way (the URL is named after the
  // service).
  if (strongWithUrl.length > 0) {
    const top = strongWithUrl[0]!;
    if (input.fetchPage && top.url && budget.remaining > 0) {
      budget.remaining--;
      inspectedUrls.push(top.url);
      const page = await input.fetchPage(top.url);
      if (isPageFetchFailure(page)) {
        record({
          where: top.where,
          value: top.value,
          url: top.url,
          score: top.score,
          satisfied: false,
          reason: `Targeted fetch was ${page.outcome}: ${page.reason}`,
        });
        return inconclusive(
          offering,
          inspectedUrls,
          closeMatches,
          `Targeted verification of "${top.url}" was ${page.outcome}; absence cannot be proven.`,
        );
      }
      if (page) {
        const tokens = textTokenSet([page.title, ...page.h1s, ...page.headings].join(" "));
        const satisfied = strengthOf(tokens, head, discriminating).hasAllDiscriminating;
        record({
          where: "fetched-page",
          value: page.title || top.url,
          url: top.url,
          score: top.score,
          satisfied,
          reason: satisfied
            ? "Fetched the linked page; it targets this offering."
            : "Fetched the linked page; the link is named after the service though its title/headings were less specific.",
        });
      }
    }
    for (const l of strongWithUrl.slice(0, 4)) {
      record({ where: l.where, value: l.value, url: l.url, score: l.score, satisfied: true, reason: "Link is named after this offering — a dedicated page almost certainly exists." });
    }
    return present(offering, top.url, inspectedUrls, closeMatches);
  }

  // Close (but not conclusive) matches that HAVE a link: fetch and check content.
  for (const l of closeLinks) {
    if (!input.fetchPage || !l.url || budget.remaining <= 0) continue;
    if (inspectedUrls.includes(l.url)) continue;
    budget.remaining--;
    inspectedUrls.push(l.url);
    const page = await input.fetchPage(l.url);
    if (isPageFetchFailure(page)) {
      record({
        where: l.where,
        value: l.value,
        url: l.url,
        score: l.score,
        satisfied: false,
        reason: `Targeted fetch was ${page.outcome}: ${page.reason}`,
      });
      return inconclusive(
        offering,
        inspectedUrls,
        closeMatches,
        `Targeted verification of "${l.url}" was ${page.outcome}; absence cannot be proven.`,
      );
    }
    if (!page) {
      record({ where: l.where, value: l.value, url: l.url, score: l.score, satisfied: false, reason: "Linked page could not be fetched." });
      continue;
    }
    const tokens = textTokenSet([page.title, ...page.h1s, ...page.headings].join(" "));
    const s = strengthOf(tokens, head, discriminating);
    const satisfied = (s.hasAllDiscriminating && s.score >= STRONG_SCORE) || s.hasSignature;
    record({
      where: "fetched-page",
      value: page.title || l.url,
      url: l.url,
      score: round(s.score),
      satisfied,
      reason: satisfied
        ? "Fetched a near-match link; the page does target this offering."
        : "Fetched a near-match link; the page does not adequately cover this offering.",
    });
    if (satisfied) return present(offering, l.url, inspectedUrls, closeMatches);
  }

  // An existence signal we could NOT verify — a matching nav label / link with
  // no href to fetch. We cannot prove absence, so we do not surface.
  const unverifiable = [...strongLabelOnly, ...closeLinks.filter((l) => !l.url)];
  if (unverifiable.length > 0) {
    for (const l of unverifiable.slice(0, 4)) {
      record({ where: l.where, value: l.value, url: l.url, score: l.score, satisfied: false, reason: "Matches this offering but has no link to verify — existence signal, cannot confirm or deny." });
    }
    return {
      conclusion: "inconclusive",
      inspectedUrls,
      closeMatches,
      reason: `A navigation entry ("${unverifiable[0]!.value}") matches "${offering}" but has no link to verify; absence cannot be proven, so no opportunity is surfaced.`,
    };
  }

  // A close URL that was not fetched is an evidence limitation, not proof of
  // absence. This includes a depleted targeted-fetch budget and providers that
  // do not expose targeted fetching at all.
  const unverifiedCloseLinks = closeLinks.filter(
    (l) => l.url && !inspectedUrls.includes(l.url),
  );
  if (unverifiedCloseLinks.length > 0) {
    for (const l of unverifiedCloseLinks.slice(0, 4)) {
      record({
        where: l.where,
        value: l.value,
        url: l.url,
        score: l.score,
        satisfied: false,
        reason: "Near-match URL was not fetched; targeted verification was unavailable or its budget was exhausted.",
      });
    }
    return inconclusive(
      offering,
      inspectedUrls,
      closeMatches,
      "a near-match URL could not be checked within the targeted verification budget; absence cannot be proven.",
    );
  }

  return {
    conclusion: "absent",
    inspectedUrls,
    closeMatches,
    reason:
      closeMatches.length > 0
        ? `No crawled page, navigation entry, link, or sitemap URL adequately covers "${offering}"; the nearest matches were checked and rejected.`
        : `No crawled page, navigation entry, link, or sitemap URL mentions "${offering}".`,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function matchedUrlOf(closeMatches: CloseMatch[]): string | undefined {
  return closeMatches.find((c) => c.satisfied)?.url;
}

function present(
  offering: string,
  matchedUrl: string | undefined,
  inspectedUrls: string[],
  closeMatches: CloseMatch[],
): Verification {
  return {
    conclusion: "present",
    inspectedUrls,
    closeMatches,
    reason: matchedUrl
      ? `The site already has a page/section for "${offering}" (${matchedUrl}).`
      : `The site already represents "${offering}" in its navigation or link structure.`,
  };
}

function inconclusive(
  offering: string,
  inspectedUrls: string[],
  closeMatches: CloseMatch[],
  reason: string,
): Verification {
  return {
    conclusion: "inconclusive",
    inspectedUrls,
    closeMatches,
    reason: `Could not verify whether "${offering}" is represented. ${reason}`,
  };
}

// ---------------------------------------------------------------------------
// Crawl / service-coverage adequacy
// ---------------------------------------------------------------------------

function offeringHead(offering: string): string[] {
  return significantTokens(offering);
}

/** Does this text strongly cover the offering (>= 60% of head tokens, deterministic)? */
function textCoversOffering(text: string, head: string[]): boolean {
  if (head.length === 0) return false;
  const tokens = textTokenSet(text);
  const overlap = head.filter((t) => has(tokens, t)).length;
  return overlap / head.length >= STRONG_SCORE && overlap >= 1;
}

function slugCoversOffering(slug: string, head: string[]): boolean {
  if (head.length === 0) return false;
  const tokens = new Set(slugTokens(slug));
  const overlap = head.filter((t) => has(tokens, t)).length;
  return overlap / head.length >= STRONG_SCORE && overlap >= 1;
}

function isHomepage(url: string): boolean {
  return pathSegments(url).length === 0;
}

/**
 * Is this a page that describes something the business sells?
 *
 * The test is STRUCTURAL, and deliberately so. It used to accept a page whose
 * title or headings covered one of the client's offerings, and on a real site
 * that is exactly backwards: a five-page brochure site whose Contact page is
 * titled "Social Skill Groups Near Me" scored four service pages and was
 * reported as fully assessed. Titles are marketing copy; the URL is where the
 * site itself says what a page is for.
 *
 * Two ways in:
 *   - the site files it under a services section, or its slug names work being
 *     done (/furnace-repair, /services/heat-pumps, /treatments/veneers);
 *   - the slug matches one of this client's offerings and is not one of the
 *     boring pages (/heat-pumps for a client who sells heat pumps).
 *
 * The homepage never counts. Every business's homepage says what it does, so
 * counting it makes "we fetched one page" mean "we reached the services".
 */
function isServiceLikePage(
  page: EvidencePage,
  heads: string[][],
  serviceNavTargets: Set<string>,
): boolean {
  if (isHomepage(page.url)) return false;
  if (looksLikeServiceUrl(page.url)) return true;
  if (slugSaysNonService(page.url)) return false;
  if (serviceNavTargets.has(normalizedPageUrl(page.url))) return true;
  return heads.some((head) => slugCoversOffering(page.url, head));
}

function normalizedPageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/#.*$/, "").replace(/\/$/, "");
  }
}

/** The same question for a URL the crawl only knows about from the sitemap. */
function isServiceLikeUrl(url: string, heads: string[][]): boolean {
  if (isHomepage(url)) return false;
  if (looksLikeServiceUrl(url)) return true;
  if (slugSaysNonService(url)) return false;
  return heads.some((head) => slugCoversOffering(url, head));
}

/**
 * Why coverage failed — the two possibilities need opposite messages.
 *
 *   site-too-thin     we read the whole site and it has no service pages
 *   coverage-limited  we could not get far enough to tell
 */
export type CoverageLimitation = "site-too-thin" | "coverage-limited";

export interface CoverageAssessment {
  analyzable: boolean;
  reason: string;
  representedOfferings: number;
  serviceLikePages: number;
  serviceLikeSitemapUrls: number;
  /** Null when the crawl did reach the services. */
  limitation: CoverageLimitation | null;
}

/**
 * Do we actually have evidence that the SERVICE portion of the site was reached?
 *
 * A large generic nav, or a pile of About/Blog/Location pages, does not count,
 * and neither does the homepage on its own. Adequate iff any of:
 *
 *   - >= 2 distinct offerings are represented in the site's STRUCTURE — a
 *     navigation label, a link label or href, a sitemap slug, or the headings of
 *     a page that is itself a service page;
 *   - >= 2 crawled pages are service pages;
 *   - >= 3 sitemap URLs are service pages.
 *
 * Homepage prose is not structure. It used to count, and it is why a site with
 * four pages and no services at all could be called covered: every small
 * business writes what it does on its front page. What has to be demonstrated
 * is that the crawl found where those things LIVE.
 */
export function assessServiceCoverage(input: {
  client: { offerings: string[] };
  evidence: EvidenceBundle;
}): CoverageAssessment {
  const { evidence } = input;
  const offerings = input.client.offerings.filter((o) => offeringHead(o).length > 0);
  const heads = offerings.map(offeringHead);

  // Navigation and link labels are structure: they are the site's own index of
  // what it sells, and each one carries an href a later targeted fetch can
  // check. A label alone never proves a page exists — that is absence
  // verification's job — it proves the crawl found the index.
  const labelHaystack: string[] = [
    ...evidence.site.nav,
    ...evidence.site.links.map((l) => l.label),
  ];
  const slugHaystack: string[] = [
    ...evidence.site.links.filter((l) => l.scheme === "http").map((l) => l.href),
    ...evidence.site.sitemapUrls,
  ];
  const serviceNavTargets = new Set(
    evidence.site.links
      .filter((link) => link.scheme === "http" && link.inServiceNav)
      .map((link) => normalizedPageUrl(link.href)),
  );
  // Page text counts only from pages that are themselves service pages.
  const serviceLikePages = evidence.site.pages.filter((page) =>
    isServiceLikePage(page, heads, serviceNavTargets),
  );
  const servicePageText = serviceLikePages.map((p) =>
    [p.title, ...p.h1s, ...p.headings].join(" "),
  );

  let representedOfferings = 0;
  for (const head of heads) {
    const represented =
      servicePageText.some((t) => textCoversOffering(t, head)) ||
      labelHaystack.some((h) => textCoversOffering(h, head)) ||
      slugHaystack.some((s) => slugCoversOffering(s, head));
    if (represented) representedOfferings++;
  }

  const serviceLikeSitemapUrls = evidence.site.sitemapUrls.filter((u) =>
    isServiceLikeUrl(u, heads),
  ).length;

  const analyzable =
    representedOfferings >= 2 || serviceLikePages.length >= 2 || serviceLikeSitemapUrls >= 3;

  // A crawl that ran out of links before it ran out of budget saw everything
  // there was to see. Silence after an exhaustive look is a fact about the
  // SITE; silence after a truncated one is a fact about the CRAWL, and telling
  // an agency the wrong one sends them to fix something that is not broken.
  const limitation: CoverageLimitation | null = analyzable
    ? null
    : evidence.site.crawlExhaustive
      ? "site-too-thin"
      : "coverage-limited";

  const counts = `${representedOfferings} offering(s) represented in the site's navigation, links or sitemap, ${serviceLikePages.length} service page(s) read, ${serviceLikeSitemapUrls} service URL(s) in the sitemap`;

  const reason = analyzable
    ? `Service coverage confirmed: ${counts}.`
    : limitation === "site-too-thin"
      ? `This site has no service pages: the crawl followed every link on it and found ${counts}. Nothing was blocked and nothing was left unread, so this is the whole site.`
      : `Insufficient service coverage: only ${counts} — the crawl did not demonstrably reach the site's service pages, so no absence can be claimed.`;

  return {
    analyzable,
    reason,
    representedOfferings,
    serviceLikePages: serviceLikePages.length,
    serviceLikeSitemapUrls,
    limitation,
  };
}
