import { describe, expect, it, vi } from "vitest";

import { verifyOfferingAbsence } from "@/core/absenceVerification";
import { runRules } from "@/core/rules";
import { EvidenceBundleSchema, ServiceSchema, ClientSchema } from "@/core/schema";
import type { EvidenceBundle, EvidencePage } from "@/core/schema";

/**
 * Regression tests for the false positives found in the 20-site validation run.
 * These use SYNTHETIC evidence bundles that reproduce the STRUCTURE of the real
 * failures (nav labels / link hrefs / crawled pages) — no site is hardcoded.
 */

function bundle(partial: {
  pages?: Partial<EvidencePage>[];
  nav?: string[];
  links?: { href: string; label?: string; inNav?: boolean }[];
  sitemapUrls?: string[];
}): EvidenceBundle {
  return EvidenceBundleSchema.parse({
    clientId: "c1",
    source: "http",
    capturedAt: "2026-08-31T00:00:00.000Z",
    site: {
      pages: (partial.pages ?? []).map((p, i) => ({
        url: p.url ?? `https://ex.example/p${i}`,
        title: p.title ?? "",
        h1s: p.h1s ?? [],
        headings: p.headings ?? [],
        textExcerpt: "",
        wordCount: 100,
      })),
      nav: partial.nav ?? [],
      links: (partial.links ?? []).map((l) => ({
        href: l.href,
        label: l.label ?? "",
        inNav: l.inNav ?? false,
      })),
      sitemapUrls: partial.sitemapUrls ?? [],
    },
  });
}

const NO_FETCH = { fetchPage: undefined };

describe("absence verification — validation regressions", () => {
  it("recognizes a nav label that omits the offering's modifier word (sump pump installation ~ 'Sump Pump Services')", async () => {
    const v = await verifyOfferingAbsence({
      offering: "sump pump installation",
      allOfferings: ["drain cleaning", "sewer line repair", "sump pump installation"],
      evidence: bundle({
        pages: [{ title: "Residential Plumbing" }, { title: "Drain Cleaning" }, { title: "Financing" }],
        nav: ["Residential", "Drain Cleaning", "Sump Pump Services", "Financing"],
        links: [{ href: "https://ex.example/services/sump-pump/", label: "Sump Pump Services", inNav: true }],
      }),
      ...NO_FETCH,
    });
    expect(v.conclusion).toBe("present");
  });

  it("recognizes 'Heat Pumps' in nav for 'heat pump installation'", async () => {
    const v = await verifyOfferingAbsence({
      offering: "heat pump installation",
      allOfferings: ["ac repair", "furnace repair", "heat pump installation", "thermostat installation"],
      evidence: bundle({
        pages: [{ title: "Heating Services" }, { title: "Furnaces" }, { title: "Boilers" }],
        nav: ["Heating", "Furnaces", "Boilers", "Geothermal", "Water Heaters", "Heat Pumps", "Air Conditioning"],
        links: [{ href: "https://ex.example/heating/heat-pumps/", label: "Heat Pumps", inNav: true }],
      }),
      ...NO_FETCH,
    });
    expect(v.conclusion).toBe("present");
  });

  it("recognizes 'Air Quality' in nav for 'indoor air quality'", async () => {
    const v = await verifyOfferingAbsence({
      offering: "indoor air quality",
      allOfferings: ["ac repair", "furnace installation", "duct cleaning", "indoor air quality"],
      evidence: bundle({
        pages: [{ title: "Heating" }, { title: "Cooling" }, { title: "Locations" }],
        nav: ["Services", "Heating", "Cooling", "Air Quality", "Maintenance Plans"],
        links: [{ href: "https://ex.example/indoor-air-quality/", label: "Air Quality", inNav: true }],
      }),
      ...NO_FETCH,
    });
    expect(v.conclusion).toBe("present");
  });

  it("recognizes a plural nav label (mosquito treatment ~ 'Mosquitoes')", async () => {
    const v = await verifyOfferingAbsence({
      offering: "mosquito treatment",
      allOfferings: ["general pest control", "mosquito treatment", "ant control", "spider control"],
      evidence: bundle({
        pages: [{ title: "Pest Control" }, { title: "How It Works" }, { title: "Pricing" }],
        nav: ["Pests We Treat", "Ants", "Spiders", "Mosquitoes", "Wasps"],
        links: [{ href: "https://ex.example/pests/mosquitoes/", label: "Mosquitoes", inNav: true }],
      }),
      ...NO_FETCH,
    });
    expect(v.conclusion).toBe("present");
  });

  it("recognizes an offering already present as a crawled page URL (ant control ~ /pest-control/ants/)", async () => {
    const v = await verifyOfferingAbsence({
      offering: "ant control",
      allOfferings: ["general pest control", "mosquito treatment", "ant control", "spider control"],
      evidence: bundle({
        pages: [
          { url: "https://ex.example/pest-control/ants/", title: "Ant Control", h1s: ["Ant Control"] },
          { url: "https://ex.example/", title: "Home" },
          { url: "https://ex.example/pricing/", title: "Pricing" },
        ],
        nav: ["Home", "Pricing"],
      }),
      ...NO_FETCH,
    });
    expect(v.conclusion).toBe("present");
  });

  it("fetches a close-match link and confirms the page (garage door spring replacement ~ 'Garage Spring Repair')", async () => {
    const fetchPage = vi.fn(async (url: string): Promise<EvidencePage | null> => {
      if (url.includes("garage-spring")) {
        return {
          url,
          title: "Garage Door Spring Repair & Replacement",
          h1s: ["Garage Door Spring Repair"],
          headings: ["Broken Spring Signs"],
          textExcerpt: "",
          wordCount: 200,
        };
      }
      return null;
    });
    const v = await verifyOfferingAbsence({
      offering: "garage door spring replacement",
      allOfferings: [
        "garage door repair",
        "garage door spring replacement",
        "garage door opener installation",
        "new garage door installation",
      ],
      evidence: bundle({
        pages: [{ title: "Garage Door Repair" }, { title: "Openers" }, { title: "New Doors" }],
        nav: ["Repair", "Openers", "New Doors"],
        links: [{ href: "https://ex.example/garage-spring-repair/", label: "Garage Spring Repair" }],
      }),
      fetchPage,
    });
    expect(v.conclusion).toBe("present");
    expect(v.inspectedUrls).toContain("https://ex.example/garage-spring-repair/");
  });

  it("still concludes ABSENT for a genuine gap, and records what was checked", async () => {
    const fetchPage = vi.fn(async (): Promise<EvidencePage | null> => null);
    const v = await verifyOfferingAbsence({
      offering: "pool heater installation",
      allOfferings: ["ac repair", "furnace installation", "duct cleaning", "pool heater installation"],
      evidence: bundle({
        pages: [{ title: "Air Conditioning" }, { title: "Furnaces" }, { title: "Duct Cleaning" }, { title: "About" }],
        nav: ["Air Conditioning", "Furnaces", "Duct Cleaning", "About", "Contact"],
        links: [{ href: "https://ex.example/services/heating/", label: "Heating" }],
      }),
      fetchPage,
    });
    expect(v.conclusion).toBe("absent");
    expect(v.reason).toMatch(/pool heater installation/i);
  });

  it("matches a morphological variant in a link label (hardscaping ~ 'Hardscape Design/Installation')", async () => {
    const v = await verifyOfferingAbsence({
      offering: "hardscaping",
      allOfferings: ["lawn maintenance", "landscape design", "irrigation installation", "hardscaping"],
      evidence: bundle({
        pages: [{ title: "Lawn Care & Landscaping" }, { title: "Get a Quote" }, { title: "Pressure Washing" }],
        nav: ["Residential", "Lawn Aeration", "Gutter Cleaning"],
        links: [
          { href: "https://ex.example/landscape/hardscape/", label: "Hardscape Design", inNav: true },
          { href: "https://ex.example/landscape/hardscape-installation/", label: "Hardscape Installation", inNav: true },
        ],
      }),
      ...NO_FETCH,
    });
    expect(v.conclusion).toBe("present");
  });

  it("matches a stem variant (electrical panel upgrade ~ page 'Electrician in DFW')", async () => {
    const v = await verifyOfferingAbsence({
      offering: "electrical panel upgrade",
      allOfferings: ["electrical panel upgrade", "ev charger installation", "generator installation"],
      evidence: bundle({
        pages: [
          { url: "https://ex.example/electrician/", title: "Electrician in DFW", h1s: ["Your Local Electricians"] },
          { url: "https://ex.example/", title: "Home Services" },
          { url: "https://ex.example/reviews/", title: "Reviews" },
        ],
        nav: ["Schedule", "Reviews", "Contact"],
      }),
      ...NO_FETCH,
    });
    expect(v.conclusion).toBe("present");
  });

  it("a matching nav label with no href is INCONCLUSIVE, not absent (Jones 'Mini-Splits')", async () => {
    const v = await verifyOfferingAbsence({
      offering: "ductless mini split installation",
      allOfferings: ["air conditioning installation", "boiler repair", "drain cleaning", "ductless mini split installation"],
      evidence: bundle({
        pages: [
          { url: "https://ex.example/hvac-services/air-conditioning-repair/", title: "Air Conditioning Repair" },
          { url: "https://ex.example/hvac-services/heating-repair/", title: "Heating Repair" },
          { url: "https://ex.example/plumbing-services/", title: "Plumbing Services" },
        ],
        // "Mini-Splits" is a mega-menu label with no anchor href.
        nav: ["Services", "Air Conditioning", "Heating", "Mini-Splits", "Plumbing", "Drains"],
        links: [],
      }),
      ...NO_FETCH,
    });
    expect(v.conclusion).toBe("inconclusive");
    expect(v.conclusion).not.toBe("absent");
  });

  it("does not treat a modifier-only offering as a gap", async () => {
    const v = await verifyOfferingAbsence({
      offering: "installation services",
      allOfferings: ["installation services"],
      evidence: bundle({ pages: [{ title: "Home" }, { title: "About" }, { title: "Contact" }] }),
      ...NO_FETCH,
    });
    expect(v.conclusion).toBe("weak");
  });
});

describe("rule end-to-end: verified absence only", () => {
  const catalog = [
    ServiceSchema.parse({
      id: "svc-landing-page",
      name: "Service Landing Page",
      description: "",
      priceMin: 900,
      priceMax: 1800,
      tags: ["landing-page"],
      active: true,
    }),
  ];

  it("suppresses offerings represented in nav, surfaces only the genuine gap", async () => {
    const client = ClientSchema.parse({
      id: "plumbco",
      name: "PlumbCo",
      domain: "plumbco.example",
      offerings: ["drain cleaning", "sump pump installation", "trenchless pipe repair", "pool line plumbing"],
    });
    const evidence = bundle({
      pages: [
        { url: "https://plumbco.example/", title: "Plumbing & Drain Cleaning" },
        { url: "https://plumbco.example/residential/", title: "Residential Plumbing" },
        { url: "https://plumbco.example/financing/", title: "Financing" },
      ],
      nav: ["Drain Cleaning", "Sump Pump Services", "Trenchless Sewer Line Repair", "Financing"],
    });

    const candidates = await runRules({ client, catalog, evidence });
    expect(candidates.map((c) => c.subject)).toEqual(["pool line plumbing"]);
    expect(candidates[0]?.verification?.conclusion).toBe("absent");
  });
});
