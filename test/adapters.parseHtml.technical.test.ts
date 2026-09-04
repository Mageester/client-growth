import { describe, expect, it } from "vitest";

import { parseHtml } from "@/adapters/evidence/parseHtml";
import { EvidenceBundleSchema } from "@/core/schema";

describe("parseHtml technical observations", () => {
  it("records meta, JSON-LD types, and the difference between missing and decorative alt", () => {
    const parsed = parseHtml(
      `<!doctype html><html><head>
        <meta name="description" content="">
        <meta name="description" content="A real description">
        <script type="application/ld+json; charset=utf-8">{"@type":["LocalBusiness","Service"]}</script>
        <div itemscope itemtype="https://schema.org/Dentist"></div>
      </head><body>
        <h1>Home</h1>
        <img src="/hero.jpg">
        <img src="/ornament.svg" alt="">
        <img src="/team.jpg" alt="Our team">
        <p>Readable page content for the evidence parser.</p>
      </body></html>`,
      "https://example.test/",
    );

    expect(parsed.page.metaDescription).toBe("A real description");
    expect(parsed.page.structuredDataTypes).toEqual([
      "LocalBusiness",
      "Service",
      "https://schema.org/Dentist",
    ]);
    expect(parsed.page.structuredDataPresent).toBe(true);
    expect(parsed.page.images).toEqual([
      { src: "/hero.jpg" },
      { src: "/ornament.svg", alt: "" },
      { src: "/team.jpg", alt: "Our team" },
    ]);
  });

  it("marks a page with no structured-data encoding as an observed absence", () => {
    const parsed = parseHtml(
      "<html><head><title>Home</title></head><body><h1>Home</h1><p>Content</p></body></html>",
      "https://example.test/",
    );

    expect(parsed.page.structuredDataTypes).toEqual([]);
    expect(parsed.page.structuredDataPresent).toBe(false);
  });

  it("keeps newly introduced fields unknown when parsing a legacy bundle", () => {
    const bundle = EvidenceBundleSchema.parse({
      clientId: "client-legacy",
      source: "fixture",
      capturedAt: "2026-09-04T00:00:00.000Z",
      site: {
        pages: [
          {
            url: "https://example.test/",
            status: 200,
            title: "Example",
            h1s: ["Example"],
            headings: [],
            textExcerpt: "Readable content",
            wordCount: 20,
            forms: [],
          },
        ],
        nav: [],
        links: [],
        sitemapUrls: [],
      },
      networkEvents: [],
    });

    expect(bundle.site.pages[0]?.metaDescription).toBeUndefined();
    expect(bundle.site.pages[0]?.structuredDataTypes).toBeUndefined();
    expect(bundle.site.pages[0]?.images).toBeUndefined();
  });
});
