import { describe, expect, it } from "vitest";

import { classifyAnalysis } from "@/core/analysisOutcome";
import { assessCatalogCoverage } from "@/core/rules/registry";
import { EvidenceBundleSchema, ServiceSchema } from "@/core/schema";

function evidence(networkEvents: unknown[]) {
  return EvidenceBundleSchema.parse({
    clientId: "client-a",
    source: "http",
    capturedAt: "2026-09-07T00:00:00.000Z",
    site: { pages: [], nav: [], links: [], sitemapUrls: [] },
    networkEvents,
  });
}

describe("evidence failure diagnostics", () => {
  it("turns a transport timeout into a useful retry explanation", () => {
    const result = classifyAnalysis({
      evidence: evidence([
        {
          url: "https://artfullyyou.ca/",
          outcome: "inconclusive",
          reason: "request timeout",
          code: "timeout",
          stage: "page",
        },
      ]),
      analyzable: false,
      coverageReason: "The site could not be read.",
      surfaced: 0,
      evaluatorErrors: 0,
      catalog: assessCatalogCoverage([
        ServiceSchema.parse({
          id: "svc-conversion",
          name: "Conversion work",
          description: "",
          priceMin: 100,
          priceMax: 200,
          tags: ["conversion-fix"],
          active: true,
        }),
      ]),
    });

    expect(result.limitation).toMatch(/did not respond to Orbit's request/i);
  });

  it("keeps the generic explanation when no specific failure was observed", () => {
    const result = classifyAnalysis({
      evidence: evidence([]),
      analyzable: false,
      coverageReason: "The site could not be read.",
      surfaced: 0,
      evaluatorErrors: 0,
      catalog: assessCatalogCoverage([
        ServiceSchema.parse({
          id: "svc-conversion",
          name: "Conversion work",
          description: "",
          priceMin: 100,
          priceMax: 200,
          tags: ["conversion-fix"],
          active: true,
        }),
      ]),
    });

    expect(result.limitation).toBe("No page on this domain could be fetched.");
  });
});
