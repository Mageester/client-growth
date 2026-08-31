import { describe, expect, it, vi } from "vitest";

import { analyzeClient } from "@/pipeline/analyzeClient";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import type { EvidenceProvider, ProbeResult } from "@/ports/EvidenceProvider";
import {
  ClientSchema,
  CoverageSchema,
  EvidenceBundleSchema,
  ServiceSchema,
  type Coverage,
} from "@/core/schema";

const NOW = new Date("2026-08-31T00:00:00.000Z");

const CATALOG = [
  ServiceSchema.parse({
    id: "svc-landing-page",
    name: "Service Landing Page",
    description: "",
    priceMin: 900,
    priceMax: 1800,
    tags: ["landing-page"],
    active: true,
  }),
  ServiceSchema.parse({
    id: "svc-conversion-fix",
    name: "Conversion Path Fix",
    description: "Diagnose and repair a broken conversion element.",
    priceMin: 300,
    priceMax: 900,
    tags: ["conversion-fix"],
    active: true,
  }),
];

const client = ClientSchema.parse({
  id: "acme",
  name: "Acme HVAC",
  domain: "acme.example",
  // an offering that is NOT represented anywhere on the (About-only) crawl
  offerings: ["ceramic coating"],
});

// Evidence: no service pages reached (About-only), plus one dead quote CTA.
const evidence = EvidenceBundleSchema.parse({
  clientId: "acme",
  source: "http",
  capturedAt: NOW.toISOString(),
  site: {
    pages: [
      { url: "https://acme.example/", status: 200, title: "Acme HVAC", h1s: [], headings: [], textExcerpt: "", wordCount: 100, forms: [] },
      { url: "https://acme.example/about", status: 200, title: "About Us", h1s: [], headings: [], textExcerpt: "", wordCount: 80, forms: [] },
    ],
    nav: ["Home", "About", "Contact"],
    links: [
      {
        href: "https://acme.example/get-a-quote",
        label: "Get a Free Quote",
        ariaLabel: "",
        title: "",
        scheme: "http",
        inNav: true,
        foundOn: ["https://acme.example/"],
      },
    ],
    sitemapUrls: [],
  },
});

const provider: EvidenceProvider = {
  getEvidence: () => Promise.resolve(evidence),
  probe: (url: string): Promise<ProbeResult> =>
    Promise.resolve({
      requestedUrl: url,
      status: url.endsWith("/get-a-quote") ? 404 : 200,
      finalUrl: url,
      ok: !url.endsWith("/get-a-quote"),
    }),
};

function run(coverage: Coverage[] = []) {
  return analyzeClient({
    client,
    catalog: CATALOG,
    coverage,
    evidenceProvider: provider,
    evaluator: new MockEvaluator(),
    now: NOW,
  });
}

describe("pipeline: broken-conversion-path runs independent of the service-coverage gate", () => {
  it("service-coverage gate blocks missing-service-page but NOT broken-conversion-path", async () => {
    const result = await run();

    expect(result.coverage.analyzable).toBe(false);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]?.ruleId).toBe("broken-conversion-path");
    expect(result.opportunities.some((o) => o.ruleId === "missing-service-page")).toBe(false);
    expect(result.opportunities[0]?.conversionDefect?.kind).toBe("dead-conversion-link");
    expect(result.opportunities[0]?.suggestedServiceId).toBe("svc-conversion-fix");
    expect(result.opportunities[0]?.priceMin).toBe(300);
  });

  it("when conversion-fix is contractually covered, it is suppressed before any AI call", async () => {
    const evaluate = vi.spyOn(MockEvaluator.prototype, "evaluate");
    const covered = [
      CoverageSchema.parse({ clientId: "acme", serviceId: "svc-conversion-fix", covered: true }),
    ];
    const result = await run(covered);

    expect(result.opportunities).toHaveLength(0);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0]?.billableStatus).toBe("already_covered");
    expect(result.stats.suppressedByCoverage).toBe(1);
    expect(result.stats.aiCalls).toBe(0);
    expect(evaluate).not.toHaveBeenCalled();
    evaluate.mockRestore();
  });
});
