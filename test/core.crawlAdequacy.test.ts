import { describe, expect, it } from "vitest";

import { assessServiceCoverage } from "@/core/absenceVerification";
import { runRules } from "@/core/rules";
import { ClientSchema, EvidenceBundleSchema, ServiceSchema, type EvidenceBundle } from "@/core/schema";

function bundle(p: {
  pages?: { url: string; title?: string; h1s?: string[]; headings?: string[] }[];
  nav?: string[];
  links?: { href: string; label?: string; inNav?: boolean }[];
  sitemapUrls?: string[];
}): EvidenceBundle {
  return EvidenceBundleSchema.parse({
    clientId: "c1",
    source: "http",
    capturedAt: "2026-08-31T00:00:00.000Z",
    site: {
      pages: (p.pages ?? []).map((pg) => ({
        url: pg.url,
        title: pg.title ?? "",
        h1s: pg.h1s ?? [],
        headings: pg.headings ?? [],
        textExcerpt: "",
        wordCount: 100,
      })),
      nav: p.nav ?? [],
      links: (p.links ?? []).map((l) => ({ href: l.href, label: l.label ?? "", inNav: l.inNav ?? false })),
      sitemapUrls: p.sitemapUrls ?? [],
    },
  });
}

const LANDING_CATALOG = [
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

describe("crawl / service-coverage adequacy", () => {
  it("Castle Keepers style: real pages + nav, but NO service coverage -> not analyzable", () => {
    const client = {
      offerings: ["recurring house cleaning", "deep cleaning", "move out cleaning", "post construction cleaning", "green cleaning"],
    };
    const evidence = bundle({
      pages: [
        { url: "https://ck.example/" },
        { url: "https://ck.example/home" },
        { url: "https://ck.example/about" },
        { url: "https://ck.example/buy-a-home" },
        { url: "https://ck.example/sell-a-home" },
        { url: "https://ck.example/castle-keepers-program" },
        { url: "https://ck.example/for-homeowners" },
        { url: "https://ck.example/for-castle-keepers" },
      ],
      nav: ["Home", "About", "Buy a Home", "Sell a Home", "Program", "For Homeowners", "Contact", "Blog", "Careers", "Reviews", "FAQ", "Login", "Privacy"],
      links: [],
      sitemapUrls: [],
    });

    const cov = assessServiceCoverage({ client, evidence });
    expect(cov.analyzable).toBe(false);
    expect(cov.representedOfferings).toBe(0);
    expect(cov.serviceLikePages).toBe(0);
    expect(cov.reason).toMatch(/insufficient service coverage/i);
  });

  it("Roman Electric style: only 3 pages, no nav, one homepage keyword -> not analyzable", () => {
    const client = {
      offerings: ["electrical panel upgrade", "ceiling fan installation", "water heater installation", "furnace repair", "ev charger installation", "whole house rewiring"],
    };
    const evidence = bundle({
      pages: [
        { url: "https://roman.example/", title: "Milwaukee Electrical, Plumbing, & HVAC | Roman Electric" },
        { url: "https://roman.example/whole-home-protection-plan", title: "Whole-Home Protection Plan" },
        { url: "https://roman.example/service-area", title: "Service Area | Southeastern Wisconsin" },
      ],
      nav: [],
      links: [],
      sitemapUrls: [],
    });

    const cov = assessServiceCoverage({ client, evidence });
    expect(cov.analyzable).toBe(false);
  });

  it("representative crawl (>=2 service-like pages) with a genuine gap -> analyzable, and the rule surfaces it", async () => {
    const client = ClientSchema.parse({
      id: "hvacco",
      name: "HVAC Co",
      domain: "hvacco.example",
      offerings: ["air conditioning repair", "furnace installation", "pool heater installation"],
      notes: "",
    });
    const evidence = bundle({
      pages: [
        { url: "https://hvacco.example/", title: "HVAC Co | Heating & Cooling" },
        { url: "https://hvacco.example/services/air-conditioning-repair", title: "Air Conditioning Repair", h1s: ["Air Conditioning Repair"] },
        { url: "https://hvacco.example/services/furnace-installation", title: "Furnace Installation", h1s: ["Furnace Installation"] },
        { url: "https://hvacco.example/about", title: "About Us" },
      ],
      nav: ["Air Conditioning Repair", "Furnace Installation", "About", "Contact"],
      links: [
        { href: "https://hvacco.example/services/air-conditioning-repair", label: "Air Conditioning Repair", inNav: true },
        { href: "https://hvacco.example/services/furnace-installation", label: "Furnace Installation", inNav: true },
      ],
    });

    const cov = assessServiceCoverage({ client, evidence });
    expect(cov.analyzable).toBe(true);

    const candidates = await runRules({
      client,
      catalog: LANDING_CATALOG,
      evidence,
    });
    expect(candidates.map((c) => c.subject)).toEqual(["pool heater installation"]);
    expect(candidates[0]?.verification?.conclusion).toBe("absent");
  });
});
