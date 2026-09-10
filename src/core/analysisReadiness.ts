import type { RuleId, Service } from "@/core/schema";
import { assessCatalogCoverage, type CatalogCoverage } from "@/core/rules/registry";

/**
 * What an analysis would actually be able to check, worked out BEFORE the
 * agency spends a run finding out.
 *
 * The readiness question used to be answered once, for the whole run, and that
 * conflated two unrelated things. Whether the crawl can reach a site's service
 * pages decides whether missing-service-page can claim anything; it has no
 * bearing at all on broken-conversion-path, whose evidence is a probed defect
 * on a page that was read. A client with one offering was being warned as
 * though nothing could be checked, when in fact half the engine was ready.
 *
 * So readiness is per rule. The overall state is the best any rule can manage,
 * and the reasons say which rule is limited and why — a distinction that also
 * decides which of two very different sentences the client page shows:
 *
 *   "We found services on this site that aren't in this client's profile."
 *     — the agency can fix this in thirty seconds.
 *
 *   "The crawler could not read this site."
 *     — the agency cannot fix this, and pretending otherwise wastes their time.
 */

export const READINESS_STATES = [
  "ready",
  "needs_client_setup",
  "site_coverage_limited",
  "not_ready",
] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

export interface RuleReadiness {
  ruleId: RuleId;
  /** What the agency owner calls this kind of gap. */
  label: string;
  state: ReadinessState;
  /** One sentence explaining the state, in the agency's language. */
  reason: string;
  /** Whether the agency can change this themselves. */
  actionable: boolean;
}

export interface AnalysisReadiness {
  /** The best state any single rule can manage. */
  state: ReadinessState;
  rules: RuleReadiness[];
  catalog: CatalogCoverage;
  /** Rules that could produce a finding right now. */
  readyCount: number;
  total: number;
}

export interface ReadinessInput {
  catalog: Service[];
  /** How many offerings the agency has recorded for this client. */
  offerings: number;
  /**
   * What the last completed crawl managed. Absent when the client has never
   * been analyzed — an unknown site is not a limited one, so it is not reported
   * as one.
   */
  lastCrawl?: {
    /** Did the last run demonstrably reach the site's service pages? */
    analyzable: boolean;
    /** Did the last run read any page at all? */
    readablePages: number;
    /** Offerings the last crawl's evidence would suggest adding. */
    suggestedOfferings: number;
    /**
     * When the last crawl failed to reach the services: was that the site or
     * the crawl? A site with no service pages cannot be fixed by anyone, and
     * saying "the crawler could not read far enough" about a site the crawler
     * read completely is simply untrue.
     */
    limitation?: "site-too-thin" | "coverage-limited" | null;
  };
}

const MIN_OFFERINGS_FOR_COVERAGE = 2;

function missingServicePageReadiness(input: ReadinessInput): {
  state: ReadinessState;
  reason: string;
  actionable: boolean;
} {
  const crawl = input.lastCrawl;

  // Order matters here, and getting it wrong is the exact mistake this module
  // exists to stop. A site that returned nothing readable cannot be fixed by
  // adding offerings, so the crawler limit is reported FIRST — otherwise a
  // client with one offering behind a 403 is told to go and do work that will
  // change nothing.
  if (crawl && !crawl.analyzable) {
    if (crawl.readablePages === 0) {
      return {
        state: "site_coverage_limited",
        reason:
          "The last run could not read any page on this site, so there is nothing for a missing-page check to work from. This is a limit of the crawler, not of the client's setup.",
        actionable: false,
      };
    }

    if (crawl.limitation === "site-too-thin") {
      return {
        state: "site_coverage_limited",
        reason:
          "This site has no pages describing what the business sells — the last run followed every link on it. A missing service page cannot be claimed against a site that describes no services, and adding offerings will not change that.",
        actionable: false,
      };
    }

    return {
      state: "site_coverage_limited",
      reason:
        "The last run read part of this site but did not reach enough of its service structure to check for missing pages. This needs website evidence, not more entries in the client profile.",
      actionable: false,
    };
  }

  if (input.offerings === 0) {
    return {
      state: "needs_client_setup",
      reason:
        "This client has no offerings recorded, so there is nothing to check the site against.",
      actionable: true,
    };
  }

  // A thin profile is only a problem worth raising if it is actually going to
  // stop the run. When the last crawl reached the service section anyway, it
  // is not.
  if (input.offerings < MIN_OFFERINGS_FOR_COVERAGE && !crawl?.analyzable) {
    return {
      state: "needs_client_setup",
      reason:
        "Only one offering is recorded. Axiom Orbit will not claim a service page is missing unless the crawl can confirm it reached the site's service section, which usually needs two or more.",
      actionable: true,
    };
  }

  return {
    state: "ready",
    reason: "Enough offerings are recorded, and the last crawl reached the site's service pages.",
    actionable: false,
  };
}

function brokenConversionPathReadiness(input: ReadinessInput): {
  state: ReadinessState;
  reason: string;
  actionable: boolean;
} {
  // This rule needs no offerings and no service-section coverage. Its evidence
  // is a call-to-action on a page that was read, probed and found broken. The
  // only thing that stops it is a site that cannot be read at all.
  if (input.lastCrawl && input.lastCrawl.readablePages === 0) {
    return {
      state: "site_coverage_limited",
      reason:
        "The last run could not read any page on this site, so no call-to-action could be checked.",
      actionable: false,
    };
  }
  return {
    state: "ready",
    reason:
      "Broken calls-to-action are checked on whatever pages the crawl reads; this needs no client setup.",
    actionable: false,
  };
}

function noServicePagesReadiness(input: ReadinessInput): {
  state: ReadinessState;
  reason: string;
  actionable: boolean;
} {
  // The claim is "we read every page and none of them sells anything", which a
  // site that returned nothing readable cannot support.
  if (input.lastCrawl && input.lastCrawl.readablePages === 0) {
    return {
      state: "site_coverage_limited",
      reason:
        "The last run could not read any page on this site, so it cannot be said that the site describes no services.",
      actionable: false,
    };
  }

  if (input.lastCrawl?.limitation === "coverage-limited") {
    return {
      state: "site_coverage_limited",
      reason:
        "The last run did not read enough of this site to say that it describes no services.",
      actionable: false,
    };
  }

  // The finding names what the site should have been describing, so without a
  // recorded offering it could be stated but not written.
  if (input.offerings === 0) {
    return {
      state: "needs_client_setup",
      reason:
        "This client has no offerings recorded, so there is nothing to say the site should be describing.",
      actionable: true,
    };
  }

  return {
    state: "ready",
    reason:
      "Checked whenever the crawl reads a whole site and finds nothing on it describing a service.",
    actionable: false,
  };
}

/** The best state any rule can manage. */
function bestState(states: ReadinessState[]): ReadinessState {
  if (states.includes("ready")) return "ready";
  if (states.includes("needs_client_setup")) return "needs_client_setup";
  if (states.includes("site_coverage_limited")) return "site_coverage_limited";
  return "not_ready";
}

export function assessAnalysisReadiness(input: ReadinessInput): AnalysisReadiness {
  const catalog = assessCatalogCoverage(input.catalog);

  const rules: RuleReadiness[] = catalog.rules.map((rule) => {
    // A rule with no active service offered for its kind of gap cannot produce
    // a finding at all, whatever the site looks like. That outranks everything
    // else, because every finding is priced from something the agency sells.
    if (rule.serviceId === null) {
      return {
        ruleId: rule.ruleId,
        label: rule.label,
        state: "not_ready" as const,
        reason: `No active service in your catalog is offered for ${rule.label.toLowerCase()}, so this cannot be checked.`,
        actionable: true,
      };
    }

    const assessed =
      rule.ruleId === "missing-service-page"
        ? missingServicePageReadiness(input)
        : rule.ruleId === "no-service-pages"
          ? noServicePagesReadiness(input)
          : brokenConversionPathReadiness(input);

    return { ruleId: rule.ruleId, label: rule.label, ...assessed };
  });

  return {
    state: bestState(rules.map((r) => r.state)),
    rules,
    catalog,
    readyCount: rules.filter((r) => r.state === "ready").length,
    total: rules.length,
  };
}

/**
 * Is a run worth starting at all?
 *
 * Yes when the catalog can price at least one kind of gap AND at least one rule
 * is ready to look for it. This is the single admission authority: the client
 * page, the onboarding confirmation and the crafted-post guards all ask this
 * one question, so a disabled button and a refused POST can never disagree.
 *
 * What it deliberately does NOT do is consult service-page coverage as a global
 * verdict. That was the audit's defect: a site the crawler had read from end to
 * end was refused analysis because ONE rule — missing-service-page — could not
 * name a page as missing from it. A limited rule suppresses itself. It has no
 * authority over the rules beside it, and the pipeline still fails each rule
 * closed on its own evidence, so admitting the run cannot manufacture a claim.
 */
export function canRunAnalysis(readiness: {
  catalog: { matched: number };
  readyCount: number;
}): boolean {
  return readiness.catalog.matched > 0 && readiness.readyCount > 0;
}

const NO_CATALOG_REFUSAL =
  "No active service is offered for a kind of website gap, so an analysis could not check anything. Set that up in your catalog first.";

/**
 * Why the run cannot start, in the agency's own language — or null when it can.
 *
 * The sentence is taken from the rule that is actually blocked rather than
 * written afresh, so the refusal a POST receives is the same explanation the
 * page was already showing. Reporting "we could not read enough of the website"
 * about a site that returned nothing at all is the untruth this replaces.
 */
export function analysisAdmissionRefusal(readiness: {
  catalog: { matched: number };
  readyCount: number;
  // Structural on purpose: the same answer has to be reachable from a route
  // loader's JSON-crossed copy of a readiness result, not just the domain type.
  rules: ReadonlyArray<{ state: ReadinessState; reason: string }>;
}): string | null {
  if (canRunAnalysis(readiness)) return null;
  if (readiness.catalog.matched === 0) return NO_CATALOG_REFUSAL;

  const limited = readiness.rules.filter(
    (rule) => rule.state !== "ready" && rule.state !== "not_ready",
  );
  // The crawler's limits outrank the client's setup: telling someone to add
  // offerings when the site would not load sends them to do work that changes
  // nothing, which is the second failure this module was written for.
  const coverage = limited.find((rule) => rule.state === "site_coverage_limited");
  if (coverage) {
    return `${coverage.reason} No other check can run either, so there is nothing to analyze yet.`;
  }
  const setup = limited.find((rule) => rule.state === "needs_client_setup");
  if (setup) return `${setup.reason} No other check can run either, so there is nothing to analyze yet.`;

  return NO_CATALOG_REFUSAL;
}
