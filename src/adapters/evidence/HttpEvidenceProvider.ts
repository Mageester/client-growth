import type { EvidenceProvider } from "@/ports/EvidenceProvider";
import {
  EvidenceBundleSchema,
  type Client,
  type EvidenceBundle,
  type EvidencePage,
} from "@/core/schema";
import { parseHtml } from "@/adapters/evidence/parseHtml";

/**
 * Minimal real website evidence provider.
 *
 *  - standard HTTP `fetch` only (no browser, no rendering, no screenshots)
 *  - same-origin pages only
 *  - shallow breadth-first crawl, hard cap (~10 useful pages)
 *  - extracts URL, title, H1/headings, nav labels, short text excerpt
 *  - no Lighthouse / PageSpeed / paid APIs
 *  - deterministic given a `fetchImpl`; unit-tested with in-memory HTML fixtures
 *
 * `fetchImpl` is injectable so the default test suite can exercise it with zero
 * network. It is only pointed at the real network by explicit live runs.
 */

const DEFAULT_MAX_PAGES = 10;
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

  async getEvidence(client: Client): Promise<EvidenceBundle> {
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("HttpEvidenceProvider: no fetch implementation available");
    }
    const maxPages = this.options.maxPages ?? DEFAULT_MAX_PAGES;
    const origin = toOrigin(client.domain);

    const visited = new Set<string>();
    const queue: string[] = [`${origin}/`];
    const pages: EvidencePage[] = [];
    let nav: string[] = [];

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

      for (const link of parsed.sameOriginLinks) {
        if (!visited.has(link) && !queue.includes(link)) queue.push(link);
      }
    }

    return EvidenceBundleSchema.parse({
      clientId: client.id,
      source: "http",
      capturedAt: (this.options.now?.() ?? new Date()).toISOString(),
      site: { pages, nav },
    });
  }
}
