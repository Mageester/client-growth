import type { EvidenceBundle, EvidencePage, Verification } from "@/core/schema";
import { coreTokens, significantTokens, singularize, slugTokens } from "@/core/text";

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

export type PageFetcher = (url: string) => Promise<EvidencePage | null>;

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
  // A long distinctive word matches AND the candidate shares enough of the rest
  // of the phrase to be about the same thing ("trenchless sewer line repair"
  // for "trenchless pipe repair"), not just any page that happens to say
  // "plumbing".
  const hasSignature =
    score >= 0.5 &&
    discriminating.some((t) => t.length >= SIGNATURE_MIN_LEN && has(candidateTokens, t));
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

  // Record any close matches we could not fetch (budget) but that had a URL.
  for (const l of closeLinks.slice(0, 4)) {
    if (l.url && inspectedUrls.includes(l.url)) continue;
    record({ where: l.where, value: l.value, url: l.url, score: l.score, satisfied: false, reason: "Partially matches the offering but does not clearly cover it." });
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

// ---------------------------------------------------------------------------
// Crawl / service-coverage adequacy
// ---------------------------------------------------------------------------

/**
 * Path segments that mean a page is NOT a service page. A large generic nav,
 * lots of these, or raw page count alone must never qualify a crawl as adequate.
 */
const NON_SERVICE_SEGMENTS = new Set([
  "", "home", "index", "about", "about-us", "our-story", "contact", "contact-us",
  "blog", "news", "articles", "resources", "careers", "career", "jobs",
  "reviews", "testimonials", "financing", "finance", "specials", "special-offers",
  "offers", "coupons", "promotions", "locations", "location", "service-area",
  "service-areas", "areas-served", "areas-we-serve", "privacy", "privacy-policy",
  "terms", "terms-of-service", "team", "our-team", "staff", "gallery", "photos",
  "projects", "portfolio", "shop", "store", "cart", "account", "login", "faq",
  "faqs", "sitemap", "search", "book", "booking", "schedule", "schedule-online",
  "request-appointment", "get-a-quote", "quote", "estimate", "buy-a-home",
  "sell-a-home", "for-homeowners",
]);

const SERVICE_PATH_HINT = /\/(services?|our-services|what-we-do|solutions|expertise)(\/|$)/i;
const SERVICE_WORD_IN_SEGMENT =
  /(repair|install|installation|replacement|cleaning|control|removal|treatment|maintenance|remediation|restoration|inspection|encapsulation|pruning|grinding|rewiring|lighting|irrigation)/i;

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

function isServiceLikePage(page: EvidencePage, heads: string[][]): boolean {
  let path = "/";
  try {
    path = new URL(page.url).pathname.toLowerCase();
  } catch {
    /* ignore */
  }
  if (SERVICE_PATH_HINT.test(path)) return true;
  const text = [page.title, ...page.h1s, ...page.headings].join(" ");
  if (heads.some((h) => textCoversOffering(text, h))) return true;
  const segs = path.split("/").filter(Boolean);
  const last = segs[segs.length - 1] ?? "";
  if (segs.length >= 1 && !NON_SERVICE_SEGMENTS.has(last) && SERVICE_WORD_IN_SEGMENT.test(last)) {
    return true;
  }
  return false;
}

export interface CoverageAssessment {
  analyzable: boolean;
  reason: string;
  representedOfferings: number;
  serviceLikePages: number;
  serviceLikeSitemapUrls: number;
}

/**
 * Do we actually have evidence that the SERVICE portion of the site was reached?
 * A large generic nav, or a pile of About/Blog/Location pages, does NOT count.
 * Adequate iff any of:
 *   - >= 2 distinct offerings are represented somewhere (page text, nav label,
 *     link label/href, or sitemap slug) by a strong deterministic match
 *   - >= 2 crawled pages look like service pages
 *   - >= 3 sitemap URLs look like service pages
 */
export function assessServiceCoverage(input: {
  client: { offerings: string[] };
  evidence: EvidenceBundle;
}): CoverageAssessment {
  const { evidence } = input;
  const offerings = input.client.offerings.filter((o) => offeringHead(o).length > 0);
  const heads = offerings.map(offeringHead);

  const haystack: string[] = [
    ...evidence.site.nav,
    ...evidence.site.links.map((l) => l.label),
  ];
  const slugHaystack: string[] = [
    ...evidence.site.links.map((l) => l.href),
    ...evidence.site.sitemapUrls,
  ];
  const pageText = evidence.site.pages.map((p) =>
    [p.title, ...p.h1s, ...p.headings].join(" "),
  );

  let representedOfferings = 0;
  for (const head of heads) {
    const represented =
      pageText.some((t) => textCoversOffering(t, head)) ||
      haystack.some((h) => textCoversOffering(h, head)) ||
      slugHaystack.some((s) => slugCoversOffering(s, head));
    if (represented) representedOfferings++;
  }

  const serviceLikePages = evidence.site.pages.filter((p) =>
    isServiceLikePage(p, heads),
  ).length;
  const serviceLikeSitemapUrls = evidence.site.sitemapUrls.filter(
    (u) => heads.some((h) => slugCoversOffering(u, h)) || SERVICE_PATH_HINT.test(u),
  ).length;

  const analyzable =
    representedOfferings >= 2 || serviceLikePages >= 2 || serviceLikeSitemapUrls >= 3;

  const reason = analyzable
    ? `Service coverage confirmed: ${representedOfferings} offering(s) represented on the site, ${serviceLikePages} service-like crawled page(s), ${serviceLikeSitemapUrls} service-like sitemap URL(s).`
    : `Insufficient service coverage: only ${representedOfferings} offering(s) represented, ${serviceLikePages} service-like crawled page(s), ${serviceLikeSitemapUrls} service-like sitemap URL(s) — the crawl did not demonstrably reach the site's service pages, so no absence can be claimed.`;

  return { analyzable, reason, representedOfferings, serviceLikePages, serviceLikeSitemapUrls };
}
