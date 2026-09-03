import { describe, expect, it } from "vitest";

import { noServicePagesRule } from "@/core/rules/noServicePages";
import type { RuleContext } from "@/core/rules/context";
import type { CoverageAssessment } from "@/core/absenceVerification";
import {
  ClientSchema,
  ServiceSchema,
  type Client,
  type EvidenceBundle,
  type Service,
} from "@/core/schema";

/**
 * no-service-pages exists because the strongest evidence the crawler ever holds
 * — "we followed every link on this site and none of it sells anything" — was
 * being reported as "we could not tell". These tests pin the one distinction
 * that makes the claim safe: an EXHAUSTIVE crawl that found nothing is a fact
 * about the site, a truncated one is a fact about the crawl.
 */

function client(offerings: string[]): Client {
  return ClientSchema.parse({
    id: "c1",
    name: "Northwind Heating",
    domain: "northwindheating.example",
    offerings,
    notes: "",
  });
}

function catalog(tags: string[] = ["service-pages-build"]): Service[] {
  return [
    ServiceSchema.parse({
      id: "svc-service-pages-build",
      name: "Service pages build",
      description: "",
      priceMin: 2500,
      priceMax: 6000,
      tags,
      active: true,
    }),
  ];
}

function evidence(readablePages = 4): EvidenceBundle {
  return {
    clientId: "c1",
    source: "http",
    capturedAt: "2026-09-03T00:00:00.000Z",
    site: {
      pages: Array.from({ length: readablePages }, (_, i) => ({
        url: `https://northwindheating.example/page-${i}`,
        status: 200,
        title: "About",
        wordCount: 120,
        headings: [],
        text: "",
      })),
      nav: [],
      links: [],
      sitemapUrls: [],
      crawlExhaustive: true,
    },
    networkEvents: [],
  } as unknown as EvidenceBundle;
}

function coverage(limitation: CoverageAssessment["limitation"]): CoverageAssessment {
  return {
    analyzable: false,
    reason: "test",
    representedOfferings: 0,
    serviceLikePages: 0,
    serviceLikeSitemapUrls: 0,
    limitation,
  };
}

const base = (over: Partial<RuleContext> = {}): RuleContext => ({
  client: client(["boiler installation", "emergency repair"]),
  catalog: catalog(),
  evidence: evidence(),
  coverage: coverage("site-too-thin"),
  ...over,
});

describe("no-service-pages rule", () => {
  it("claims the gap when an exhaustive crawl found no service pages", async () => {
    const [candidate] = await noServicePagesRule(base());

    expect(candidate?.ruleId).toBe("no-service-pages");
    expect(candidate?.subject).toBe("northwindheating.example");
    expect(candidate?.suggestedServiceId).toBe("svc-service-pages-build");
    expect(candidate?.rawConfidence).toBeGreaterThanOrEqual(0.8);
    expect(candidate?.detected).toContain("followed every link");
    expect(candidate?.evidenceRefs.length).toBeGreaterThan(0);
  });

  it("produces one finding for the site, not one per offering", async () => {
    const candidates = await noServicePagesRule(
      base({ client: client(["a", "b", "c", "d", "e"]) }),
    );
    expect(candidates).toHaveLength(1);
  });

  it("claims nothing when the crawl merely fell short", async () => {
    // The same silence, opposite meaning: this one is about the crawler.
    expect(await noServicePagesRule(base({ coverage: coverage("coverage-limited") }))).toEqual([]);
  });

  it("claims nothing when the crawl did reach the service section", async () => {
    // Mutually exclusive with missing-service-page by construction.
    expect(
      await noServicePagesRule(base({ coverage: { ...coverage(null), analyzable: true } })),
    ).toEqual([]);
  });

  it("claims nothing without a coverage assessment at all", async () => {
    expect(await noServicePagesRule(base({ coverage: undefined }))).toEqual([]);
  });

  it("claims nothing when no page was readable, because that is a crawl failure", async () => {
    expect(await noServicePagesRule(base({ evidence: evidence(0) }))).toEqual([]);
  });

  it("claims nothing when the agency sells nothing for this gap", async () => {
    expect(await noServicePagesRule(base({ catalog: catalog(["landing-page"]) }))).toEqual([]);
  });

  it("claims nothing when the client has no offerings to build pages for", async () => {
    expect(await noServicePagesRule(base({ client: client([]) }))).toEqual([]);
  });
});
