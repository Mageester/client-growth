import type { EvidenceProvider, ProbeResult } from "@/ports/EvidenceProvider";
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
 *  - same-origin pages only for the crawl
 *  - shallow breadth-first crawl, hard cap (~10 useful pages)
 *  - records HTTP status for every crawled URL, plus links (with scheme, nav
 *    flag, aria-label, and which pages they were found on) and <form>s
 *  - reads /sitemap.xml when cheaply available
 *  - exposes `fetchPage(url)` (targeted absence verification) and `probe(url)`
 *    (HEAD->GET status check for the broken-conversion-path rule)
 *  - no Lighthouse / PageSpeed / paid APIs
 *  - deterministic given a `fetchImpl`; unit-tested with in-memory HTML fixtures
 */

const DEFAULT_MAX_PAGES = 10;
const MAX_SITEMAP_URLS = 300;
const PROBE_TIMEOUT_MS = 8_000;
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

const emptyPage = (url: string, status: number): EvidencePage => ({
  url,
  status,
  title: "",
  h1s: [],
  headings: [],
  textExcerpt: "",
  wordCount: 0,
  forms: [],
});

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
    const linksByKey = new Map<string, EvidenceLink>();
    let htmlPages = 0;

    while (queue.length > 0 && htmlPages < maxPages) {
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

      if (!response.ok) {
        pages.push(emptyPage(url, response.status));
        continue;
      }
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.includes("text/html")) {
        pages.push(emptyPage(url, response.status));
        continue;
      }

      const parsed = parseHtml(await response.text(), url);
      pages.push({ ...parsed.page, status: response.status });
      htmlPages++;
      if (nav.length === 0 && parsed.nav.length > 0) nav = parsed.nav;

      for (const link of parsed.links) {
        const key = `${link.scheme}:${link.href}`;
        const existing = linksByKey.get(key);
        if (!existing) {
          linksByKey.set(key, { ...link, foundOn: [url] });
        } else {
          if (!existing.label && link.label) existing.label = link.label;
          if (!existing.ariaLabel && link.ariaLabel) existing.ariaLabel = link.ariaLabel;
          if (!existing.title && link.title) existing.title = link.title;
          if (link.inNav) existing.inNav = true;
          if (!existing.foundOn.includes(url)) existing.foundOn.push(url);
        }
        if (link.scheme === "http" && !visited.has(link.href) && !queue.includes(link.href)) {
          queue.push(link.href);
        }
      }
    }

    const sitemapUrls = await this.readSitemap(fetchImpl, origin);

    return EvidenceBundleSchema.parse({
      clientId: client.id,
      source: "http",
      capturedAt: (this.options.now?.() ?? new Date()).toISOString(),
      site: { pages, nav, links: [...linksByKey.values()], sitemapUrls },
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
    return { ...parseHtml(await response.text(), url).page, status: response.status };
  }

  /**
   * HEAD (falling back to GET on 405/501) status check for a single URL, with
   * redirects followed. `status: 0` means the request could not be completed
   * (DNS, TLS, timeout) — the caller must treat that as inconclusive.
   */
  async probe(url: string): Promise<ProbeResult> {
    const fetchImpl = this.resolveFetch();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const headers = { "user-agent": USER_AGENT };
    try {
      let res = await fetchImpl(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
        headers,
      });
      if (res.status === 405 || res.status === 501) {
        res = await fetchImpl(url, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
          headers,
        });
      }
      return { requestedUrl: url, status: res.status, finalUrl: res.url || url, ok: res.ok };
    } catch {
      return { requestedUrl: url, status: 0, finalUrl: url, ok: false };
    } finally {
      clearTimeout(timer);
    }
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
