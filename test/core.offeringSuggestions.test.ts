import { describe, expect, it } from "vitest";

import { suggestOfferings } from "@/core/offeringSuggestions";
import { EvidenceBundleSchema, type EvidenceBundle } from "@/core/schema";

/**
 * Offering suggestions are shown to an agency owner who will confirm or delete
 * each one. Two failure modes matter, and they pull in opposite directions:
 *
 *   - suggesting something that is not a service. "Fully Insured" confirmed
 *     into an offerings box becomes a $900-$1,800 proposal for a landing page
 *     about the client's insurance. Every case below that names a trust claim
 *     is guarding that.
 *   - suggesting something with no provenance. A list an agency has to verify
 *     from scratch is not help; it is homework.
 */

function bundle(p: {
  pages?: Array<{
    url: string;
    title?: string;
    h1s?: string[];
    headings?: string[];
    status?: number;
    wordCount?: number;
  }>;
  links?: Array<{ href: string; label?: string; inNav?: boolean; inServiceNav?: boolean }>;
  sitemapUrls?: string[];
  nav?: string[];
}): EvidenceBundle {
  return EvidenceBundleSchema.parse({
    clientId: "c1",
    source: "http",
    capturedAt: "2026-09-02T00:00:00.000Z",
    site: {
      pages: (p.pages ?? []).map((pg) => ({
        url: pg.url,
        status: pg.status ?? 200,
        title: pg.title ?? "",
        h1s: pg.h1s ?? [],
        headings: pg.headings ?? [],
        textExcerpt: "",
        wordCount: pg.wordCount ?? 250,
        forms: [],
      })),
      nav: p.nav ?? [],
      links: (p.links ?? []).map((l) => ({
        href: l.href,
        label: l.label ?? "",
        inNav: l.inNav ?? false,
        inServiceNav: l.inServiceNav ?? false,
        scheme: "http",
        foundOn: ["https://x.example/"],
      })),
      sitemapUrls: p.sitemapUrls ?? [],
    },
  });
}

const labels = (evidence: EvidenceBundle, existing: string[] = []) =>
  suggestOfferings({ evidence, existingOfferings: existing }).map((s) => s.label);

describe("offering suggestions", () => {
  it("suggests readable pages the site files under a nested Services menu even when their URLs are generic", () => {
    const evidence = bundle({
      pages: [
        { url: "https://x.example/pages/hair-extensions", h1s: ["Hair Extensions"] },
        { url: "https://x.example/pages/balayage", h1s: ["Balayage"] },
      ],
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

    expect(labels(evidence)).toEqual(expect.arrayContaining(["Hair Extensions", "Balayage"]));
  });

  it("returns one offering per Services-menu page and ignores a store collection named packages", () => {
    const evidence = bundle({
      pages: [
        { url: "https://x.example/pages/curly-hair", h1s: ["Curly Hair Services"] },
        { url: "https://x.example/collections/packages", h1s: ["Bundles"] },
        {
          url: "https://x.example/products/scalp-nourishing-treatment-bundle",
          h1s: ["Scalp Nourishing Treatment Bundle"],
        },
      ],
      links: [
        {
          href: "https://x.example/pages/curly-hair",
          label: "Curly Haircut",
          inNav: true,
          inServiceNav: true,
        },
        {
          href: "https://x.example/collections/packages",
          label: "Bundles",
          inNav: true,
        },
        {
          href: "https://x.example/products/scalp-nourishing-treatment-bundle",
          label: "Scalp Nourishing Treatment Bundle",
          inNav: true,
        },
      ],
    });

    expect(labels(evidence)).toEqual(["Curly Hair Services"]);
  });

  it("suggests services from pages the crawl actually read", () => {
    const evidence = bundle({
      pages: [
        { url: "https://x.example/" },
        {
          url: "https://x.example/services/heat-pump-installation",
          h1s: ["Heat Pump Installation"],
        },
        { url: "https://x.example/services/furnace-repair", h1s: ["Furnace Repair"] },
      ],
    });

    expect(labels(evidence)).toEqual(
      expect.arrayContaining(["Heat Pump Installation", "Furnace Repair"]),
    );
  });

  it("finds nested service pages the site files under a hub", () => {
    const evidence = bundle({
      links: [
        { href: "https://x.example/services/heating/heat-pumps", label: "Heat Pumps" },
        { href: "https://x.example/treatments/veneers", label: "Porcelain Veneers" },
        { href: "https://x.example/programs/pre-kindergarten", label: "Pre-Kindergarten" },
      ],
    });

    expect(labels(evidence)).toEqual(
      expect.arrayContaining(["Heat Pumps", "Porcelain Veneers", "Pre-Kindergarten"]),
    );
  });

  it("reads service URLs out of the sitemap", () => {
    const evidence = bundle({
      sitemapUrls: [
        "https://x.example/",
        "https://x.example/about",
        "https://x.example/services/drain-cleaning",
        "https://x.example/services/sewer-line-repair",
      ],
    });

    expect(labels(evidence)).toEqual(
      expect.arrayContaining(["Drain Cleaning", "Sewer Line Repair"]),
    );
  });

  it("names a suggestion from its URL when the link text is a generic call to action", () => {
    // getaxiom.ca: three service cards, every one of them linked under the
    // words "View service". Trusting the anchor text produces one suggestion
    // called "View service" backed by three unrelated URLs.
    const evidence = bundle({
      links: [
        { href: "https://x.example/services/conversion-sites", label: "View service" },
        { href: "https://x.example/services/local-business-websites", label: "View service" },
        { href: "https://x.example/services/rebuilds", label: "View service" },
      ],
    });

    const result = labels(evidence);
    expect(result).toEqual(
      expect.arrayContaining(["Conversion Sites", "Local Business Websites", "Rebuilds"]),
    );
    expect(result).not.toContain("View service");
  });

  it("attaches evidence to every suggestion, and never returns one without it", () => {
    const evidence = bundle({
      pages: [
        {
          url: "https://x.example/services/heat-pump-installation",
          h1s: ["Heat Pump Installation"],
        },
      ],
      links: [
        {
          href: "https://x.example/services/heat-pump-installation",
          label: "Heat Pump Installation",
          inNav: true,
        },
      ],
    });

    const suggestions = suggestOfferings({ evidence, existingOfferings: [] });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(suggestion.evidence.length).toBeGreaterThan(0);
      for (const item of suggestion.evidence) {
        expect(item.detail).toBeTruthy();
      }
    }

    const heatPump = suggestions.find((s) => s.label === "Heat Pump Installation")!;
    expect(heatPump.evidence.map((e) => e.url)).toContain(
      "https://x.example/services/heat-pump-installation",
    );
    // Two independent signals — the page exists AND it is in the navigation.
    expect(heatPump.confidence).toBe("high");
  });
});

describe("what must never be suggested", () => {
  it("does not turn an ecommerce parts catalog into client services", () => {
    // gatesnfences.com is a deliberately difficult real-site case: a large
    // product catalog whose URLs contain words such as "control", "design"
    // and "replacement". Those words are useful service-page signals on a
    // trade site, but here the links are products and Buy-now controls.
    const evidence = bundle({
      links: [
        {
          href: "https://x.example/Remote-Controls/MultiCode-308911-Garage-Doors-Remote-Controls-One-Button.html",
          label: "Buy I",
        },
        {
          href: "https://x.example/Circuit-Boards/AllStar-Control-Boards-Main-Circuit-Logic-Boards.html",
          label: "Allstar",
        },
        {
          href: "https://x.example/Access-Control/Doorking-Replacement-Components-DKS.html",
          label: "Doorking Replacement Components DKS",
        },
        {
          href: "https://x.example/services/access-control-installation",
          label: "Access Control Installation",
        },
        {
          href: "https://x.example/Railings-Balcony-Porch-Deck-Rails.html",
          label: "Railings",
          inServiceNav: true,
        },
      ],
    });

    expect(labels(evidence)).toEqual(
      expect.arrayContaining(["Access Control Installation", "Railings"]),
    );
    expect(labels(evidence)).not.toEqual(
      expect.arrayContaining(["Buy I", "Allstar", "Doorking Replacement Components DKS"]),
    );
  });

  it("fails closed on a commerce-heavy catalog with no explicit services menu", () => {
    const links = Array.from({ length: 8 }, (_, index) => ({
      href: `https://x.example/Remote-Controls/model-${index}-remote-control.html`,
      label: index % 2 === 0 ? "Buy it now" : `Model ${index}`,
      inNav: false,
    }));
    links.push({
      href: "https://x.example/Railings-Balcony-Porch-Deck-Rails.html",
      label: "Railings",
      inNav: true,
    });

    expect(labels(bundle({ links }))).toEqual([]);
  });

  it("excludes trust claims, promotions and generic claims", () => {
    // Every one of these is real navigation text from the corpus.
    const evidence = bundle({
      links: [
        { href: "https://x.example/services/fully-insured", label: "Fully Insured", inNav: true },
        { href: "https://x.example/services/free-quotes", label: "Free Quotes", inNav: true },
        { href: "https://x.example/services/financing", label: "Financing", inNav: true },
        { href: "https://x.example/services/family-owned", label: "Family Owned", inNav: true },
        {
          href: "https://x.example/services/satisfaction-guarantee",
          label: "Satisfaction Guarantee",
          inNav: true,
        },
        { href: "https://x.example/services/award-winning", label: "Award Winning", inNav: true },
        { href: "https://x.example/services/drain-cleaning", label: "Drain Cleaning", inNav: true },
      ],
    });

    const result = labels(evidence);
    expect(result).toEqual(["Drain Cleaning"]);
  });

  it("excludes the boring pages even when their slug carries a service word", () => {
    // drainworks.com's About page really is at this URL.
    const evidence = bundle({
      links: [
        {
          href: "https://x.example/about-drainworks-toronto-plumbers-drain-cleaning",
          label: "About",
          inNav: true,
        },
        { href: "https://x.example/ontario-plumbing-locations", label: "Locations", inNav: true },
        { href: "https://x.example/plumbing-coupons-promos", label: "Coupons", inNav: true },
        { href: "https://x.example/blog", label: "Blog", inNav: true },
        { href: "https://x.example/leaking-ceiling-repair", label: "Leaking Ceiling Repair" },
      ],
    });

    expect(labels(evidence)).toEqual(["Leaking Ceiling Repair"]);
  });

  it("excludes CMS archives, questions, prices and location variants", () => {
    const evidence = bundle({
      links: [
        { href: "https://x.example/tag/plumbing", label: "Plumbing Tag" },
        { href: "https://x.example/category/teeth-whitening", label: "Category: Teeth Whitening" },
        { href: "https://x.example/how-much-is-a-drain-repair", label: "How much is a drain repair?" },
        { href: "https://x.example/basement-renovation-cost", label: "Basement Renovation Cost" },
        { href: "https://x.example/pool-removal-charleswood", label: "Pool Removal in Charleswood" },
        { href: "https://x.example/vehicle-maintenance-chart.pdf", label: "Maintenance Chart" },
        { href: "https://x.example/swimming-pool-removal", label: "Swimming Pool Removal" },
      ],
    });

    expect(labels(evidence)).toEqual(["Swimming Pool Removal"]);
  });

  it("excludes sentence fragments lifted out of body copy", () => {
    const evidence = bundle({
      pages: [
        {
          url: "https://x.example/services/teeth-whitening-candidates",
          h1s: ["good candidates for teeth whitening"],
        },
      ],
    });

    expect(labels(evidence)).not.toContain("good candidates for teeth whitening");
  });

  it("does not re-suggest something the client already records", () => {
    const evidence = bundle({
      links: [
        { href: "https://x.example/services/drain-cleaning", label: "Drain Cleaning" },
        { href: "https://x.example/services/sewer-line-repair", label: "Sewer Line Repair" },
      ],
    });

    // Matching is by meaning, not by string: "drain cleaning" is already known.
    expect(labels(evidence, ["Drain cleaning"])).toEqual(["Sewer Line Repair"]);
  });

  it("suggests nothing at all on a site that genuinely has no services", () => {
    // kids-connect.ca: four pages, no service section, nothing to propose.
    const evidence = bundle({
      pages: [
        { url: "https://x.example/" },
        { url: "https://x.example/the-team/", title: "Autism Social Groups" },
        { url: "https://x.example/faq/", title: "Burnaby Social Play Groups" },
        { url: "https://x.example/contact-us-social-skills-near-you/" },
      ],
      links: [
        { href: "https://x.example/the-team/", label: "Who We Are", inNav: true },
        { href: "https://x.example/faq/", label: "FAQ", inNav: true },
        { href: "https://x.example/connect/", label: "Contact", inNav: true },
      ],
    });

    expect(labels(evidence)).toEqual([]);
  });

  it("ignores pages the crawl could not read", () => {
    const evidence = bundle({
      pages: [
        { url: "https://x.example/services/heat-pumps", h1s: ["Heat Pumps"], status: 404, wordCount: 0 },
        { url: "https://x.example/services/boilers", h1s: ["Boilers"], status: 200, wordCount: 0 },
      ],
    });

    expect(labels(evidence)).toEqual([]);
  });

  it("does not turn registry records or generic marketing CTAs into services", () => {
    const evidence = bundle({
      pages: [
        {
          url: "https://www.iana.org/dnssec/procedures",
          h1s: ["Policies & Procedures"],
        },
        {
          url: "https://www.iana.org/domains/root/db/build.html",
          h1s: ["Delegation Record for .BUILD"],
        },
      ],
      links: [
        {
          href: "https://www.iana.org/dnssec/procedures",
          label: "Policies & Procedures",
        },
        {
          href: "https://www.iana.org/domains/root/db/build.html",
          label: "Delegation Record for .BUILD",
        },
        { href: "https://x.example/services/see-solution", label: "See solution" },
        { href: "https://x.example/solutions/ai", label: "Build without boundaries" },
        { href: "https://x.example/services/build-a-website", label: "Build a Website" },
      ],
    });

    const result = labels(evidence);
    expect(result).not.toContain("Policies & Procedures");
    expect(result).not.toContain("Delegation Record for .BUILD");
    expect(result).not.toContain("See solution");
    expect(result).not.toContain("Build without boundaries");
    expect(result).toContain("Build a Website");
  });
});

/**
 * Precision cases taken verbatim from the analyzability corpus, where each of
 * these was actually suggested to a reviewer as something the business sells.
 * They pull against the opposite risk — being so strict that real services stop
 * being offered — so each block keeps a genuine service alongside the noise and
 * asserts the genuine one survives.
 */
describe("what the corpus caught", () => {
  it("does not offer a blog post as a service", () => {
    // goddardschool.com/blog/babyproofing-your-home, suggested at high
    // confidence to a childcare business.
    const evidence = bundle({
      pages: [
        { url: "https://x.example/" },
        { url: "https://x.example/blog/babyproofing-your-home", h1s: ["Babyproofing Your Home"] },
        { url: "https://x.example/services/infant-program", h1s: ["Infant Program"] },
      ],
    });

    const found = labels(evidence);
    expect(found).not.toContain("Babyproofing Your Home");
    expect(found).toContain("Infant Program");
  });

  it("does not offer short builder blog namespaces as services", () => {
    // Pitton Plumbing uses /b/ for editorial posts. The slug contains real
    // service words, but the namespace still means the page is advice, not a
    // customer-purchased service.
    const evidence = bundle({
      pages: [
        { url: "https://x.example/" },
        {
          url: "https://x.example/b/3-environmentally-friendly-plumbing-upgrades",
          h1s: ["3 Environmentally Friendly Plumbing Upgrades Worth Reading"],
        },
        { url: "https://x.example/services/drain-cleaning", h1s: ["Drain Cleaning"] },
      ],
      sitemapUrls: [
        "https://x.example/b/5-preventative-plumbing-tips",
        "https://x.example/services/drain-cleaning",
      ],
    });

    const found = labels(evidence);
    expect(found).not.toContain("3 Environmentally Friendly Plumbing Upgrades Worth Reading");
    expect(found).not.toContain("5 Preventative Plumbing Tips");
    expect(found).toContain("Drain Cleaning");
  });

  it("does not offer an individual job write-up as a service", () => {
    // thelawnsalon.ca keeps real services under /all-projects and photographs
    // of finished jobs under /project-gallery. Ten of the second were being
    // suggested, crowding out the two real ones.
    const evidence = bundle({
      pages: [
        { url: "https://x.example/" },
        { url: "https://x.example/all-projects/pool-removal/", h1s: ["Swimming Pool Removal"] },
        {
          url: "https://x.example/project-gallery/charleswood-pool-removal-through-low-garage/",
          h1s: ["Charleswood Pool Removal Through Low Garage"],
        },
        {
          url: "https://x.example/project-gallery/large-stump-removal/",
          h1s: ["Large Stump Removal"],
        },
      ],
    });

    const found = labels(evidence);
    expect(found).toContain("Swimming Pool Removal");
    expect(found).not.toContain("Charleswood Pool Removal Through Low Garage");
    expect(found).not.toContain("Large Stump Removal");
  });

  it("does not offer the index page above a group of services", () => {
    // michaelandson.com titles /cooling "All Cooling Services". Dropping the
    // four of these let four real services take their place under the cap.
    const evidence = bundle({
      pages: [
        { url: "https://x.example/" },
        { url: "https://x.example/cooling", h1s: ["All Cooling Services"] },
        { url: "https://x.example/cooling/central-ac-repair", h1s: ["Central AC Repair"] },
      ],
    });

    const found = labels(evidence);
    expect(found).not.toContain("All Cooling Services");
    expect(found).toContain("Central AC Repair");
  });

  it("still offers a service whose page merely sits deep in the site", () => {
    // The editorial check looks at ancestors, so it must not reject a service
    // simply for being nested.
    const evidence = bundle({
      pages: [
        { url: "https://x.example/" },
        {
          url: "https://x.example/residential/heating/heat-pump-installation",
          h1s: ["Heat Pump Installation"],
        },
      ],
    });

    expect(labels(evidence)).toContain("Heat Pump Installation");
  });
});
