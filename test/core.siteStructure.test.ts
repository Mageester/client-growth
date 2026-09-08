import { describe, expect, it } from "vitest";

import {
  crawlPriority,
  hasServiceWordInSlug,
  isArchivePath,
  isInServiceSection,
  isRegistryPath,
  isServiceHub,
  isServiceSectionChild,
  looksLikeServiceUrl,
  pathSegments,
  slugSaysNonService,
} from "@/core/siteStructure";

/**
 * The shared vocabulary three parts of the product depend on. Every case here
 * is a URL shape taken from the real-site analyzability corpus, because the
 * failure this file guards against is a heuristic that works on invented
 * examples and misses how service businesses actually build websites.
 */

describe("service section recognition", () => {
  it("does not mistake a commerce collection named packages for a services section", () => {
    expect(isInServiceSection("https://x.example/collections/packages")).toBe(false);
    expect(looksLikeServiceUrl("https://x.example/collections/packages")).toBe(false);
    expect(hasServiceWordInSlug("https://x.example/products/scalp-treatment-bundle")).toBe(false);
    expect(isInServiceSection("https://x.example/services/packages")).toBe(true);
  });

  it("recognises a services hub whatever the site calls it", () => {
    for (const url of [
      "https://x.example/services",
      "https://x.example/our-services/",
      "https://x.example/what-we-do",
      "https://x.example/solutions",
      "https://x.example/treatments",
      "https://x.example/programs",
    ]) {
      expect(isServiceHub(url), url).toBe(true);
      expect(isInServiceSection(url), url).toBe(true);
    }
  });

  it("recognises nested pages under the hub, at any depth", () => {
    const nested = [
      "https://x.example/services/heat-pumps",
      "https://x.example/services/heating/heat-pump-installation",
      "https://x.example/treatments/veneers",
      "https://x.example/programs/pre-kindergarten",
    ];
    for (const url of nested) {
      expect(isServiceSectionChild(url), url).toBe(true);
      expect(isInServiceSection(url), url).toBe(true);
      // A nested page is not the hub itself; the two rank differently.
      expect(isServiceHub(url), url).toBe(false);
    }
  });

  it("recognises a service page on a site with no services drawer at all", () => {
    // cambridgeheating.ca is built exactly like this: flat .html files.
    for (const url of [
      "https://x.example/furnace-repair.html",
      "https://x.example/air-conditioner-installation.html",
      "https://x.example/basement-waterproofing/",
      "https://x.example/teeth-whitening",
    ]) {
      expect(hasServiceWordInSlug(url), url).toBe(true);
      expect(looksLikeServiceUrl(url), url).toBe(true);
    }
  });

  it("does not treat the boring pages as services", () => {
    for (const url of [
      "https://x.example/",
      "https://x.example/about",
      "https://x.example/contact-us",
      "https://x.example/careers",
      "https://x.example/privacy-policy",
      "https://x.example/reviews",
    ]) {
      expect(looksLikeServiceUrl(url), url).toBe(false);
    }
  });
});

describe("weak-signal rejection", () => {
  it("rejects an SEO-written slug that is still the contact page", () => {
    // Taken verbatim from kids-connect.ca, whose Contact page is titled
    // "Social Skill Groups Near Me" and whose About page is
    // "/burnaby-social-skills-autism-our-mission".
    expect(slugSaysNonService("https://x.example/contact-us-social-skills-near-you/")).toBe(true);
    expect(slugSaysNonService("https://x.example/burnaby-social-skills-autism-our-mission/")).toBe(
      true,
    );
    expect(slugSaysNonService("https://x.example/the-team/")).toBe(true);
    expect(slugSaysNonService("https://x.example/about-drainworks-toronto-plumbers")).toBe(true);
  });

  it("rejects pages about what something costs", () => {
    expect(slugSaysNonService("https://x.example/basement-renovation-cost")).toBe(true);
    expect(slugSaysNonService("https://x.example/plumbing-coupons")).toBe(true);
  });

  it("keeps a genuine service slug", () => {
    expect(slugSaysNonService("https://x.example/services/heat-pump-installation")).toBe(false);
    expect(slugSaysNonService("https://x.example/leaking-ceiling-repair")).toBe(false);
  });

  it("treats the homepage as never being a service page", () => {
    expect(slugSaysNonService("https://x.example/")).toBe(true);
  });

  it("recognises CMS archive paths that carry a service word", () => {
    expect(isArchivePath("https://x.example/tag/plumbing/")).toBe(true);
    expect(isArchivePath("https://x.example/category/teeth-whitening")).toBe(true);
    expect(isArchivePath("https://x.example/blog/page/3")).toBe(true);
    expect(isArchivePath("https://x.example/services/heat-pumps")).toBe(false);
  });
});

describe("registry path recognition", () => {
  it("does not treat public registries and DNSSEC procedures as services", () => {
    for (const url of [
      "https://www.iana.org/domains/root/db/build.html",
      "https://www.iana.org/domains/root/db/build",
      "https://www.iana.org/dnssec/procedures",
    ]) {
      expect(isRegistryPath(url), url).toBe(true);
      expect(isInServiceSection(url), url).toBe(false);
      expect(hasServiceWordInSlug(url), url).toBe(false);
      expect(looksLikeServiceUrl(url), url).toBe(false);
    }
  });

  it("keeps a genuine service page outside those namespaces", () => {
    const url = "https://x.example/services/build-a-website";
    expect(isRegistryPath(url)).toBe(false);
    expect(looksLikeServiceUrl(url)).toBe(true);
  });
});

describe("crawl frontier priority", () => {
  it("puts the homepage first", () => {
    expect(crawlPriority("https://x.example/")).toBeGreaterThan(
      crawlPriority("https://x.example/services/heat-pumps"),
    );
  });

  it("prefers a service page over the pages every site has", () => {
    const service = crawlPriority("https://x.example/services/heat-pump-installation");
    for (const boring of [
      "https://x.example/about",
      "https://x.example/careers",
      "https://x.example/privacy-policy",
      "https://x.example/locations",
    ]) {
      expect(service, boring).toBeGreaterThan(crawlPriority(boring, { inNav: true }));
    }
  });

  it("prefers an individual service page over the hub that lists them", () => {
    expect(crawlPriority("https://x.example/services/tree-removal")).toBeGreaterThan(
      crawlPriority("https://x.example/services"),
    );
  });

  it("uses navigation membership only to break ties, never to beat structure", () => {
    // A nav link to the About page must not outrank a service page that is not
    // in the navigation — this is precisely the ordering that spent a ten-page
    // budget on About, Careers and Privacy.
    expect(crawlPriority("https://x.example/furnace-repair")).toBeGreaterThan(
      crawlPriority("https://x.example/about", { inNav: true }),
    );
    expect(crawlPriority("https://x.example/services/x", { inNav: true })).toBeGreaterThan(
      crawlPriority("https://x.example/services/x"),
    );
  });

  it("demotes deep archive paths", () => {
    expect(crawlPriority("https://x.example/blog/2019/07/some-post")).toBeLessThan(
      crawlPriority("https://x.example/heat-pump-repair"),
    );
  });
});

describe("path parsing", () => {
  it("lowercases and drops empty segments", () => {
    expect(pathSegments("https://x.example/Services/Heat-Pumps/")).toEqual([
      "services",
      "heat-pumps",
    ]);
    expect(pathSegments("https://x.example/")).toEqual([]);
  });

  it("survives a value that is not a URL", () => {
    expect(pathSegments("/services/heat-pumps")).toEqual(["services", "heat-pumps"]);
    expect(() => pathSegments("::::")).not.toThrow();
  });
});

/**
 * Real case: thelawnsalon.ca.
 *
 * Its six service pages live under /all-projects/ and are listed in the site's
 * own navigation. Its project gallery is dozens of near-duplicate photo pages
 * of finished jobs. Because only a URL's LAST segment was checked for boring
 * words, a photo page scored ~60 for the service word "removal" while the deck
 * service page scored ~15 — so the crawler spent five of its ten pages on
 * pool-removal photographs and read none of the six services.
 */
describe("crawl priority against a portfolio site", () => {
  const service = "https://x.example/all-projects/decks/";
  const gallery = "https://x.example/project-gallery/pool-removal-in-westwood/";

  it("reads a service page before a photo of a finished job", () => {
    expect(crawlPriority(service, { inNav: true })).toBeGreaterThan(crawlPriority(gallery));
  });

  it("demotes blog posts even when the slug is full of service words", () => {
    expect(crawlPriority("https://x.example/services/drain-repair")).toBeGreaterThan(
      crawlPriority("https://x.example/blog/how-to-fix-a-blocked-drain-repair"),
    );
  });

  it("does not demote a service section that merely has 'projects' in its name", () => {
    // "projects" is demoted; "all-projects" is where this site keeps the real
    // pages. Getting this wrong hides the services instead of the photographs.
    expect(crawlPriority(service)).toBeGreaterThan(
      crawlPriority("https://x.example/projects/some-finished-job/"),
    );
  });
});
