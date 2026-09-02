import type { EvidenceBundle } from "@/core/schema";
import { classifyCommercialLanguage } from "@/core/commercialLanguage";
import { significantTokens, titleCase } from "@/core/text";
import {
  isInServiceSection,
  isNonServiceSegment,
  isServiceHub,
  hasServiceWordInSlug,
  pathSegments,
} from "@/core/siteStructure";

/**
 * "These look like services customers can hire this business for."
 *
 * The second reason a real client comes back inconclusive is not the crawler at
 * all: it is a client profile with one line in it. The site plainly sells six
 * things and Client Growth was told about one, so coverage can never be
 * confirmed and the agency is told, unhelpfully, to try again.
 *
 * This reads evidence that has ALREADY been crawled and proposes what the
 * business appears to sell. Three rules make it safe to show an agency:
 *
 *   1. Nothing is ever added silently. This function returns suggestions; a
 *      person confirms, edits or removes every one of them.
 *   2. Every suggestion carries its provenance. There is no unattributed list —
 *      each one names the pages and navigation entries it came from, so the
 *      agency can check it in seconds rather than trusting it.
 *   3. The commercial judgment taxonomy is applied first. "Fully Insured",
 *      "Free Quotes" and "Financing" appear in real service-business navigation
 *      constantly, and every one of them would become a priced landing-page
 *      proposal if it reached the offerings box.
 *
 * Fully deterministic. No AI, no network — it only reads the bundle it is given.
 */

export type SuggestionConfidence = "high" | "medium";

export type OfferingEvidenceKind =
  | "service-section-page"
  | "service-section-link"
  | "navigation-link"
  | "homepage-card"
  | "sitemap-url";

export interface OfferingEvidence {
  kind: OfferingEvidenceKind;
  /** The page or link this came from, when there is one to show. */
  url?: string;
  /** One line an agency owner can read: "Linked from the main navigation". */
  detail: string;
}

export interface SuggestedOffering {
  /** What to put in the offerings box, in the site's own words. */
  label: string;
  confidence: SuggestionConfidence;
  /** Why this is being suggested. Never empty. */
  evidence: OfferingEvidence[];
}

export interface SuggestOfferingsInput {
  evidence: EvidenceBundle;
  /** What the agency already recorded; anything equivalent is not re-suggested. */
  existingOfferings: string[];
  /** Cap on suggestions returned. Default 12. */
  max?: number;
}

/** Navigation furniture: real anchor text that is not a service. */
const FURNITURE =
  /^(home|menu|search|book(ing)?( (online|now))?|schedule( (online|service|now))?|call( us)?|contact( us)?|email( us)?|get (a )?(quote|estimate|started)|request (a )?(quote|estimate|appointment|service)|apply( (now|locally))?|careers?|jobs?|login|log in|sign in|sign up|my account|account|cart|checkout|read more|learn more|more|see (all|more)|view (all|more)|click here|next|previous|back|top|skip to (main )?content|français|english|espa[nñ]ol)$/i;

/** A location page ("Toronto", "Find My Local X") is not a service. */
const LOCATION_LIKE = /^(find (my|a) (local|nearby)|locations?|areas? (we )?serve|service areas?)\b/i;

const MAX_LABEL_WORDS = 6;
const MAX_LABEL_CHARS = 60;

interface Candidate {
  label: string;
  evidence: OfferingEvidence[];
  /** Distinct evidence kinds seen, for scoring. */
  kinds: Set<OfferingEvidenceKind>;
}

/** A stable key so "Heat Pump Repair" and "heat pump repairs" are one thing. */
function keyOf(label: string): string {
  const tokens = significantTokens(label);
  return tokens.length > 0 ? tokens.slice().sort().join(" ") : label.trim().toLowerCase();
}

function cleanLabel(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/^[\s–—-]+|[\s–—\-:|,.]+$/g, "")
    .trim();
}

/** "/services/heat-pump-installation" -> "Heat Pump Installation" */
function labelFromUrl(url: string): string {
  const segments = pathSegments(url);
  const last = segments[segments.length - 1] ?? "";
  if (!last) return "";
  return titleCase(last.replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_]+/g, " "));
}

/**
 * Is this text usable as an offering at all? Rejects navigation furniture,
 * locations, sentences, and — the point of the exercise — anything the
 * commercial judgment taxonomy recognises as a claim about the business rather
 * than work it does.
 */
function usableLabel(label: string): boolean {
  if (label.length < 3 || label.length > MAX_LABEL_CHARS) return false;
  if (label.split(/\s+/).length > MAX_LABEL_WORDS) return false;
  if (!/[a-z]/i.test(label)) return false;
  if (FURNITURE.test(label)) return false;
  if (LOCATION_LIKE.test(label)) return false;
  if (classifyCommercialLanguage(label) !== null) return false;
  if (significantTokens(label).length === 0) return false;
  return true;
}

/** Does this label describe something the client already told us about? */
function coveredByExisting(label: string, existingKeys: Set<string>): boolean {
  return existingKeys.has(keyOf(label));
}

export function suggestOfferings(input: SuggestOfferingsInput): SuggestedOffering[] {
  const max = input.max ?? 12;
  const { site } = input.evidence;
  const existingKeys = new Set(input.existingOfferings.map(keyOf));
  const candidates = new Map<string, Candidate>();

  const add = (
    rawLabel: string,
    kind: OfferingEvidenceKind,
    url: string | undefined,
    detail: string,
  ): void => {
    const label = cleanLabel(rawLabel);
    if (!usableLabel(label)) return;
    if (coveredByExisting(label, existingKeys)) return;

    const key = keyOf(label);
    const existing = candidates.get(key);
    if (!existing) {
      candidates.set(key, { label, evidence: [{ kind, url, detail }], kinds: new Set([kind]) });
      return;
    }
    existing.kinds.add(kind);
    // Keep the evidence list short and free of near-duplicates: an agency
    // checking a suggestion wants two or three places to look, not thirty.
    if (
      existing.evidence.length < 4 &&
      !existing.evidence.some((e) => e.kind === kind && e.url === url)
    ) {
      existing.evidence.push({ kind, url, detail });
    }
  };

  // ---- A. Crawled pages inside the service section -------------------------
  // The strongest evidence there is: the page was fetched and read, and it sits
  // where the site itself files what it sells.
  for (const page of site.pages) {
    if (page.status < 200 || page.status >= 300 || page.wordCount === 0) continue;
    if (isServiceHub(page.url)) continue;
    if (!isInServiceSection(page.url) && !hasServiceWordInSlug(page.url)) continue;
    const label = page.h1s[0] || page.title.split(/\s+[|–—-]\s+/)[0] || labelFromUrl(page.url);
    add(label, "service-section-page", page.url, `Has its own page at ${page.url}`);
  }

  // ---- B. Links into the service section, and navigation -------------------
  const homepageHeadings = new Set(
    site.pages
      .filter((page) => pathSegments(page.url).length === 0)
      .flatMap((page) => page.headings.map((h) => cleanLabel(h).toLowerCase())),
  );

  for (const link of site.links) {
    if (link.scheme !== "http") continue;
    const segments = pathSegments(link.href);
    if (segments.length === 0) continue;
    const last = segments[segments.length - 1] ?? "";
    if (isNonServiceSegment(last)) continue;
    if (isServiceHub(link.href)) continue;

    const label = cleanLabel(link.label || link.ariaLabel || link.title) || labelFromUrl(link.href);
    if (!label) continue;

    if (isInServiceSection(link.href)) {
      add(label, "service-section-link", link.href, `Listed under the site's services section (${link.href})`);
    } else if (hasServiceWordInSlug(link.href)) {
      add(label, "service-section-link", link.href, `Has its own page at ${link.href}`);
    } else if (link.inNav) {
      // A bare nav entry with no service-shaped URL is weak on its own; it only
      // becomes a suggestion if something else corroborates it.
      add(label, "navigation-link", link.href, "Listed in the site's main navigation");
      continue;
    } else {
      continue;
    }

    if (link.inNav) add(label, "navigation-link", link.href, "Listed in the site's main navigation");
    if (homepageHeadings.has(label.toLowerCase())) {
      add(label, "homepage-card", link.href, "Shown as a service card on the homepage");
    }
  }

  // ---- C. Sitemap URLs inside the service section ---------------------------
  for (const url of site.sitemapUrls) {
    if (isServiceHub(url)) continue;
    if (!isInServiceSection(url) && !hasServiceWordInSlug(url)) continue;
    const label = labelFromUrl(url);
    if (!label) continue;
    add(label, "sitemap-url", url, `Listed in the site's sitemap (${url})`);
  }

  // ---- Score and rank -------------------------------------------------------
  // "High" means the site says this in more than one way — a page that exists
  // AND is linked, or a services-section link that is also in the navigation.
  // A single weak signal is dropped rather than shown: an unsupported guess in
  // a confirmation list is worse than a shorter list.
  const scored: SuggestedOffering[] = [];
  for (const candidate of candidates.values()) {
    const strong =
      candidate.kinds.has("service-section-page") ||
      candidate.kinds.has("service-section-link") ||
      candidate.kinds.has("sitemap-url");
    if (!strong) continue;
    const confidence: SuggestionConfidence =
      candidate.kinds.size >= 2 || candidate.kinds.has("service-section-page") ? "high" : "medium";
    scored.push({ label: candidate.label, confidence, evidence: candidate.evidence });
  }

  scored.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === "high" ? -1 : 1;
    if (b.evidence.length !== a.evidence.length) return b.evidence.length - a.evidence.length;
    return a.label.localeCompare(b.label);
  });
  return scored.slice(0, max);
}
