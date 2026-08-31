import type { EvidenceProvider } from "@/ports/EvidenceProvider";
import {
  EvidenceBundleSchema,
  type Client,
  type EvidenceBundle,
  type EvidenceLink,
  type EvidencePage,
} from "@/core/schema";
import { parseHtml } from "@/adapters/evidence/parseHtml";

/**
 * Minimal real website evidence provider.
 *
 *  - standard HTTP `fetch` only (no browser, no rendering, no screenshots)
 *  - same-origin pages only
 *  - shallow breadth-first crawl, hard cap (~10 useful pages)
 *  - collects every same-origin link (href + anchor text) for absence verification
 *  - reads /sitemap.xml when cheaply available
 *  - exposes `fetchPage(url)` so the rule can pull one specific page during
 *    targeted verification without a second crawl
 *  - no Lighthouse / PageSpeed / paid APIs
 *  - deterministic given a `fetchImpl`; unit-tested with in-memory HTML fixtures
 */

const DEFAULT_MAX_PAGES = 10;
const MAX_SITEMAP_URLS = 300;
const USER_AGENT = "ClientGrowthBot/0.1 (+website evidence; operated by the agency)";

export interface HttpEvidenceProviderOptions {
  fetchImpl?: typeof fetch;
  maxPages?: number;
  now?: () => Date;
}

function toOrigin(domain: string): string {
  const trimmed = domain.trim().replace(/\/+$/, "");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withScheme).origin;
}

export class HttpEvidenceProvider implements EvidenceProvider {
  constructor(private readonly options: HttpEvidenceProviderOptions = {}) {}

  private resolveFetch(): typeof fetch {
    const rawFetch = this.options.fetchImpl ?? globalThis.fetch;
    if (typeof rawFetch !== "function") {
      throw new Error("HttpEvidenceProvider: no fetch implementation available");
    }
    return this.options.fetchImpl ?? rawFetch.bind(globalThis);
  }

  async getEvidence(client: Client): Promise<EvidenceBundle> {
    const fetchImpl = this.resolveFetch();
    const maxPages = this.options.maxPages ?? DEFAULT_MAX_PAGES;
    const origin = toOrigin(client.domain);

    const visited = new Set<string>();
    const queue: string[] = [`${origin}/`];
    const pages: EvidencePage[] = [];
    let nav: string[] = [];
    const linksByHref = new Map<string, EvidenceLink>();

    while (queue.length > 0 && pages.length < maxPages) {
      const url = queue.shift();
      if (url === undefined || visited.has(url)) continue;
      visited.add(url);

      let response: Response;
      try {
        response = await fetchImpl(url, {
          redirect: "follow",
          headers: { "user-agent": USER_AGENT, accept: "text/html" },
        });
      } catch {
        continue;
      }
      if (!response.ok) continue;
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.includes("text/html")) continue;

      const parsed = parseHtml(await response.text(), url);
      pages.push(parsed.page);
      if (nav.length === 0 && parsed.nav.length > 0) nav = parsed.nav;

      for (const link of parsed.links) {
        const existing = linksByHref.get(link.href);
        if (!existing) {
          linksByHref.set(link.href, { ...link });
        } else {
          if (!existing.label && link.label) existing.label = link.label;
          if (link.inNav) existing.inNav = true;
        }
        if (!visited.has(link.href) && !queue.includes(link.href)) queue.push(link.href);
      }
    }

    const sitemapUrls = await this.readSitemap(fetchImpl, origin);

    return EvidenceBundleSchema.parse({
      clientId: client.id,
      source: "http",
      capturedAt: (this.options.now?.() ?? new Date()).toISOString(),
      site: {
        pages,
        nav,
        links: [...linksByHref.values()],
        sitemapUrls,
      },
    });
  }

  /** Fetch and parse one specific URL. Used by targeted absence verification. */
  async fetchPage(url: string): Promise<EvidencePage | null> {
    const fetchImpl = this.resolveFetch();
    let response: Response;
    try {
      response = await fetchImpl(url, {
        redirect: "follow",
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("text/html")) return null;
    return parseHtml(await response.text(), url).page;
  }

  /** Best-effort /sitemap.xml read (follows one level of sitemap index). */
  private async readSitemap(fetchImpl: typeof fetch, origin: string): Promise<string[]> {
    const collect = async (sitemapUrl: string): Promise<{ locs: string[]; isIndex: boolean }> => {
      try {
        const res = await fetchImpl(sitemapUrl, {
          redirect: "follow",
          headers: { "user-agent": USER_AGENT },
        });
        if (!res.ok) return { locs: [], isIndex: false };
        const xml = await res.text();
        const locs: string[] = [];
        const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(xml)) !== null) {
          if (m[1]) locs.push(m[1]);
        }
        return { locs, isIndex: /<sitemapindex[\s>]/i.test(xml) };
      } catch {
        return { locs: [], isIndex: false };
      }
    };

    const root = await collect(`${origin}/sitemap.xml`);
    let urls = root.locs;
    if (root.isIndex) {
      const children = root.locs.filter((u) => u.startsWith(origin)).slice(0, 2);
      urls = [];
      for (const child of children) {
        urls.push(...(await collect(child)).locs);
      }
    }
    return urls.filter((u) => u.startsWith(origin)).slice(0, MAX_SITEMAP_URLS);
  }
}
