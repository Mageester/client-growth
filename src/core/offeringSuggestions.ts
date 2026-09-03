import type { EvidenceBundle } from "@/core/schema";
import { classifyCommercialLanguage } from "@/core/commercialLanguage";
import { significantTokens, titleCase } from "@/core/text";
import {
  isArchivePath,
  isInServiceSection,
  isServiceHub,
  hasServiceWordInSlug,
  pathSegments,
  slugSaysNonService,
} from "@/core/siteStructure";

/**
 * "These look like services customers can hire this business for."
 *
 * The second reason a real client comes back inconclusive is not the crawler at
 * all: it is a client profile with one line in it. The site plainly sells six
 * things and Axiom Orbit was told about one, so coverage can never be
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

/**
 * Navigation furniture: real anchor text that is not a service.
 *
 * The important members of this list are the generic call-to-action labels.
 * A services grid whose three cards all link out under the words "View service"
 * is a normal way to build a page, and taking the anchor text at face value
 * produces one suggestion called "View service" backed by three unrelated URLs.
 * When the words are furniture the URL is the better name.
 */
const FURNITURE =
  /^(home|menu|search|book(ing)?( (online|now))?|schedule( (online|service|now))?|call( us)?|contact( us)?|email( us)?|get (a )?(quote|estimate|started)|request (a )?(quote|estimate|appointment|service)|apply( (now|locally))?|careers?|jobs?|login|log in|sign in|sign up|my account|account|cart|checkout|read more|learn more|find out more|more|more info(rmation)?|see (all|more|details)|view (all|more|details?|service|services|page)|explore( more)?|discover( more)?|start( (here|now|this path))?|details|continue|next|previous|back|top|skip to (main )?content|our services|all services|services|français|english|espa[nñ]ol)$/i;

/** A location page ("Toronto", "Find My Local X") is not a service. */
const LOCATION_LIKE = /^(find (my|a) (local|nearby)|locations?|areas? (we )?serve|service areas?)\b/i;

/** The boring pages every site has, as they are written in a navigation bar. */
const BORING_PAGE =
  /^(about( us)?|our (story|team|mission|process|approach|philosophy)|meet the (team|doctors?|staff)|blog|news|press|media|articles|resources|reviews?|testimonials?|privacy( policy)?|terms.*|sitemap|gallery|photos|portfolio|projects|work|faqs?|financing|finance|specials?|special offers?|coupons?|promos?|promotions?|offers?|deals?|careers?|who we are|what we do|glossary|read|overview|introduction)$/i;

/** A page about what something costs is not the thing being sold. */
const PRICE_PAGE = /(cost|costs|price|prices|pricing|rates|fees)$/i;

/**
 * A service page written for one town — "Pool Removal in Charleswood" — is the
 * same offering as the one next to it, not another thing the business sells.
 * Suggesting twelve of them fills the confirmation list with one service.
 */
const LOCATION_QUALIFIED = /\s(?:in|near|serving|around|throughout)\s+\p{Lu}/iu;

/** A question is an article about the work, not the work. */
const QUESTION = /\?\s*$/;

/** A downloadable document is not a service page. */
const DOCUMENT_URL = /\.(pdf|docx?|xlsx?|pptx?|zip|csv|jpe?g|png|gif|svg|webp|mp4|mp3)$/i;

/** WordPress-style archive titles: "Category: Teeth Whitening", "Tag: Plumbing". */
const ARCHIVE_TITLE = /^(category|categories|tag|tags|archive|archives|author|page)\s*[:|-]/i;

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
  // A service is named, not described. Anything a site presents as a service
  // starts with a capital — "good candidates for teeth whitening" is a sentence
  // lifted out of a blog post, and it reads as nonsense in a confirmation list.
  if (!/^[\p{Lu}\p{N}]/u.test(label)) return false;
  if (ARCHIVE_TITLE.test(label)) return false;
  if (QUESTION.test(label)) return false;
  if (LOCATION_QUALIFIED.test(label)) return false;
  if (PRICE_PAGE.test(label)) return false;
  if (FURNITURE.test(label)) return false;
  if (BORING_PAGE.test(label)) return false;
  if (LOCATION_LIKE.test(label)) return false;
  if (classifyCommercialLanguage(label) !== null) return false;
  if (significantTokens(label).length === 0) return false;
  return true;
}

/**
 * Is this URL worth reading a suggestion out of at all?
 *
 * A long, SEO-written slug can carry a service word AND still be the About
 * page: /about-drainworks-toronto-plumbers-drain-cleaning is a real URL, and
 * taking the service word at face value suggests "About" as something the
 * business sells.
 */
function usableUrl(url: string): boolean {
  if (DOCUMENT_URL.test(new URL(url, "https://client-growth.invalid/").pathname)) return false;
  return !isArchivePath(url) && !slugSaysNonService(url);
}

/**
 * Should the URL be used to name this suggestion instead of the words on the
 * page?
 *
 * ONLY when the words carry no information — a generic call to action, or no
 * anchor text at all. This distinction matters more than it looks: if the
 * fallback also fired for labels rejected on their CONTENT, the URL would
 * quietly resurrect them. "How much is a drain repair?" would come back as
 * "How Much Is A Drain Repair", and "Pool Removal in Charleswood" as "Pool
 * Removal Charleswood" — both stripped of the very thing that disqualified
 * them.
 */
function preferUrlOverLabel(written: string): boolean {
  return written.length === 0 || FURNITURE.test(written);
}

/**
 * Pick the name for a suggestion, or null when this link should be skipped.
 *
 * Returning null is the important case: a label that is real text and is not a
 * service is a decision, not a gap to be filled from somewhere else.
 */
function nameFor(written: string, url: string): string | null {
  if (preferUrlOverLabel(written)) {
    const fromUrl = labelFromUrl(url);
    return usableLabel(fromUrl) ? fromUrl : null;
  }
  return usableLabel(written) ? written : null;
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
    if (isServiceHub(page.url) || !usableUrl(page.url)) continue;
    if (!isInServiceSection(page.url) && !hasServiceWordInSlug(page.url)) continue;
    // A page's own H1 is what it calls itself; its <title> usually carries the
    // brand as well, so the part before the first separator is the useful half.
    const written =
      cleanLabel(page.h1s[0] ?? "") || cleanLabel(page.title.split(/\s+[|–—·]\s+/)[0] ?? "");
    const label = nameFor(written, page.url);
    if (label === null) continue;
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
    if (pathSegments(link.href).length === 0) continue;
    if (isServiceHub(link.href) || !usableUrl(link.href)) continue;

    // Prefer the words a person wrote; fall back to the URL only when those
    // words are a generic call to action.
    const written = cleanLabel(link.label || link.ariaLabel || link.title);
    const label = nameFor(written, link.href);
    if (label === null) continue;

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
    if (isServiceHub(url) || !usableUrl(url)) continue;
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
