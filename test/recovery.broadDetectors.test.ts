import { describe, expect, it } from "vitest";
import { runDiagnosticRun } from "@/core/rules/broadDetectors";
import type { Client, EvidenceBundle, Service } from "@/core/schema";

const client: Client = { id: "client-1", name: "Example", domain: "example.com", offerings: [], notes: "" };
const catalog: Service[] = [{ id: "service-1", name: "Site work", description: "Website work", priceMin: 1, priceMax: 2, tags: ["landing-page"], active: true }];

describe("production broad detector recovery", () => {
  it("retains a bounded placeholder finding and accounting when rich evidence is present", async () => {
    const evidence: EvidenceBundle = {
      clientId: client.id,
      source: "fixture",
      capturedAt: "2026-09-19T00:00:00.000Z",
      site: {
        pages: [{ url: "https://example.com/", status: 200, title: "Example", h1s: ["Example"], headings: [], textExcerpt: "I'm a paragraph. Click here to add your own text for the business.", wordCount: 40, forms: [], images: [] }],
        nav: [],
        links: [],
        sitemapUrls: [],
        crawlExhaustive: true,
      },
      networkEvents: [],
    };

    const result = await runDiagnosticRun({ client, catalog, evidence });
    expect(result.drafts.some((draft) => draft.problemType === "placeholder_production_content")).toBe(true);
    expect(result.accounting.detectors.some((detector) => detector.detectorId === "broad-placeholder")).toBe(true);
  });
});
