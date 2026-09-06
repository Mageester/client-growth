import type { EvidenceBundle } from "@/core/schema";
import { significantTokens } from "@/core/text";
import { suggestOfferings, type SuggestedOffering } from "@/core/offeringSuggestions";

/**
 * What the client's competitors sell pages for, and the client does not.
 *
 * This is the first rule in the product that looks outside the client's own
 * website, and it exists because of a measurement: across 24 real sites the
 * engine produced four commercially sellable findings. Roughly one per six
 * clients. Everything derivable from a single site had been derived, and the
 * remaining silence was not a bug — a tidy small-business website simply does
 * not contain many more billable observations.
 *
 * A competitor's website does. "All three of your competitors have a page for
 * emergency callouts and you have none" is a different KIND of claim: it is
 * evidence about a market rather than about a document, it is the argument an
 * agency actually makes on a call, and it renews itself every time a competitor
 * publishes something. It is also the one thing a generic SEO crawler cannot
 * frame this way, because it requires knowing what the businesses SELL.
 *
 * The honesty rules that govern the rest of the engine apply here unchanged:
 *
 *  - **Two competitors, not one.** One competitor having a page is noise; a
 *    second one makes it a pattern. A single site is never enough to tell an
 *    agency their client is behind.
 *  - **An unreadable competitor is not an absent one.** A competitor whose
 *    crawl failed is excluded from the count entirely, never scored as "does
 *    not have it", and the caller is told how many were actually readable.
 *  - **The client having it settles it.** A gap is only a gap when the client's
 *    own recorded offerings and crawled pages both fail to name the service.
 *
 * Pure: no crawling, no database, no clock.
 */

/** One competitor's site, already crawled by the caller. */
export interface CompetitorSite {
  domain: string;
  /** Null when the crawl could not read the site well enough to judge. */
  evidence: EvidenceBundle | null;
}

export interface CompetitorGap {
  /** The service, in the competitors' own words. */
  label: string;
  /** Domains that have a page for it. Always at least `minCompetitors`. */
  competitorDomains: string[];
  /** The strongest URL found for it, for the agency to click. */
  exampleUrl?: string;
}

export interface CompetitorGapInput {
  clientOfferings: string[];
  /** The client's own crawl. Null when it could not be read. */
  clientEvidence: EvidenceBundle | null;
  competitors: readonly CompetitorSite[];
  /** How many competitors must have the service. Default 2. */
  minCompetitors?: number;
  /** Cap on gaps returned. Default 5. */
  max?: number;
}

export interface CompetitorGapResult {
  gaps: CompetitorGap[];
  /** Competitors whose crawl produced usable evidence. */
  readableCompetitors: string[];
  /** Competitors that could not be read; excluded from every count. */
  unreadableCompetitors: string[];
  /**
   * Set when no claim can be made at all — too few readable competitors, or an
   * unreadable client. The caller must surface this instead of "no gaps found",
   * which would read as "your client is level with the market".
   */
  limitation?: string;
}

export const DEFAULT_MIN_COMPETITORS = 2;

/**
 * Three competitors per client.
 *
 * A cost ceiling before it is a product decision: each comparison crawls every
 * competitor in full, so this multiplies the outbound request volume of the
 * most expensive action in the app. Two is the minimum for a gap to be a
 * pattern at all, and three leaves one spare for a site that cannot be read.
 *
 * Lives in this pure module rather than in the repository so route components
 * can render against it without importing database code.
 */
export const MAX_COMPETITORS_PER_CLIENT = 3;

/** A comparison key that tolerates plural and word-order differences. */
function serviceKey(label: string): string {
  return significantTokens(label).sort().join(" ");
}

/** Everything the client is already known to offer or to have a page about. */
function clientVocabulary(input: CompetitorGapInput): Set<string> {
  const keys = new Set<string>();
  for (const offering of input.clientOfferings) {
    const key = serviceKey(offering);
    if (key) keys.add(key);
  }
  if (input.clientEvidence) {
    // The client's own site is read with the same extractor used on the
    // competitors, so "has a page for it" means the same thing on both sides.
    for (const own of suggestOfferings({
      evidence: input.clientEvidence,
      existingOfferings: [],
      max: 40,
    })) {
      const key = serviceKey(own.label);
      if (key) keys.add(key);
    }
  }
  return keys;
}

/**
 * True when the client already covers this service.
 *
 * Token-subset rather than exact match, in both directions: a client offering
 * "emergency plumbing" covers a competitor's "emergency plumbing service", and
 * a client offering "drain cleaning and unblocking" covers "drain cleaning".
 * Being generous here is deliberate — the cost of a missed gap is silence, and
 * the cost of a false gap is an agency telling a client they are behind when
 * they are not.
 */
function clientAlreadyCovers(candidate: string, vocabulary: Set<string>): boolean {
  const tokens = new Set(significantTokens(candidate));
  if (tokens.size === 0) return true;
  for (const known of vocabulary) {
    const knownTokens = new Set(known.split(" ").filter(Boolean));
    if (knownTokens.size === 0) continue;
    const smaller = tokens.size <= knownTokens.size ? tokens : knownTokens;
    const larger = tokens.size <= knownTokens.size ? knownTokens : tokens;
    let shared = 0;
    for (const token of smaller) if (larger.has(token)) shared += 1;
    if (shared === smaller.size) return true;
  }
  return false;
}

interface Tally {
  label: string;
  domains: Set<string>;
  exampleUrl?: string;
}

function bestUrl(offering: SuggestedOffering): string | undefined {
  return offering.evidence.find((item) => item.url)?.url;
}

export function findCompetitorGaps(input: CompetitorGapInput): CompetitorGapResult {
  const minCompetitors = input.minCompetitors ?? DEFAULT_MIN_COMPETITORS;
  const max = input.max ?? 5;

  const readable = input.competitors.filter((competitor) => competitor.evidence !== null);
  const unreadable = input.competitors.filter((competitor) => competitor.evidence === null);
  const readableCompetitors = readable.map((competitor) => competitor.domain);
  const unreadableCompetitors = unreadable.map((competitor) => competitor.domain);

  if (readable.length < minCompetitors) {
    return {
      gaps: [],
      readableCompetitors,
      unreadableCompetitors,
      limitation:
        `Only ${readable.length} of ${input.competitors.length} competitor sites could be read, ` +
        `and a gap needs ${minCompetitors} to be a pattern rather than one site's choice. ` +
        `No comparison is being claimed.`,
    };
  }

  if (!input.clientEvidence) {
    return {
      gaps: [],
      readableCompetitors,
      unreadableCompetitors,
      limitation:
        "The client's own site could not be read, so there is nothing to compare the " +
        "competitors against. This is not a finding that the client is up to date.",
    };
  }

  const vocabulary = clientVocabulary(input);
  const tallies = new Map<string, Tally>();

  for (const competitor of readable) {
    const evidence = competitor.evidence;
    if (!evidence) continue;
    const services = suggestOfferings({ evidence, existingOfferings: [], max: 40 });
    // One competitor counts once per service, however many pages they have
    // about it — otherwise a site with a deep section outvotes the pattern.
    const seen = new Set<string>();
    for (const service of services) {
      const key = serviceKey(service.label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (clientAlreadyCovers(service.label, vocabulary)) continue;

      const tally = tallies.get(key);
      if (tally) {
        tally.domains.add(competitor.domain);
        tally.exampleUrl = tally.exampleUrl ?? bestUrl(service);
      } else {
        tallies.set(key, {
          label: service.label,
          domains: new Set([competitor.domain]),
          exampleUrl: bestUrl(service),
        });
      }
    }
  }

  const gaps = [...tallies.values()]
    .filter((tally) => tally.domains.size >= minCompetitors)
    .sort((a, b) => b.domains.size - a.domains.size || a.label.localeCompare(b.label))
    .slice(0, max)
    .map<CompetitorGap>((tally) => ({
      label: tally.label,
      competitorDomains: [...tally.domains].sort(),
      ...(tally.exampleUrl ? { exampleUrl: tally.exampleUrl } : {}),
    }));

  return { gaps, readableCompetitors, unreadableCompetitors };
}
