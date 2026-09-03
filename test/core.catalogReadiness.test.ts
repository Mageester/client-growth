import { describe, expect, it } from "vitest";

import { classifyAnalysis } from "@/core/analysisOutcome";
import {
  RULE_SERVICE_LINKS,
  assessCatalogCoverage,
  serviceForRule,
} from "@/core/rules/registry";
import { analyzeClient } from "@/pipeline/analyzeClient";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import { allRules } from "@/core/rules";
import { ServiceSchema, type EvidenceBundle, type Service } from "@/core/schema";

import { BenchEvidenceProvider } from "./bench/site";
import { CASES, clientOf } from "./bench/cases";

/**
 * An analysis can only produce a finding when an active service says which kind
 * of website gap it answers, because every finding is priced from that service.
 *
 * With none, the rules never run and the site is never actually assessed — and
 * the run used to be reported as "read N pages and found no unmet billable
 * work", which is indistinguishable from a healthy site. That is the most
 * misleading thing the product could say, and it is exactly what a brand-new
 * workspace with an empty catalog would have heard on its first run.
 */

function service(overrides: Partial<Service> & { id: string }): Service {
  return ServiceSchema.parse({
    name: "Service",
    priceMin: 500,
    priceMax: 1500,
    tags: [],
    active: true,
    ...overrides,
  });
}

const PAGES = [
  {
    url: "https://a.example/",
    status: 200,
    title: "Home",
    h1s: [],
    headings: [],
    textExcerpt: "",
    wordCount: 400,
    forms: [],
  },
];

function bundle(): EvidenceBundle {
  return {
    clientId: "c1",
    source: "http",
    capturedAt: "2026-09-02T00:00:00.000Z",
    site: { pages: PAGES, nav: [], links: [], sitemapUrls: [], crawlExhaustive: false },
    networkEvents: [],
  };
}

describe("rule/service registry", () => {
  it("covers every rule the pipeline actually runs", () => {
    expect(RULE_SERVICE_LINKS).toHaveLength(allRules.length);
  });

  it("only matches an ACTIVE service", () => {
    const inactive = [service({ id: "s1", tags: ["landing-page"], active: false })];
    expect(serviceForRule(inactive, "landing-page")).toBeNull();

    const active = [service({ id: "s2", tags: ["landing-page"] })];
    expect(serviceForRule(active, "landing-page")?.id).toBe("s2");
  });

  it("reports which kinds of gap a catalog cannot reach", () => {
    const partial = assessCatalogCoverage([service({ id: "s1", tags: ["landing-page"] })]);
    expect(partial.matched).toBe(1);
    expect(partial.total).toBe(2);
    expect(partial.unmatchedLabels).toEqual(["A broken conversion path"]);

    const none = assessCatalogCoverage([service({ id: "s1", tags: ["seo", "retainer"] })]);
    expect(none.matched).toBe(0);
    expect(none.unmatchedLabels).toHaveLength(2);
  });
});

describe("analysis outcome with an unusable catalog", () => {
  it("is inconclusive, not clean, when nothing in the catalog can be matched", () => {
    const result = classifyAnalysis({
      evidence: bundle(),
      analyzable: true,
      coverageReason: "Service coverage confirmed.",
      surfaced: 0,
      evaluatorErrors: 0,
      catalog: assessCatalogCoverage([]),
    });

    expect(result.outcome).toBe("inconclusive");
    expect(result.summary).toMatch(/no service in your catalog/i);
    expect(result.summary).not.toMatch(/found no unmet billable work/i);
    expect(result.limitation).toMatch(/offered for/i);
  });

  it("outranks a readable site, because the catalog is the precondition", () => {
    // The site read fine. That is not the reason nothing was found.
    const result = classifyAnalysis({
      evidence: bundle(),
      analyzable: true,
      coverageReason: "Service coverage confirmed.",
      surfaced: 0,
      evaluatorErrors: 0,
      catalog: assessCatalogCoverage([service({ id: "s1", tags: ["brand"] })]),
    });
    expect(result.outcome).toBe("inconclusive");
    expect(result.reach.readablePages).toBe(1);
  });

  it("says which kind of gap was skipped when a clean run only checked some", () => {
    const result = classifyAnalysis({
      evidence: bundle(),
      analyzable: true,
      coverageReason: "Service coverage confirmed.",
      surfaced: 0,
      evaluatorErrors: 0,
      catalog: assessCatalogCoverage([service({ id: "s1", tags: ["landing-page"] })]),
    });

    expect(result.outcome).toBe("clean");
    expect(result.limitation).toMatch(/1 of 2 kinds of gap/i);
    expect(result.limitation).toMatch(/a broken conversion path/i);
  });

  it("leaves a fully-matched clean run with nothing to caveat", () => {
    const result = classifyAnalysis({
      evidence: bundle(),
      analyzable: true,
      coverageReason: "Service coverage confirmed.",
      surfaced: 0,
      evaluatorErrors: 0,
      catalog: assessCatalogCoverage([
        service({ id: "s1", tags: ["landing-page"] }),
        service({ id: "s2", tags: ["conversion-fix"] }),
      ]),
    });

    expect(result.outcome).toBe("clean");
    expect(result.limitation).toBeNull();
  });
});

describe("pipeline with an empty catalog", () => {
  it("runs no rule, spends nothing, and reports the run as inconclusive", async () => {
    // A site that would otherwise produce a finding, analyzed by an agency that
    // has not said what it sells.
    const testCase = CASES.find((c) => c.id === "broken-cta-404")!;
    const client = clientOf(testCase);
    const provider = new BenchEvidenceProvider(client.id, testCase.site);

    const result = await analyzeClient({
      client,
      catalog: [],
      coverage: [],
      evidenceProvider: provider,
      evaluator: new MockEvaluator(),
      now: new Date("2026-09-02T00:00:00.000Z"),
    });

    expect(result.stats.candidates).toBe(0);
    expect(result.stats.aiCalls).toBe(0);
    expect(provider.probes).toHaveLength(0);
    expect(result.catalogCoverage.matched).toBe(0);

    const verdict = classifyAnalysis({
      evidence: result.evidence,
      analyzable: result.coverage.analyzable,
      coverageReason: result.coverage.reason,
      surfaced: 0,
      evaluatorErrors: 0,
      catalog: result.catalogCoverage,
    });
    expect(verdict.outcome).toBe("inconclusive");
  });

  it("still finds the conversion defect when only that rule is reachable", async () => {
    const testCase = CASES.find((c) => c.id === "broken-cta-404")!;
    const client = clientOf(testCase);

    const result = await analyzeClient({
      client,
      catalog: [
        service({ id: "svc-fix", name: "Fix", priceMin: 300, priceMax: 1000, tags: ["conversion-fix"] }),
      ],
      coverage: [],
      evidenceProvider: new BenchEvidenceProvider(client.id, testCase.site),
      evaluator: new MockEvaluator(),
      now: new Date("2026-09-02T00:00:00.000Z"),
    });

    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]!.ruleId).toBe("broken-conversion-path");
    expect(result.catalogCoverage.matched).toBe(1);
  });
});
