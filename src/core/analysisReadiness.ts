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
  if (input.offerings === 0) {
    return {
      state: "needs_client_setup",
      reason:
        "This client has no offerings recorded, so there is nothing to check the site against.",
      actionable: true,
    };
  }

  const crawl = input.lastCrawl;

  // Order matters here, and getting it wrong is the exact mistake this module
  // exists to stop. A site that returned nothing readable cannot be fixed by
  // adding offerings, so the crawler limit is reported FIRST — otherwise a
  // client with one offering behind a 403 is told to go and do work that will
  // change nothing.
  if (crawl && crawl.readablePages === 0) {
    return {
      state: "site_coverage_limited",
      reason:
        "The last run could not read any page on this site, so there is nothing for a missing-page check to work from. This is a limit of the crawler, not of the client's setup.",
      actionable: false,
    };
  }

  // A thin profile is only a problem worth raising if it is actually going to
  // stop the run. When the last crawl reached the service section anyway, it
  // is not.
  if (input.offerings < MIN_OFFERINGS_FOR_COVERAGE && !crawl?.analyzable) {
    return {
      state: "needs_client_setup",
      reason:
        crawl && crawl.suggestedOfferings > 0
          ? `Only one offering is recorded, and the last crawl found ${crawl.suggestedOfferings} more on the site that are not in this client's profile.`
          : "Only one offering is recorded. Axiom Orbit will not claim a service page is missing unless the crawl can confirm it reached the site's service section, which usually needs two or more.",
      actionable: true,
    };
  }

  if (crawl && !crawl.analyzable) {
    // The site itself has no service pages. Nobody can fix that: not the
    // agency by editing offerings, not us by crawling harder. Say so, and
    // offer no action, because every action offered here would be wasted work.
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
        crawl.suggestedOfferings > 0
          ? `The last run did not reach this site's service pages. It did find ${crawl.suggestedOfferings} service${crawl.suggestedOfferings === 1 ? "" : "s"} on the site that are not in this client's profile — confirming those would give the next run more to match against.`
          : "The last run did not reach this site's service pages, so a missing page cannot be claimed. This is a limit of what the crawler could read, not of the client's setup.",
      actionable: crawl.suggestedOfferings > 0,
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
