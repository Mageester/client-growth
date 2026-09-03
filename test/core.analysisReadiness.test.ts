import { describe, expect, it } from "vitest";

import { assessAnalysisReadiness } from "@/core/analysisReadiness";
import { ServiceSchema, type Service } from "@/core/schema";

/**
 * Readiness is per rule, and that is the whole point of it.
 *
 * The failure it replaces: a client with one offering was told, before every
 * run, that an analysis probably could not check anything — when in fact
 * broken-conversion-path was perfectly able to run and had nothing to do with
 * the offerings list. The second failure it replaces: telling an agency to add
 * offerings when the real limit was that the site would not load, so they did
 * the work and the next run failed identically.
 */

function service(tag: string, active = true): Service {
  return ServiceSchema.parse({
    id: `svc-${tag}`,
    name: tag,
    description: "",
    priceMin: 500,
    priceMax: 1500,
    tags: [tag],
    active,
  });
}

const fullCatalog = [service("landing-page"), service("conversion-fix")];

const ruleOf = (
  readiness: ReturnType<typeof assessAnalysisReadiness>,
  ruleId: string,
) => readiness.rules.find((r) => r.ruleId === ruleId)!;

describe("per-rule readiness", () => {
  it("is ready when the catalog matches, offerings exist, and the last crawl reached the services", () => {
    const readiness = assessAnalysisReadiness({
      catalog: fullCatalog,
      offerings: 4,
      lastCrawl: { analyzable: true, readablePages: 8, suggestedOfferings: 0 },
    });

    expect(readiness.state).toBe("ready");
    expect(readiness.readyCount).toBe(readiness.total);
  });

  it("does not let a thin offerings list block conversion-path analysis", () => {
    const readiness = assessAnalysisReadiness({ catalog: fullCatalog, offerings: 1 });

    expect(ruleOf(readiness, "missing-service-page").state).toBe("needs_client_setup");
    expect(ruleOf(readiness, "broken-conversion-path").state).toBe("ready");
    // The overall state is the best any rule can manage, so the run is still
    // worth starting.
    expect(readiness.state).toBe("ready");
  });

  it("does not warn about a thin profile when the last crawl reached the services anyway", () => {
    // getaxiom.ca sells one thing and its crawl reaches /services fine. Warning
    // about the offering count there is noise.
    const readiness = assessAnalysisReadiness({
      catalog: fullCatalog,
      offerings: 1,
      lastCrawl: { analyzable: true, readablePages: 9, suggestedOfferings: 3 },
    });

    expect(ruleOf(readiness, "missing-service-page").state).toBe("ready");
  });

  it("says the crawler is the limit when the crawler is the limit, and offers no false fix", () => {
    const readiness = assessAnalysisReadiness({
      catalog: fullCatalog,
      offerings: 6,
      lastCrawl: { analyzable: false, readablePages: 0, suggestedOfferings: 0 },
    });

    const missingPage = ruleOf(readiness, "missing-service-page");
    expect(missingPage.state).toBe("site_coverage_limited");
    // Nothing the agency can do about it, and the copy must not pretend there is.
    expect(missingPage.actionable).toBe(false);
    expect(missingPage.reason).toMatch(/crawler, not of the client/i);

    // A site that returned nothing readable also stops conversion-path work.
    expect(ruleOf(readiness, "broken-conversion-path").state).toBe("site_coverage_limited");
  });

  it("points at setup when the site was read but the profile is what is missing", () => {
    const readiness = assessAnalysisReadiness({
      catalog: fullCatalog,
      offerings: 1,
      lastCrawl: { analyzable: false, readablePages: 7, suggestedOfferings: 5 },
    });

    const missingPage = ruleOf(readiness, "missing-service-page");
    expect(missingPage.state).toBe("needs_client_setup");
    expect(missingPage.actionable).toBe(true);
    expect(missingPage.reason).toMatch(/5 more/);
  });

  it("offers the suggestion path when coverage failed and the site has services to confirm", () => {
    const readiness = assessAnalysisReadiness({
      catalog: fullCatalog,
      offerings: 3,
      lastCrawl: { analyzable: false, readablePages: 7, suggestedOfferings: 4 },
    });

    const missingPage = ruleOf(readiness, "missing-service-page");
    expect(missingPage.state).toBe("site_coverage_limited");
    expect(missingPage.actionable).toBe(true);
    expect(missingPage.reason).toMatch(/4 services/);
  });

  it("reports no client and no crawl as a setup problem, not a crawler one", () => {
    const readiness = assessAnalysisReadiness({ catalog: fullCatalog, offerings: 0 });

    expect(ruleOf(readiness, "missing-service-page").state).toBe("needs_client_setup");
    expect(ruleOf(readiness, "missing-service-page").actionable).toBe(true);
  });
});

describe("catalog gates every rule", () => {
  it("marks a rule not ready when no active service is offered for its gap", () => {
    const readiness = assessAnalysisReadiness({
      catalog: [service("landing-page")],
      offerings: 4,
      lastCrawl: { analyzable: true, readablePages: 8, suggestedOfferings: 0 },
    });

    expect(ruleOf(readiness, "missing-service-page").state).toBe("ready");
    const conversion = ruleOf(readiness, "broken-conversion-path");
    expect(conversion.state).toBe("not_ready");
    expect(conversion.actionable).toBe(true);
  });

  it("marks a rule not ready when its only service has been deactivated", () => {
    const readiness = assessAnalysisReadiness({
      catalog: [service("landing-page", false), service("conversion-fix")],
      offerings: 4,
      lastCrawl: { analyzable: true, readablePages: 8, suggestedOfferings: 0 },
    });

    expect(ruleOf(readiness, "missing-service-page").state).toBe("not_ready");
  });

  it("is not ready at all when nothing in the catalog answers any gap", () => {
    const readiness = assessAnalysisReadiness({ catalog: [service("seo")], offerings: 4 });

    expect(readiness.state).toBe("not_ready");
    expect(readiness.readyCount).toBe(0);
    expect(readiness.catalog.matched).toBe(0);
  });
});
