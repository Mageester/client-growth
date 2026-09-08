import { describe, expect, it, vi } from "vitest";

import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { ClientSchema, type Client } from "@/core/schema";
import { crawlKey } from "@/adapters/evidence/urlPolicy";

/**
 * Crawl discovery on the shapes real small-business websites actually have.
 *
 * Every case here comes from the analyzability corpus, and every one of them
 * used to end with a crawl that read the homepage and stopped. The security
 * cases at the bottom are the other half of the same change: the boundary moved
 * by exactly one host, and nothing else about it moved at all.
 */

interface Route {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

function siteFetch(routes: Record<string, Route>): {
  fetchImpl: typeof fetch;
  requested: string[];
} {
  const requested: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requested.push(url);
    const route = routes[url] ?? routes[url.replace(/\/$/, "")];
    if (!route) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(route.status === 204 ? null : (route.body ?? ""), {
      status: route.status ?? 200,
      headers: { "content-type": "text/html", ...(route.headers ?? {}) },
    });
  }) as typeof fetch;
  return { fetchImpl, requested };
}

function page(title: string, links: string[] = [], nav = false): Route {
  const anchors = links.map((href) => `<a href="${href}">${href}</a>`).join("");
  return {
    body: `<html><head><title>${title}</title></head><body><h1>${title}</h1>
      ${nav ? `<nav>${anchors}</nav>` : anchors}
      <p>${"word ".repeat(60)}</p></body></html>`,
  };
}

const client = (domain: string, offerings: string[] = []): Client =>
  ClientSchema.parse({ id: "c1", name: "C", domain, offerings, notes: "" });

const urlsOf = (pages: Array<{ url: string }>) => pages.map((p) => p.url);

describe("apex and www are one website", () => {
  it("tries the allowed www sibling when the named apex returns no readable pages", async () => {
    const requested: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.startsWith("https://example.com/")) {
        throw new Error("origin timeout");
      }
      if (url.endsWith("/robots.txt") || url.endsWith("/sitemap.xml")) {
        return new Response("", { status: 404 });
      }
      return new Response(page("Recovered homepage").body, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch;

    const evidence = await new HttpEvidenceProvider({
      fetchImpl,
      requestTimeoutMs: 1,
      maxPages: 1,
    }).getEvidence(client("example.com"));

    expect(evidence.site.pages.map((entry) => entry.url)).toEqual([
      "https://www.example.com/",
    ]);
    expect(evidence.site.pages[0]?.wordCount).toBeGreaterThan(0);
    expect(requested).toContain("https://www.example.com/");
    expect(evidence.site.pages.some((entry) => entry.url.includes("example.com/"))).toBe(true);
  });

  it("treats a client-rendered HTML shell as unreadable evidence", async () => {
    const shell = `<!doctype html><html><head><title>Jesse's Plumbing</title></head>
      <body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>`;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt") || url.endsWith("/sitemap.xml")) {
        return new Response("", { status: 404, headers: { "content-type": "text/plain" } });
      }
      return new Response(shell, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }) as unknown as typeof fetch;

    const evidence = await new HttpEvidenceProvider({
      fetchImpl,
      maxPages: 1,
      maxRequests: 3,
    }).getEvidence(client("example.com"));

    expect(evidence.site.pages).toEqual([
      expect.objectContaining({
        url: "https://example.com/",
        status: 200,
        wordCount: 0,
      }),
    ]);
    expect(evidence.site.links).toEqual([]);
    expect(evidence.networkEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "js-shell",
          stage: "page",
          outcome: "inconclusive",
          status: 200,
        }),
      ]),
    );
  });

  it("follows a redirect from the apex host to its www sibling", async () => {
    const { fetchImpl } = siteFetch({
      "https://example.com/": page("Home", ["/services/drain-cleaning"]),
      "https://example.com/services/drain-cleaning": {
        status: 301,
        headers: { location: "https://www.example.com/services/drain-cleaning" },
      },
      "https://www.example.com/services/drain-cleaning": page("Drain Cleaning"),
    });

    const evidence = await new HttpEvidenceProvider({ fetchImpl }).getEvidence(client("example.com"));

    expect(urlsOf(evidence.site.pages)).toContain(
      "https://www.example.com/services/drain-cleaning",
    );
    expect(evidence.networkEvents.filter((e) => e.outcome === "blocked")).toHaveLength(0);
  });

  it("keeps links that point at the www host of the domain the agency typed", async () => {
    // altimadental.com serves an apex homepage carrying 482 anchors to www.
    const { fetchImpl } = siteFetch({
      "https://example.com/": page("Home", [
        "https://www.example.com/services/implants",
        "https://www.example.com/services/whitening",
      ]),
      "https://www.example.com/services/implants": page("Dental Implants"),
      "https://www.example.com/services/whitening": page("Teeth Whitening"),
    });

    const evidence = await new HttpEvidenceProvider({ fetchImpl }).getEvidence(client("example.com"));

    expect(evidence.site.pages).toHaveLength(3);
    expect(urlsOf(evidence.site.pages)).toEqual(
      expect.arrayContaining([
        "https://www.example.com/services/implants",
        "https://www.example.com/services/whitening",
      ]),
    );
  });

  it("does not fetch the same page twice under its apex and www names", async () => {
    const { fetchImpl, requested } = siteFetch({
      "https://example.com/": page("Home", ["https://www.example.com/", "/services/boilers"]),
      "https://www.example.com/": page("Home", ["/services/boilers"]),
      "https://example.com/services/boilers": page("Boilers"),
    });

    const evidence = await new HttpEvidenceProvider({ fetchImpl }).getEvidence(client("example.com"));

    // The homepage is one page however the site spells it.
    const homepages = evidence.site.pages.filter((p) => new URL(p.url).pathname === "/");
    expect(homepages).toHaveLength(1);
    expect(requested.filter((u) => new URL(u).pathname === "/")).toHaveLength(1);
  });

  it("counts a redirect target once, not once per URL that reaches it", async () => {
    // kids-connect.ca: /connect redirects to /contact-us-social-skills-near-you,
    // which is also linked directly. Counting it twice inflates every
    // page-count signal the coverage assessment reads.
    const { fetchImpl } = siteFetch({
      "https://example.com/": page("Home", ["/connect", "/contact-us"]),
      "https://example.com/connect": { status: 301, headers: { location: "/contact-us" } },
      "https://example.com/contact-us": page("Contact Us"),
    });

    const evidence = await new HttpEvidenceProvider({ fetchImpl }).getEvidence(client("example.com"));

    expect(
      evidence.site.pages.filter((p) => p.url === "https://example.com/contact-us"),
    ).toHaveLength(1);
  });
});

describe("the boundary is still a boundary", () => {
  it("refuses a redirect to a different registrable domain", async () => {
    const { fetchImpl } = siteFetch({
      "https://example.com/": page("Home", ["/services/x"]),
      "https://example.com/services/x": {
        status: 301,
        headers: { location: "https://evil.example.net/services/x" },
      },
    });

    const evidence = await new HttpEvidenceProvider({ fetchImpl }).getEvidence(client("example.com"));

    expect(urlsOf(evidence.site.pages)).not.toContain("https://evil.example.net/services/x");
    expect(evidence.networkEvents.some((e) => e.outcome === "blocked")).toBe(true);
  });

  it("refuses a redirect to a different subdomain of the same registrable domain", async () => {
    // Only the www sibling is the same site. blog. and shop. are not, and
    // neither is an attacker-chosen label.
    const { fetchImpl } = siteFetch({
      "https://example.com/": page("Home", ["/a", "/b"]),
      "https://example.com/a": { status: 301, headers: { location: "https://blog.example.com/a" } },
      "https://example.com/b": {
        status: 301,
        headers: { location: "https://internal.example.com/b" },
      },
    });

    const evidence = await new HttpEvidenceProvider({ fetchImpl }).getEvidence(client("example.com"));

    for (const url of urlsOf(evidence.site.pages)) {
      expect(url.startsWith("https://example.com")).toBe(true);
    }
    expect(evidence.networkEvents.filter((e) => e.outcome === "blocked").length).toBeGreaterThan(0);
  });

  it("refuses an https site being walked down to http", async () => {
    const { fetchImpl } = siteFetch({
      "https://example.com/": page("Home", ["/services/x"]),
      "https://example.com/services/x": {
        status: 301,
        headers: { location: "http://www.example.com/services/x" },
      },
    });

    const evidence = await new HttpEvidenceProvider({ fetchImpl }).getEvidence(client("example.com"));

    expect(urlsOf(evidence.site.pages)).not.toContain("http://www.example.com/services/x");
    expect(evidence.networkEvents.some((e) => e.reason.includes("boundary"))).toBe(true);
  });

  it("does not treat a host that merely starts with the domain as the same site", async () => {
    const { fetchImpl } = siteFetch({
      "https://example.com/": page("Home", ["https://example.com.evil.net/x", "https://wwwexample.com/x"]),
    });

    const evidence = await new HttpEvidenceProvider({ fetchImpl }).getEvidence(client("example.com"));

    expect(evidence.site.pages).toHaveLength(1);
    for (const link of evidence.site.links) {
      expect(new URL(link.href).hostname).toBe("example.com");
    }
  });
});

describe("frontier priority and budgets", () => {
  it("spends a Shopify-shaped page budget on the site's Services menu, not the earlier Shop menu", async () => {
    const servicePaths = [
      "/pages/hair-extensions",
      "/pages/colour-highlights",
      "/pages/balayage",
    ];
    const shopPaths = [
      "/collections/shampoo",
      "/collections/conditioner",
      "/collections/tools",
      "/collections/gift-cards",
    ];
    const serviceAnchors = servicePaths
      .map((path) => `<li><a href="${path}">${path.split("/").at(-1)}</a></li>`)
      .join("");
    const shopAnchors = shopPaths
      .map((path) => `<li><a href="${path}">${path.split("/").at(-1)}</a></li>`)
      .join("");
    const routes: Record<string, Route> = {
      "https://example.com/": {
        body: `<html><head><title>Salon</title></head><body><h1>Salon</h1>
          <nav>
            <details><summary>Shop</summary><ul>${shopAnchors}</ul></details>
            <details><summary>Services</summary><ul>${serviceAnchors}</ul></details>
          </nav><p>${"word ".repeat(60)}</p></body></html>`,
      },
    };
    for (const path of [...shopPaths, ...servicePaths]) {
      routes[`https://example.com${path}`] = page(path);
    }

    const evidence = await new HttpEvidenceProvider({
      fetchImpl: siteFetch(routes).fetchImpl,
      maxPages: 4,
    }).getEvidence(client("example.com"));

    expect(urlsOf(evidence.site.pages)).toEqual([
      "https://example.com/",
      ...servicePaths.map((path) => `https://example.com${path}`),
    ]);
    expect(
      evidence.site.links.filter((link) => link.inServiceNav).map((link) => link.href),
    ).toEqual(servicePaths.map((path) => `https://example.com${path}`));
  });

  it("collapses index files and trailing slashes before spending crawl slots", async () => {
    const { fetchImpl, requested } = siteFetch({
      "https://example.com/": page("Home", [
        "/index.html",
        "/index.htm",
        "/index.php",
        "/about/",
        "/about",
      ]),
      "https://example.com/about": page("About"),
    });

    const evidence = await new HttpEvidenceProvider({ fetchImpl, maxPages: 2 })
      .getEvidence(client("example.com"));

    expect(urlsOf(evidence.site.pages).map(crawlKey)).toEqual([
      "https://example.com/",
      "https://example.com/about",
    ]);
    expect(requested.filter((url) => crawlKey(url) === "https://example.com/about")).toHaveLength(1);
    expect(requested.filter((url) => /\/index\.(?:html?|php)$/i.test(url))).toHaveLength(0);
  });

  it("spends its page budget on services rather than on About and Careers", async () => {
    const boring = [
      "/about",
      "/careers",
      "/privacy-policy",
      "/terms",
      "/locations",
      "/reviews",
      "/gallery",
      "/financing",
      "/blog",
      "/team",
    ];
    const services = ["/services/one", "/services/two", "/services/three"];
    const routes: Record<string, Route> = {
      // The boring links come FIRST in the document, which is exactly how real
      // templates order them and exactly what breadth-first order followed.
      "https://example.com/": page("Home", [...boring, ...services], true),
    };
    for (const path of [...boring, ...services]) {
      routes[`https://example.com${path}`] = page(path);
    }

    const evidence = await new HttpEvidenceProvider({
      fetchImpl: siteFetch(routes).fetchImpl,
      maxPages: 5,
    }).getEvidence(client("example.com"));

    const fetched = urlsOf(evidence.site.pages);
    for (const path of services) {
      expect(fetched, path).toContain(`https://example.com${path}`);
    }
  });

  it("crawls service URLs the sitemap knows about but the homepage never links to", async () => {
    const { fetchImpl } = siteFetch({
      "https://example.com/": page("Home", ["/about"]),
      "https://example.com/about": page("About"),
      "https://example.com/sitemap.xml": {
        headers: { "content-type": "application/xml" },
        body: `<?xml version="1.0"?><urlset>
          <url><loc>https://example.com/</loc></url>
          <url><loc>https://example.com/services/gutter-cleaning</loc></url>
          <url><loc>https://example.com/services/roof-repair</loc></url>
        </urlset>`,
      },
      "https://example.com/services/gutter-cleaning": page("Gutter Cleaning"),
      "https://example.com/services/roof-repair": page("Roof Repair"),
    });

    const evidence = await new HttpEvidenceProvider({ fetchImpl }).getEvidence(client("example.com"));

    expect(urlsOf(evidence.site.pages)).toEqual(
      expect.arrayContaining([
        "https://example.com/services/gutter-cleaning",
        "https://example.com/services/roof-repair",
      ]),
    );
  });

  it("keeps sitemap URLs on the canonical host when the sitemap redirects there", async () => {
    // Real corpus case (lifescapecolorado.com): crawl origin www, but the
    // site's /sitemap.xml 301s to the apex host and the index's children are
    // apex URLs. The redirect policy treats apex and www as one site — the
    // sitemap reader must not be stricter than the crawl it feeds, or the
    // whole sitemap layer is silently lost and absence verification starts
    // claiming pages are missing when it just was never shown them.
    const { fetchImpl } = siteFetch({
      "https://www.example.com/": page("Home", ["/services/drain-cleaning"]),
      "https://www.example.com/services/drain-cleaning": page("Drain Cleaning"),
      "https://www.example.com/sitemap.xml": {
        status: 301,
        headers: { location: "https://example.com/sitemap.xml" },
      },
      "https://example.com/sitemap.xml": {
        headers: { "content-type": "application/xml" },
        body: `<?xml version="1.0"?><sitemapindex>
          <sitemap><loc>https://example.com/page-sitemap.xml</loc></sitemap>
        </sitemapindex>`,
      },
      "https://example.com/page-sitemap.xml": {
        headers: { "content-type": "application/xml" },
        body: `<?xml version="1.0"?><urlset>
          <url><loc>https://example.com/services/outdoor-lighting</loc></url>
        </urlset>`,
      },
      "https://example.com/services/outdoor-lighting": page("Outdoor Lighting"),
    });

    const evidence = await new HttpEvidenceProvider({ fetchImpl }).getEvidence(
      client("www.example.com"),
    );

    expect(evidence.site.sitemapUrls).toContain(
      "https://example.com/services/outdoor-lighting",
    );
    // And the crawl uses what the sitemap gave it.
    expect(urlsOf(evidence.site.pages)).toContain(
      "https://example.com/services/outdoor-lighting",
    );
  });

  it("still honours the page cap", async () => {
    const links = Array.from({ length: 40 }, (_, i) => `/services/s${i}`);
    const routes: Record<string, Route> = { "https://example.com/": page("Home", links) };
    for (const path of links) routes[`https://example.com${path}`] = page(path);

    const evidence = await new HttpEvidenceProvider({
      fetchImpl: siteFetch(routes).fetchImpl,
      maxPages: 4,
    }).getEvidence(client("example.com"));

    expect(evidence.site.pages.length).toBeLessThanOrEqual(4);
  });

  it("still honours the shared request budget across the whole run", async () => {
    const links = Array.from({ length: 40 }, (_, i) => `/services/s${i}`);
    const routes: Record<string, Route> = { "https://example.com/": page("Home", links) };
    for (const path of links) routes[`https://example.com${path}`] = page(path);
    const { fetchImpl, requested } = siteFetch(routes);

    const provider = new HttpEvidenceProvider({ fetchImpl, maxRequests: 5 });
    await provider.getEvidence(client("example.com"));
    // The budget is shared with targeted verification and probes, so a run that
    // exhausted it during the crawl must not be able to buy more afterwards.
    await provider.fetchPage("https://example.com/services/s0");
    await provider.probe("https://example.com/services/s1");

    expect(requested.length).toBeLessThanOrEqual(5);
  });

  it("still refuses a response body over the cap", async () => {
    const { fetchImpl } = siteFetch({
      "https://example.com/": { body: "x".repeat(2_000) },
    });

    const evidence = await new HttpEvidenceProvider({
      fetchImpl,
      maxResponseBytes: 1_000,
    }).getEvidence(client("example.com"));

    expect(evidence.site.pages[0]?.wordCount).toBe(0);
    expect(evidence.networkEvents.some((e) => e.reason.includes("exceeds"))).toBe(true);
  });
});
