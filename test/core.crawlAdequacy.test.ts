import { describe, expect, it } from "vitest";

import { assessServiceCoverage } from "@/core/absenceVerification";
import { runRules } from "@/core/rules";
import { ClientSchema, EvidenceBundleSchema, ServiceSchema, type EvidenceBundle } from "@/core/schema";

function bundle(p: {
  pages?: { url: string; title?: string; h1s?: string[]; headings?: string[] }[];
  nav?: string[];
  links?: { href: string; label?: string; inNav?: boolean; inServiceNav?: boolean }[];
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
      links: (p.links ?? []).map((l) => ({
        href: l.href,
        label: l.label ?? "",
        inNav: l.inNav ?? false,
        inServiceNav: l.inServiceNav ?? false,
      })),
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
  it("recognizes readable pages grouped by the site under Services even when the CMS URL is generic", () => {
    const evidence = bundle({
      pages: [
        { url: "https://x.example/" },
        { url: "https://x.example/pages/hair-extensions", h1s: ["Hair Extensions"] },
        { url: "https://x.example/pages/balayage", h1s: ["Balayage"] },
      ],
      nav: ["Hair Extensions", "Balayage"],
      links: [
        {
          href: "https://x.example/pages/hair-extensions",
          label: "Hair Extensions",
          inNav: true,
          inServiceNav: true,
        },
        {
          href: "https://x.example/pages/balayage",
          label: "Balayage",
          inNav: true,
          inServiceNav: true,
        },
      ],
    });

    const result = assessServiceCoverage({ client: { offerings: [] }, evidence });

    expect(result.analyzable).toBe(true);
    expect(result.serviceLikePages).toBe(2);
  });

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

/**
 * Structural coverage, added after measuring 24 real small-business sites.
 *
 * The heuristic used to accept a page whose TITLE covered one of the client's
 * offerings. Every one of these cases is a real site where that produced a
 * claim of full coverage on a site that has no service pages at all.
 */
describe("coverage is structural, not textual", () => {
  it("does not let an SEO-titled Contact page pass for a service page", () => {
    // kids-connect.ca. Four pages, no services, and every title stuffed with
    // the words a client would type into the offerings box.
    const client = {
      offerings: ["Social skills groups", "Brick Club social groups", "Parent consultations"],
    };
    const evidence = bundle({
      pages: [
        { url: "https://x.example/", title: "Burnaby Autism Services", headings: ["Not your Typical Social Skills Group."] },
        { url: "https://x.example/the-team/", title: "Autism Social Groups: Empowering Children Together" },
        { url: "https://x.example/faq/", title: "Burnaby Social Play Groups: Helping Kids Connect" },
        { url: "https://x.example/contact-us-social-skills-near-you/", title: "Social Skill Groups Near Me" },
      ],
      nav: ["Our Mission", "Who We Are", "FAQ", "Contact"],
      links: [
        { href: "https://x.example/the-team/", label: "Who We Are", inNav: true },
        { href: "https://x.example/faq/", label: "FAQ", inNav: true },
      ],
    });

    const coverage = assessServiceCoverage({ client, evidence });

    expect(coverage.serviceLikePages).toBe(0);
    expect(coverage.analyzable).toBe(false);
  });

  it("does not count the homepage as having reached the services", () => {
    // Every business writes what it does on its front page. If that counted,
    // "we fetched one page" would mean "we reached the service section".
    const client = { offerings: ["furnace repair", "air conditioning installation"] };
    const evidence = bundle({
      pages: [
        {
          url: "https://x.example/",
          title: "Furnace Repair and Air Conditioning Installation",
          headings: ["Furnace Repair", "Air Conditioning Installation"],
        },
      ],
    });

    expect(assessServiceCoverage({ client, evidence }).serviceLikePages).toBe(0);
  });

  it("counts a nested service page the site files under a hub", () => {
    const client = { offerings: ["heat pump installation", "furnace repair"] };
    const evidence = bundle({
      pages: [
        { url: "https://x.example/" },
        { url: "https://x.example/services/heating/heat-pump-installation", title: "Heat Pump Installation" },
        { url: "https://x.example/treatments/furnace-repair", title: "Furnace Repair" },
      ],
    });

    const coverage = assessServiceCoverage({ client, evidence });
    expect(coverage.serviceLikePages).toBe(2);
    expect(coverage.analyzable).toBe(true);
  });

  it("counts a service page on a site that has no services drawer at all", () => {
    // cambridgeheating.ca: flat .html files named after the work.
    const client = { offerings: ["furnace repair", "air conditioning installation"] };
    const evidence = bundle({
      pages: [
        { url: "https://x.example/" },
        { url: "https://x.example/furnace-repair.html", title: "Furnace Repair" },
        { url: "https://x.example/airconditioner-installation.html", title: "AC Installation" },
      ],
    });

    expect(assessServiceCoverage({ client, evidence }).analyzable).toBe(true);
  });

  it("does not count city pages as service pages", () => {
    // atlasplumbing.ca: Home, About, five city pages, Contact. No services.
    const client = { offerings: ["drain cleaning", "water heater installation", "leak detection"] };
    const evidence = bundle({
      pages: [
        { url: "https://x.example/" },
        { url: "https://x.example/about/" },
        { url: "https://x.example/toronto/", title: "Plumber in Toronto" },
        { url: "https://x.example/scarborough/", title: "Plumber in Scarborough" },
        { url: "https://x.example/north-york/", title: "Plumber in North York" },
      ],
      nav: ["Home", "About", "Toronto", "Scarborough", "North York", "Contact"],
    });

    const coverage = assessServiceCoverage({ client, evidence });
    expect(coverage.serviceLikePages).toBe(0);
    expect(coverage.analyzable).toBe(false);
  });

  it("still recognises the site's own index of its services from navigation", () => {
    // bloordental.com: the crawl reads one page, but the navigation names every
    // treatment and each entry carries an href a targeted fetch can check.
    const client = {
      offerings: ["dental implants", "root canal therapy", "invisalign clear aligners"],
    };
    const evidence = bundle({
      pages: [{ url: "https://x.example/" }],
      nav: ["Services", "Dental Implants", "Root Canal Therapy", "Invisalign", "Teeth Whitening"],
      links: [
        { href: "https://x.example/services/dental-implants", label: "Dental Implants", inNav: true },
        { href: "https://x.example/services/root-canal-therapy", label: "Root Canal Therapy", inNav: true },
      ],
    });

    expect(assessServiceCoverage({ client, evidence }).analyzable).toBe(true);
  });

  it("ignores sitemap URLs that are the boring pages", () => {
    const client = { offerings: ["social skills groups"] };
    const evidence = bundle({
      pages: [{ url: "https://x.example/" }],
      sitemapUrls: [
        "https://x.example/contact-us-social-skills-near-you/",
        "https://x.example/burnaby-social-skills-our-mission/",
        "https://x.example/the-team/",
        "https://x.example/logo/",
      ],
    });

    expect(assessServiceCoverage({ client, evidence }).serviceLikeSitemapUrls).toBe(0);
  });
});
