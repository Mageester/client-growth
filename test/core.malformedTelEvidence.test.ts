import { describe, expect, it } from "vitest";

import { brokenConversionPathRule } from "@/core/rules/brokenConversionPath";
import { passesEvidenceThreshold } from "@/core/threshold";
import { EvidenceBundleSchema, type Client, type Service } from "@/core/schema";

const client: Client = {
  id: "c1", name: "Acme", domain: "acme.example",
  offerings: ["drain cleaning"], notes: "",
};
const catalog: Service[] = [
  { id: "svc-conv", name: "Conversion Path Fix", description: "", priceMin: 300, priceMax: 900, tags: ["conversion-fix"], active: true },
];

/** A placeholder click-to-call CTA sitting on exactly one page. */
const evidence = EvidenceBundleSchema.parse({
  clientId: "c1",
  source: "http",
  capturedAt: new Date().toISOString(),
  site: {
    pages: [
      { url: "https://acme.example/", status: 200, title: "Acme", h1s: ["Acme"], headings: [], textExcerpt: "", wordCount: 5, forms: [] },
      { url: "https://acme.example/contact", status: 200, title: "Contact", h1s: ["Contact Us"], headings: [], textExcerpt: "", wordCount: 5, forms: [] },
      { url: "https://acme.example/about", status: 200, title: "About", h1s: ["About"], headings: [], textExcerpt: "", wordCount: 5, forms: [] },
    ],
    nav: [],
    links: [
      {
        href: "tel:XXX-XXX-XXXX", label: "Call Us Now", scheme: "tel",
        ariaLabel: "", title: "", inNav: false,
        foundOn: ["https://acme.example/contact"],
      },
    ],
    sitemapUrls: [],
  },
  networkEvents: [],
});

describe("a malformed tel: CTA on a single page", () => {
  it("is detected and clears the evidence threshold", async () => {
    const candidates = await brokenConversionPathRule({ client, catalog, evidence });
    expect(candidates).toHaveLength(1);

    const candidate = candidates[0]!;
    expect(candidate.conversionDefect?.kind).toBe("malformed-tel");
    // The broken href itself is cited, not just the page it sits on.
    expect(candidate.evidenceRefs).toContain("element:tel:XXX-XXX-XXXX");
    expect(passesEvidenceThreshold(candidate, evidence)).toBe(true);
  });
});
