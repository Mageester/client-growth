import type { EvidenceBundle } from "@/core/schema";
import type { CatalogCoverage } from "@/core/rules/registry";

/**
 * The truthful result of one analysis run.
 *
 *   findings     — the site was read and billable work was surfaced
 *   clean        — the site was read successfully and nothing billable was found
 *   inconclusive — the site could not be read well enough to claim anything
 *
 * The distinction between `clean` and `inconclusive` is the product's core
 * honesty guarantee: the crawler fails closed, so a site that did not resolve,
 * was blocked by the URL policy, or was never demonstrably reached must never
 * be reported as "we looked and it is fine".
 */
export const ANALYSIS_OUTCOMES = ["findings", "clean", "inconclusive"] as const;
export type AnalysisOutcome = (typeof ANALYSIS_OUTCOMES)[number];

export interface EvidenceReach {
  /** Pages that returned a 2xx and produced readable content. */
  readablePages: number;
  /** Pages fetched at all, including error/empty ones. */
  fetchedPages: number;
  /** Network-policy refusals (SSRF guard, bad scheme, unsafe redirect). */
  blockedEvents: number;
  /** Transport/parse failures where absence cannot be inferred. */
  inconclusiveEvents: number;
}

/** How much of the site the crawl actually managed to read. */
export function measureEvidenceReach(evidence: EvidenceBundle): EvidenceReach {
  const readablePages = evidence.site.pages.filter(
    (page) => page.status >= 200 && page.status < 300 && page.wordCount > 0,
  ).length;
  return {
    readablePages,
    fetchedPages: evidence.site.pages.length,
    blockedEvents: evidence.networkEvents.filter((e) => e.outcome === "blocked").length,
    inconclusiveEvents: evidence.networkEvents.filter((e) => e.outcome === "inconclusive").length,
  };
}

export interface OutcomeInput {
  evidence: EvidenceBundle;
  /** Did the crawl demonstrably reach the site's service section? */
  analyzable: boolean;
  /** Why the coverage assessment concluded what it did. */
  coverageReason: string;
  /**
   * When coverage failed: was it the site or the crawl? These need opposite
   * sentences, and the wrong one sends an agency to fix something that is not
   * broken. Absent for callers that do not know, which keeps the old wording.
   */
  coverageLimitation?: "site-too-thin" | "coverage-limited" | null;
  /** Count of billable opportunities surfaced by this run. */
  surfaced: number;
  /** Evaluator invocations that threw. Failing closed hides real work. */
  evaluatorErrors: number;
  /** Which of today's rules the agency's catalog can actually reach. */
  catalog: CatalogCoverage;
}

export interface AnalysisOutcomeResult {
  outcome: AnalysisOutcome;
  /** One plain sentence a non-technical agency owner can act on. */
  summary: string;
  /** The specific limitation, when the run was inconclusive. */
  limitation: string | null;
  reach: EvidenceReach;
}

/**
 * Classify a completed run. Order matters: a surfaced finding is proof the site
 * was read, so it wins; otherwise any failure to read the site outranks silence.
 */
export function classifyAnalysis(input: OutcomeInput): AnalysisOutcomeResult {
  const reach = measureEvidenceReach(input.evidence);

  // Before anything about the website: could this catalog have produced a
  // finding at all? Every finding is priced from an active service that is
  // offered for that kind of gap, so with none the rules never run and the site
  // is never actually assessed. Calling that "clean" is the most misleading
  // thing the product could say, and it is exactly what a brand-new workspace
  // would have heard on its very first run.
  if (input.catalog.matched === 0) {
    return {
      outcome: "inconclusive",
      summary: "Nothing could be checked — no service in your catalog is offered for a website gap.",
      limitation:
        "Client Growth prices every finding from something you sell, so a service has to say which kind of gap it answers before a site can be assessed. Add or edit a service, set what it is offered for, then re-analyze.",
      reach,
    };
  }

  if (input.surfaced > 0) {
    return {
      outcome: "findings",
      summary:
        input.surfaced === 1
          ? "1 evidence-backed opportunity found."
          : `${input.surfaced} evidence-backed opportunities found.`,
      limitation: null,
      reach,
    };
  }

  if (reach.readablePages === 0) {
    const blocked = reach.blockedEvents > 0;
    return {
      outcome: "inconclusive",
      summary: blocked
        ? "The site could not be reached safely, so nothing was assessed."
        : "No readable pages were returned, so nothing was assessed.",
      limitation: blocked
        ? "Requests to this domain were refused by the network policy — the address did not resolve to a public host, used an unsupported scheme, or redirected somewhere unsafe."
        : reach.fetchedPages > 0
          ? "The site responded, but no page returned readable HTML content."
          : "No page on this domain could be fetched.",
      reach,
    };
  }

  if (!input.analyzable) {
    // "We looked everywhere and this business has no service pages" and "we
    // could not get far enough to tell" are the same silence with opposite
    // meanings. A site that is genuinely a four-page brochure is not a crawl
    // failure, and saying so invites the agency to go and fix their setup —
    // which will change nothing, because there is nothing on the site to match.
    const thin = input.coverageLimitation === "site-too-thin";
    return {
      outcome: "inconclusive",
      summary: thin
        ? "This site has no pages describing what the business sells, so no gap can be claimed."
        : "The crawl never reached this site's service pages, so no gap can be claimed.",
      limitation: thin
        ? `${input.coverageReason} Nothing in this client's setup would change that — the pages simply are not there. A missing-service-page finding needs a site that describes its services somewhere.`
        : input.coverageReason,
      reach,
    };
  }

  if (input.evaluatorErrors > 0) {
    return {
      outcome: "inconclusive",
      summary:
        input.evaluatorErrors === 1
          ? "1 candidate could not be assessed because the evaluator failed."
          : `${input.evaluatorErrors} candidates could not be assessed because the evaluator failed.`,
      limitation:
        "The opportunity evaluator was unreachable or returned unusable output. Candidates are dropped rather than guessed, so this run is incomplete.",
      reach,
    };
  }

  // "Clean" is a claim about what was checked, so anything that narrowed the
  // check has to travel with it. A partly-matched catalog silently skips a whole
  // rule; saying nothing would let the agency read "clean" as "fully checked".
  const limits: string[] = [];
  if (reach.inconclusiveEvents > 0) {
    limits.push(
      `${reach.inconclusiveEvents} ${reach.inconclusiveEvents === 1 ? "request" : "requests"} during this run could not be completed, so a small part of the site was not assessed.`,
    );
  }
  if (input.catalog.unmatchedLabels.length > 0) {
    limits.push(
      `Only ${input.catalog.matched} of ${input.catalog.total} kinds of gap were checked — no active service is offered for ${input.catalog.unmatchedLabels.map((l) => l.toLowerCase()).join(" or ")}.`,
    );
  }

  return {
    outcome: "clean",
    summary: `Read ${reach.readablePages} ${reach.readablePages === 1 ? "page" : "pages"} and found no unmet billable work.`,
    limitation: limits.length > 0 ? limits.join(" ") : null,
    reach,
  };
}
