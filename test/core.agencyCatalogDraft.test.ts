import { describe, expect, it } from "vitest";

import { sanitizeCatalogDraft } from "@/core/agencyCatalogDraft";
import { ServiceSchema } from "@/core/schema";

const page = "https://agency.example/services/web-design";

describe("agency catalog draft", () => {
  it("keeps evidence-backed website rows and summary rows", () => {
    const result = sanitizeCatalogDraft({
      raw: { services: [
        { name: "Web Design", description: "A conversion-focused website from strategy through launch.", sourceKind: "website", sourceUrls: [page] },
        { name: "SEO Retainers", description: "Ongoing technical and content search optimization.", sourceKind: "summary", sourceUrls: [] },
      ] },
      allowedPageUrls: [page],
      existingServices: [],
    });
    expect(result.map((row) => row.name)).toEqual(["Web Design", "SEO Retainers"]);
  });

  it("drops website claims without captured provenance or with foreign URLs", () => {
    const result = sanitizeCatalogDraft({
      raw: { services: [
        { name: "Branding", description: "A complete visual identity and reusable brand system.", sourceKind: "website", sourceUrls: [] },
        { name: "Hosting", description: "Managed hosting with updates, backups, and monitoring.", sourceKind: "website", sourceUrls: ["https://attacker.example/invented"] },
      ] },
      allowedPageUrls: [page], existingServices: [],
    });
    expect(result).toEqual([]);
  });

  it("deduplicates by meaning, omits existing services, and caps the result at 30", () => {
    const services = Array.from({ length: 40 }, (_, i) => ({
      name: i === 0 ? "Website Design" : i === 1 ? "Website Designs" : `Service ${i}`,
      description: `A concrete customer deliverable numbered ${i} for this agency.`,
      sourceKind: "summary",
      sourceUrls: [],
    }));
    const existing = ServiceSchema.parse({ id: "s1", name: "website design", priceMin: 1, priceMax: 2 });
    const result = sanitizeCatalogDraft({ raw: { services }, allowedPageUrls: [], existingServices: [existing] });
    expect(result).toHaveLength(30);
    expect(result.some((row) => /website designs?/i.test(row.name))).toBe(false);
  });

  it("rejects a malformed provider contract instead of inventing defaults", () => {
    expect(() => sanitizeCatalogDraft({
      raw: { services: [{ name: "SEO", description: "short", sourceKind: "website", sourceUrls: [page], priceMin: 900 }] },
      allowedPageUrls: [page], existingServices: [],
    })).toThrow();
  });
});

