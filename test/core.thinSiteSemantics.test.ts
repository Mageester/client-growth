import { describe, expect, it } from "vitest";

import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { assessServiceCoverage } from "@/core/absenceVerification";
import { assessAnalysisReadiness } from "@/core/analysisReadiness";
import { classifyAnalysis } from "@/core/analysisOutcome";
import { assessCatalogCoverage } from "@/core/rules/registry";
import {
  ClientSchema,
  EvidenceBundleSchema,
  ServiceSchema,
  type EvidenceBundle,
} from "@/core/schema";

/**
 * "We looked everywhere and this business has no service pages" and "we could
 * not get far enough to tell" are the same silence with opposite meanings.
 *
 * Production said the second about kids-connect.ca, a four-page brochure site
 * the crawler read in its entirety. That sentence is untrue, and it invites an
 * agency to go and fix a setup that is not the problem. The whole point of this
 * distinction is that it must only fire when the crawl genuinely saw everything
 * — so most of the cases below are about it staying quiet.
 */

function bundle(p: {
  pages?: Array<{ url: string; title?: string; status?: number; wordCount?: number }>;
  links?: Array<{ href: string; label?: string }>;
  sitemapUrls?: string[];
  crawlExhaustive?: boolean;
  networkEvents?: Array<{ url: string; outcome: "blocked" | "inconclusive"; reason: string }>;
}): EvidenceBundle {
  return EvidenceBundleSchema.parse({
    clientId: "c1",
    source: "http",
    capturedAt: "2026-09-03T00:00:00.000Z",
    site: {
      pages: (p.pages ?? []).map((pg) => ({
        url: pg.url,
        status: pg.status ?? 200,
        title: pg.title ?? "",
        h1s: [],
        headings: [],
        textExcerpt: "",
        wordCount: pg.wordCount ?? 250,
        forms: [],
      })),
      nav: [],
      links: (p.links ?? []).map((l) => ({
        href: l.href,
        label: l.label ?? "",
        inNav: false,
        scheme: "http",
        foundOn: ["https://x.example/"],
      })),
      sitemapUrls: p.sitemapUrls ?? [],
      crawlExhaustive: p.crawlExhaustive ?? false,
    },
    networkEvents: p.networkEvents ?? [],
  });
}

const CLIENT = { offerings: ["daycare", "autism support"] };

const CATALOG = [
  ServiceSchema.parse({
    id: "svc-landing",
    name: "Landing page",
    description: "",
    priceMin: 900,
    priceMax: 1800,
    tags: ["landing-page"],
    active: true,
  }),
  ServiceSchema.parse({
    id: "svc-conversion",
    name: "Conversion fix",
    description: "",
    priceMin: 300,
    priceMax: 1000,
    tags: ["conversion-fix"],
    active: true,
  }),
];

/** The real kids-connect.ca shape: four pages, no services, nothing refused. */
const THIN_SITE = bundle({
  pages: [
    { url: "https://x.example/" },
    { url: "https://x.example/the-team/", title: "Autism Social Groups" },
    { url: "https://x.example/faq/", title: "Burnaby Social Play Groups" },
    { url: "https://x.example/contact-us-social-skills-near-you/", title: "Groups Near Me" },
  ],
  crawlExhaustive: true,
});

describe("a site with no service pages is a fact about the site", () => {
  it("says the site has no service pages, not that the crawl fell short", () => {
    const coverage = assessServiceCoverage({ client: CLIENT, evidence: THIN_SITE });

    expect(coverage.analyzable).toBe(false);
    expect(coverage.limitation).toBe("site-too-thin");
    expect(coverage.reason).toMatch(/no service pages/i);
    expect(coverage.reason).not.toMatch(/did not demonstrably reach/i);
  });

  it("reports the run truthfully", () => {
    const coverage = assessServiceCoverage({ client: CLIENT, evidence: THIN_SITE });
    const verdict = classifyAnalysis({
      evidence: THIN_SITE,
      analyzable: coverage.analyzable,
      coverageReason: coverage.reason,
      coverageLimitation: coverage.limitation,
      surfaced: 0,
      evaluatorErrors: 0,
      catalog: assessCatalogCoverage(CATALOG),
    });

    expect(verdict.outcome).toBe("inconclusive");
    expect(verdict.summary).toMatch(/no pages describing what the business sells/i);
    expect(verdict.summary).not.toMatch(/never reached/i);
    expect(verdict.limitation).toMatch(/not there|would change that/i);
  });

  it("does not tell the agency to fix a setup that is not the problem", () => {
    const readiness = assessAnalysisReadiness({
      catalog: CATALOG,
      offerings: 2,
      lastCrawl: {
        analyzable: false,
        readablePages: 4,
        suggestedOfferings: 0,
        limitation: "site-too-thin",
      },
    });

    const missingPage = readiness.rules.find((r) => r.ruleId === "missing-service-page")!;
    expect(missingPage.state).toBe("site_coverage_limited");
    expect(missingPage.actionable).toBe(false);
    expect(missingPage.reason).toMatch(/adding offerings will not change that/i);
    expect(missingPage.reason).not.toMatch(/limit of what the crawler could read/i);

    // And it still does not block the rule that has nothing to do with this.
    expect(readiness.rules.find((r) => r.ruleId === "broken-conversion-path")!.state).toBe("ready");
  });
});

describe("the claim is withheld whenever the crawl did not see everything", () => {
  it("stays with the weaker wording when the crawl was truncated", () => {
    const truncated = bundle({
      pages: [{ url: "https://x.example/" }, { url: "https://x.example/about/" }],
      crawlExhaustive: false,
    });

    const coverage = assessServiceCoverage({ client: CLIENT, evidence: truncated });
    expect(coverage.limitation).toBe("coverage-limited");
    expect(coverage.reason).toMatch(/did not demonstrably reach/i);
  });

  it("stays with the weaker wording for evidence recorded before this existed", () => {
    // A bundle persisted by an older deploy has no crawlExhaustive field at
    // all. It must default to the weaker claim, never the stronger one.
    const legacy = EvidenceBundleSchema.parse({
      clientId: "c1",
      source: "http",
      capturedAt: "2026-09-01T00:00:00.000Z",
      site: {
        pages: [
          {
            url: "https://x.example/",
            status: 200,
            title: "",
            h1s: [],
            headings: [],
            textExcerpt: "",
            wordCount: 300,
            forms: [],
          },
        ],
        nav: [],
        links: [],
        sitemapUrls: [],
      },
      networkEvents: [],
    });

    expect(legacy.site.crawlExhaustive).toBe(false);
    expect(assessServiceCoverage({ client: CLIENT, evidence: legacy }).limitation).toBe(
      "coverage-limited",
    );
  });
});

describe("the provider only claims an exhaustive crawl when it had one", () => {
  interface Route {
    status?: number;
    headers?: Record<string, string>;
    body?: string;
  }

  function siteFetch(routes: Record<string, Route>): typeof fetch {
    return (async (input: RequestInfo | URL): Promise<Response> => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const route = routes[url] ?? routes[url.replace(/\/$/, "")];
      if (!route) {
        return new Response("nope", { status: 404, headers: { "content-type": "text/html" } });
      }
      return new Response(route.body ?? "", {
        status: route.status ?? 200,
        headers: { "content-type": "text/html", ...(route.headers ?? {}) },
      });
    }) as typeof fetch;
  }

  const page = (title: string, links: string[] = []): Route => ({
    body: `<html><head><title>${title}</title></head><body><h1>${title}</h1>
      ${links.map((h) => `<a href="${h}">${h}</a>`).join("")}
      <p>${"word ".repeat(60)}</p></body></html>`,
  });

  const client = ClientSchema.parse({
    id: "c1",
    name: "C",
    domain: "example.com",
    offerings: ["daycare"],
    notes: "",
  });

  it("claims it after following every link on a small site", async () => {
    const evidence = await new HttpEvidenceProvider({
      fetchImpl: siteFetch({
        "https://example.com/": page("Home", ["/about", "/contact"]),
        "https://example.com/about": page("About"),
        "https://example.com/contact": page("Contact"),
        "https://example.com/sitemap.xml": { status: 404 },
      }),
    }).getEvidence(client);

    expect(evidence.site.crawlExhaustive).toBe(true);
  });

  it("does not claim it when the page budget ran out", async () => {
    const links = Array.from({ length: 20 }, (_, i) => `/p${i}`);
    const routes: Record<string, Route> = { "https://example.com/": page("Home", links) };
    for (const path of links) routes[`https://example.com${path}`] = page(path);
    routes["https://example.com/sitemap.xml"] = { status: 404 };

    const evidence = await new HttpEvidenceProvider({
      fetchImpl: siteFetch(routes),
      maxPages: 4,
    }).getEvidence(client);

    expect(evidence.site.crawlExhaustive).toBe(false);
  });

  it("does not claim it when anything was refused or unreadable", async () => {
    const evidence = await new HttpEvidenceProvider({
      fetchImpl: siteFetch({
        "https://example.com/": page("Home", ["/a", "https://evil.example.net/x"]),
        "https://example.com/a": {
          status: 301,
          headers: { location: "https://evil.example.net/a" },
        },
        "https://example.com/sitemap.xml": { status: 404 },
      }),
    }).getEvidence(client);

    expect(evidence.networkEvents.length).toBeGreaterThan(0);
    expect(evidence.site.crawlExhaustive).toBe(false);
  });

  it("does not claim it when nothing readable came back at all", async () => {
    const evidence = await new HttpEvidenceProvider({
      fetchImpl: siteFetch({ "https://example.com/": { status: 403 } }),
    }).getEvidence(client);

    expect(evidence.site.crawlExhaustive).toBe(false);
  });
});
