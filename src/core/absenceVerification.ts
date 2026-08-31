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

  // A strong structural match (a nav item / clean URL literally named after the
  // service) is compelling on its own. Fetch it for evidence when we can, but
  // do not surface an opportunity against it either way.
  if (strongLinks.length > 0) {
    const top = strongLinks[0]!;
    let fetchedSatisfied = false;
    if (input.fetchPage && top.url && budget.remaining > 0) {
      budget.remaining--;
      inspectedUrls.push(top.url);
      const page = await input.fetchPage(top.url);
      if (page) {
        const tokens = textTokenSet([page.title, ...page.h1s, ...page.headings].join(" "));
        fetchedSatisfied = strengthOf(tokens, head, discriminating).hasAllDiscriminating;
        record({
          where: "fetched-page",
          value: page.title || top.url,
          url: top.url,
          score: top.score,
          satisfied: fetchedSatisfied,
          reason: fetchedSatisfied
            ? "Fetched the linked page; it targets this offering."
            : "Fetched the linked page; its title/headings did not clearly target this offering, but the link is named after the service.",
        });
      }
    }
    void fetchedSatisfied;
    for (const l of strongLinks.slice(0, 4)) {
      record({
        where: l.where,
        value: l.value,
        url: l.url,
        score: l.score,
        satisfied: true,
        reason:
          "Navigation label / link is named after this offering — a dedicated page almost certainly exists.",
      });
    }
    return present(offering, top.url, inspectedUrls, closeMatches);
  }

  // Close (but not conclusive) matches: fetch the top few and check content.
  for (const l of closeLinks) {
    if (!input.fetchPage || !l.url || budget.remaining <= 0) break;
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

  // Record the close matches we could not fetch / that did not satisfy.
  for (const l of closeLinks.slice(0, 4)) {
    if (l.url && inspectedUrls.includes(l.url)) continue;
    record({
      where: l.where,
      value: l.value,
      url: l.url,
      score: l.score,
      satisfied: false,
      reason: "Partially matches the offering but does not clearly cover it.",
    });
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
