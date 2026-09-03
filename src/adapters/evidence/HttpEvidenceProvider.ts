import type {
  EvidenceProvider,
  PageFetchFailure,
  ProbeResult,
} from "@/ports/EvidenceProvider";
import {
  EvidenceBundleSchema,
  type Client,
  type EvidenceBundle,
  type EvidenceLink,
  type EvidenceNetworkEvent,
  type EvidencePage,
} from "@/core/schema";
import { parseHtml } from "@/adapters/evidence/parseHtml";
import {
  crawlKey,
  isSameSite,
  normalizeAndValidateUrl,
  normalizeOrigin,
  redactUrl,
  type UrlPolicyFailure,
} from "@/adapters/evidence/urlPolicy";
import { crawlPriority, isServiceHub, looksLikeServiceUrl } from "@/core/siteStructure";

/**
 * Minimal real website evidence provider.
 *
 *  - standard HTTP `fetch` only (no browser, no rendering, no screenshots)
 *  - same-SITE pages only for the crawl: the host the agency named, or its
 *    `www.` sibling, and nothing else (see isSameSite in urlPolicy.ts)
 *  - shallow crawl, hard cap (~10 useful pages), frontier ordered so the pages
 *    that describe what the business sells are fetched before its About page
 *  - records HTTP status for every crawled URL, plus links (with scheme, nav
 *    flag, aria-label, and which pages they were found on) and <form>s
 *  - reads /sitemap.xml when cheaply available, BEFORE the crawl spends its
 *    page budget, so service URLs the sitemap knows about can be crawled
 *  - exposes `fetchPage(url)` (targeted absence verification) and `probe(url)`
 *    (HEAD->GET status check for the broken-conversion-path rule)
 *  - no Lighthouse / PageSpeed / paid APIs
 *  - deterministic given a `fetchImpl`; unit-tested with in-memory HTML fixtures
 *
 * Every request goes through the bounded/manual redirect path below. The URL
 * policy is intentionally hostname/IP-literal based: Cloudflare Workers does
 * not expose authoritative DNS resolution for arbitrary hostnames before
 * fetch, so this layer cannot prove that a public-looking hostname will not
 * resolve or rebind to a private address.
 */

const DEFAULT_MAX_PAGES = 10;
const DEFAULT_MAX_SITEMAP_URLS = 100;
/**
 * Body cap. This is a memory bound, not a policy: it exists so one enormous
 * response cannot exhaust a Worker. It was 1MB, and on a corpus of 24 real
 * small-business sites that refused three homepages (1.01-1.08MB) and one
 * sitemap (1.02MB) outright — the cap, not the sites, was the limiter.
 */
const DEFAULT_MAX_RESPONSE_BYTES = 2_500_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_REQUESTS = 40;
const MAX_SITEMAP_INDEX_CHILDREN = 2;

export const DEFAULT_USER_AGENT =
  "ClientGrowthBot/0.1 (+website evidence; operated by the agency)";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface HttpEvidenceProviderOptions {
  fetchImpl?: typeof fetch;
  maxPages?: number;
  maxSitemapUrls?: number;
  maxResponseBytes?: number;
  requestTimeoutMs?: number;
  maxRedirects?: number;
  /** Shared request budget across crawl, sitemap, verification, and probes. */
  maxRequests?: number;
  /** Optional override for integrations; defaults to DEFAULT_USER_AGENT. */
  userAgent?: string;
  now?: () => Date;
}

interface SafeResponse {
  kind: "response";
  response: Response;
  finalUrl: string;
  redirects: number;
}

interface RequestFailure {
  kind: "failure";
  outcome: "blocked" | "inconclusive";
  url: string;
  reason: string;
  redirects: number;
}

type SafeRequestResult = SafeResponse | RequestFailure;

type BodyReadResult =
  | { ok: true; text: string }
  | { ok: false; outcome: "inconclusive"; reason: string };

function nonNegativeInt(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function positiveInt(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
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

function isHtmlContentType(value: string): boolean {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "text/html" || mediaType === "application/xhtml+xml";
}

function isXmlContentType(value: string): boolean {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    mediaType === "application/xml" ||
    mediaType === "text/xml" ||
    mediaType === "text/plain" ||
    mediaType.endsWith("+xml")
  );
}

function isRedirectStatus(status: number): boolean {
  return REDIRECT_STATUSES.has(status);
}

function contentLengthExceeds(response: Response, maxBytes: number): boolean {
  const raw = response.headers.get("content-length");
  if (!raw) return false;
  const length = Number(raw.trim());
  return Number.isSafeInteger(length) && length >= 0 && length > maxBytes;
}

function cancelResponseBody(response: Response): void {
  try {
    const cancellation = response.body?.cancel();
    void cancellation?.catch(() => {
      // Best-effort cancellation only.
    });
  } catch {
    // Body cancellation is best-effort; the policy decision has already been
    // made and must not turn into a website defect if cancellation is absent.
  }
}

function policyFailure(
  input: string | URL,
  result: UrlPolicyFailure,
  redirects = 0,
): RequestFailure {
  return {
    kind: "failure",
    outcome: "blocked",
    url: redactUrl(input),
    reason: result.reason,
    redirects,
  };
}

function originFailure(input: string | URL, redirects: number): RequestFailure {
  return {
    kind: "failure",
    outcome: "blocked",
    url: redactUrl(input),
    reason: "redirect leaves the allowed same-site boundary",
    redirects,
  };
}

function requestBudgetFailure(input: string | URL, redirects: number): RequestFailure {
  return {
    kind: "failure",
    outcome: "inconclusive",
    url: redactUrl(input),
    reason: "request budget exhausted",
    redirects,
  };
}

function pageFetchFailure(url: string | URL, failure: RequestFailure | {
  outcome: "blocked" | "inconclusive";
  reason: string;
}): PageFetchFailure {
  return {
    kind: "network-failure",
    requestedUrl: redactUrl(url),
    outcome: failure.outcome,
    reason: failure.reason,
  };
}

export class HttpEvidenceProvider implements EvidenceProvider {
  private requestBudgetRemaining: number | null = null;
  private networkEvents: EvidenceNetworkEvent[] = [];
  private lastEvidence: EvidenceBundle | null = null;

  constructor(private readonly options: HttpEvidenceProviderOptions = {}) {}

  private resolveFetch(): typeof fetch {
    const rawFetch = this.options.fetchImpl ?? globalThis.fetch;
    if (typeof rawFetch !== "function") {
      throw new Error("HttpEvidenceProvider: no fetch implementation available");
    }
    return this.options.fetchImpl ?? rawFetch.bind(globalThis);
  }

  private userAgent(): string {
    const configured = this.options.userAgent?.trim();
    return configured || DEFAULT_USER_AGENT;
  }

  private maxPages(): number {
    return Math.min(nonNegativeInt(this.options.maxPages, DEFAULT_MAX_PAGES), DEFAULT_MAX_PAGES);
  }

  private maxSitemapUrls(): number {
    return Math.min(
      nonNegativeInt(this.options.maxSitemapUrls, DEFAULT_MAX_SITEMAP_URLS),
      DEFAULT_MAX_SITEMAP_URLS,
    );
  }

  private maxResponseBytes(): number {
    return Math.min(
      positiveInt(this.options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES),
      DEFAULT_MAX_RESPONSE_BYTES,
    );
  }

  private requestTimeoutMs(): number {
    return Math.min(
      positiveInt(this.options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
      DEFAULT_REQUEST_TIMEOUT_MS,
    );
  }

  private maxRedirects(): number {
    return Math.min(nonNegativeInt(this.options.maxRedirects, DEFAULT_MAX_REDIRECTS), DEFAULT_MAX_REDIRECTS);
  }

  private maxRequests(): number {
    return Math.min(nonNegativeInt(this.options.maxRequests, DEFAULT_MAX_REQUESTS), DEFAULT_MAX_REQUESTS);
  }

  private startRun(): void {
    this.requestBudgetRemaining = this.maxRequests();
    this.networkEvents = [];
    this.lastEvidence = null;
  }

  private ensureRun(): void {
    if (this.requestBudgetRemaining === null) this.startRun();
  }

  private consumeRequest(input: string | URL, redirects: number): RequestFailure | null {
    this.ensureRun();
    if ((this.requestBudgetRemaining ?? 0) <= 0) {
      return requestBudgetFailure(input, redirects);
    }
    this.requestBudgetRemaining = (this.requestBudgetRemaining ?? 1) - 1;
    return null;
  }

  private recordNetworkEvent(
    url: string | URL,
    outcome: "blocked" | "inconclusive",
    reason: string,
  ): void {
    const event: EvidenceNetworkEvent = { url: redactUrl(url), outcome, reason };
    this.networkEvents.push(event);
    if (this.lastEvidence) this.lastEvidence.networkEvents.push(event);
  }

  private recordFailure(failure: RequestFailure): void {
    this.recordNetworkEvent(failure.url, failure.outcome, failure.reason);
  }

  /**
   * Fetch one URL with manual redirects. Each hop is parsed and policy-checked
   * before its request is issued. The request budget is charged per hop.
   */
  private async safeRequest(
    input: string | URL,
    init: RequestInit,
    allowedOrigin?: string,
  ): Promise<SafeRequestResult> {
    this.ensureRun();

    const initial = normalizeAndValidateUrl(input);
    if (!initial.ok) return policyFailure(input, initial);
    if (allowedOrigin && !isSameSite(initial.url, allowedOrigin)) {
      return originFailure(initial.url, 0);
    }

    const fetchImpl = this.resolveFetch();
    const initialUrl = initial.url.toString();
    let current = initialUrl;
    let redirects = 0;

    for (;;) {
      if (allowedOrigin && current !== initialUrl && !isSameSite(current, allowedOrigin)) {
        return originFailure(current, redirects);
      }

      const budgetFailure = this.consumeRequest(current, redirects);
      if (budgetFailure) return budgetFailure;

      const controller = new AbortController();
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const requestTimeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error("request timeout"));
        }, this.requestTimeoutMs());
      });

      let response: Response;
      try {
        response = await Promise.race([
          fetchImpl(current, {
            ...init,
            redirect: "manual",
            signal: controller.signal,
          }),
          requestTimeout,
        ]);
        if (timedOut) {
          await cancelResponseBody(response);
          return {
            kind: "failure",
            outcome: "inconclusive",
            url: redactUrl(current),
            reason: "request timeout",
            redirects,
          };
        }
      } catch {
        return {
          kind: "failure",
          outcome: "inconclusive",
          url: redactUrl(current),
          reason: timedOut ? "request timeout" : "network request failed",
          redirects,
        };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }

      // A custom fetch implementation must not be able to silently replace
      // manual redirects with automatic ones. Validate any final response URL
      // exposed by the runtime before accepting its body.
      const responseUrl = response.url?.trim();
      if (responseUrl && responseUrl !== current) {
        const observed = normalizeAndValidateUrl(responseUrl);
        if (!observed.ok) {
          await cancelResponseBody(response);
          return policyFailure(responseUrl, observed, redirects);
        }
        if (allowedOrigin && !isSameSite(observed.url, allowedOrigin)) {
          await cancelResponseBody(response);
          return originFailure(observed.url, redirects);
        }
        if (observed.url.toString() !== current) {
          await cancelResponseBody(response);
          return {
            kind: "failure",
            outcome: "inconclusive",
            url: redactUrl(observed.url),
            reason: "fetch reported a redirect without a manually validated Location",
            redirects,
          };
        }
      }

      if (!isRedirectStatus(response.status)) {
        return { kind: "response", response, finalUrl: current, redirects };
      }

      if (redirects >= this.maxRedirects()) {
        await cancelResponseBody(response);
        return {
          kind: "failure",
          outcome: "inconclusive",
          url: redactUrl(current),
          reason: `redirect limit of ${this.maxRedirects()} hops exhausted`,
          redirects,
        };
      }

      const location = response.headers.get("location")?.trim();
      if (!location) {
        await cancelResponseBody(response);
        return {
          kind: "failure",
          outcome: "inconclusive",
          url: redactUrl(current),
          reason: "redirect response has no valid Location header",
          redirects,
        };
      }

      const next = normalizeAndValidateUrl(location, current);
      if (!next.ok) {
        await cancelResponseBody(response);
        return policyFailure(location, next, redirects);
      }
      if (allowedOrigin && !isSameSite(next.url, allowedOrigin)) {
        await cancelResponseBody(response);
        return originFailure(next.url, redirects + 1);
      }

      await cancelResponseBody(response);
      current = next.url.toString();
      redirects++;
    }
  }

  private async readBoundedText(response: Response): Promise<BodyReadResult> {
    const maxBytes = this.maxResponseBytes();
    if (contentLengthExceeds(response, maxBytes)) {
      await cancelResponseBody(response);
      return {
        ok: false,
        outcome: "inconclusive",
        reason: `response Content-Length exceeds ${maxBytes} bytes`,
      };
    }

    if (!response.body) return { ok: true, text: "" };

    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = response.body.getReader();
    } catch {
      cancelResponseBody(response);
      return {
        ok: false,
        outcome: "inconclusive",
        reason: "response body could not be read",
      };
    }
    const cancelReader = (reason: string): void => {
      try {
        void reader.cancel(reason).catch(() => {
          // Best-effort cancellation only.
        });
      } catch {
        // Best-effort cancellation only.
      }
    };
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let totalBytes = 0;
    let timedOut = false;
    let bodyTimer: ReturnType<typeof setTimeout> | undefined;
    const bodyTimeout = new Promise<never>((_, reject) => {
      bodyTimer = setTimeout(() => {
        timedOut = true;
        cancelReader("response body timeout");
        reject(new Error("response body timeout"));
      }, this.requestTimeoutMs());
    });
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), bodyTimeout]);
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          cancelReader("response body byte cap exceeded");
          return {
            ok: false,
            outcome: "inconclusive",
            reason: `response body exceeds ${maxBytes} bytes`,
          };
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return { ok: true, text: chunks.join("") };
    } catch {
      cancelReader("response body could not be read");
      return {
        ok: false,
        outcome: "inconclusive",
        reason: timedOut ? "response body timeout" : "response body could not be read",
      };
    } finally {
      if (bodyTimer !== undefined) clearTimeout(bodyTimer);
      try {
        reader.releaseLock();
      } catch {
        // Best-effort reader cleanup only.
      }
    }
  }

  async getEvidence(client: Client): Promise<EvidenceBundle> {
    this.startRun();
    const capturedAt = (this.options.now?.() ?? new Date()).toISOString();
    const originResult = normalizeOrigin(client.domain);
    if (!originResult.ok) {
      this.recordNetworkEvent(client.domain, "blocked", originResult.reason);
      const blocked = EvidenceBundleSchema.parse({
        clientId: client.id,
        source: "http",
        capturedAt,
        site: { pages: [], nav: [], links: [], sitemapUrls: [] },
        networkEvents: this.networkEvents,
      });
      this.lastEvidence = blocked;
      return blocked;
    }

    const fetchHeaders = {
      "user-agent": this.userAgent(),
      accept: "text/html,application/xhtml+xml",
    };
    const origin = originResult.url.origin;
    const visited = new Set<string>();
    const seenFinalUrls = new Set<string>();
    const pages: EvidencePage[] = [];
    const linksByKey = new Map<string, EvidenceLink>();
    let nav: string[] = [];
    let pageRequests = 0;

    // The frontier is ordered, not first-in-first-out. Every site has more
    // links than this crawl has page fetches, so the question is never "which
    // links exist" but "which ten are worth reading", and template order puts
    // Careers and Privacy Policy ahead of the services. See crawlPriority.
    const frontier = new Map<string, { priority: number; discovered: number }>();
    let discovered = 0;
    const enqueue = (rawUrl: string, options: { inNav?: boolean } = {}): void => {
      const parsed = normalizeAndValidateUrl(rawUrl);
      if (!parsed.ok || !isSameSite(parsed.url, origin)) return;
      const url = parsed.url.toString();
      if (visited.has(crawlKey(url))) return;
      const priority = crawlPriority(url, options);
      const existing = frontier.get(url);
      // A URL found in several places keeps its best score: a service page that
      // is also in the navigation should not be demoted by the second sighting.
      if (existing && existing.priority >= priority) return;
      frontier.set(url, { priority, discovered: existing?.discovered ?? discovered++ });
    };

    const takeNext = (): string | undefined => {
      let best: string | undefined;
      let bestKey = { priority: Number.NEGATIVE_INFINITY, discovered: Number.POSITIVE_INFINITY };
      for (const [url, key] of frontier) {
        if (
          key.priority > bestKey.priority ||
          (key.priority === bestKey.priority && key.discovered < bestKey.discovered)
        ) {
          best = url;
          bestKey = key;
        }
      }
      if (best !== undefined) frontier.delete(best);
      return best;
    };

    enqueue(`${origin}/`);

    // The sitemap is read BEFORE the page budget is spent, not after. It costs
    // the same request either way, and reading it first is the difference
    // between knowing a site has /services/heat-pumps and finding out once
    // there is no budget left to fetch it.
    const sitemapUrls = await this.readSitemap(origin);
    for (const url of sitemapUrls) {
      if (looksLikeServiceUrl(url) || isServiceHub(url)) enqueue(url);
    }

    while (pageRequests < this.maxPages()) {
      const url = takeNext();
      if (url === undefined) break;
      if (visited.has(crawlKey(url))) continue;
      visited.add(crawlKey(url));
      pageRequests++;

      const fetched = await this.safeRequest(url, { headers: fetchHeaders }, origin);
      if (fetched.kind === "failure") {
        this.recordFailure(fetched);
        continue;
      }

      const { response, finalUrl } = fetched;
      // Redirects mean two requested URLs can land on one page (/connect ->
      // /contact-us). Counting that page twice would inflate every page-count
      // signal the coverage assessment reads.
      visited.add(crawlKey(finalUrl));
      const duplicate = seenFinalUrls.has(crawlKey(finalUrl));
      seenFinalUrls.add(crawlKey(finalUrl));

      if (!response.ok) {
        await cancelResponseBody(response);
        if (!duplicate) pages.push(emptyPage(finalUrl, response.status));
        continue;
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!isHtmlContentType(contentType)) {
        await cancelResponseBody(response);
        this.recordNetworkEvent(
          finalUrl,
          "inconclusive",
          `response content type is not crawlable HTML/XHTML: ${contentType || "missing"}`,
        );
        if (!duplicate) pages.push(emptyPage(finalUrl, response.status));
        continue;
      }

      const body = await this.readBoundedText(response);
      if (!body.ok) {
        this.recordNetworkEvent(finalUrl, body.outcome, body.reason);
        if (!duplicate) pages.push(emptyPage(finalUrl, response.status));
        continue;
      }

      const parsed = parseHtml(body.text, finalUrl);
      if (!duplicate) pages.push({ ...parsed.page, status: response.status });
      if (nav.length === 0 && parsed.nav.length > 0) nav = parsed.nav;

      for (const link of parsed.links) {
        const key = `${link.scheme}:${link.href}`;
        const existing = linksByKey.get(key);
        if (!existing) {
          linksByKey.set(key, { ...link, foundOn: [finalUrl] });
        } else {
          if (!existing.label && link.label) existing.label = link.label;
          if (!existing.ariaLabel && link.ariaLabel) existing.ariaLabel = link.ariaLabel;
          if (!existing.title && link.title) existing.title = link.title;
          if (link.inNav) existing.inNav = true;
          if (!existing.foundOn.includes(finalUrl)) existing.foundOn.push(finalUrl);
        }

        if (link.scheme !== "http") continue;
        enqueue(link.href, { inNav: link.inNav });
      }
    }

    // Did we see the whole site, or just as much of it as we could afford?
    //
    // The frontier being empty means every same-site link we found had already
    // been fetched — we ran out of site, not out of budget. Combined with a
    // clean network record and at least one readable page, that is the only
    // honest basis for saying "this business has no service pages" rather than
    // "we could not get far enough to tell".
    const crawlExhaustive =
      frontier.size === 0 &&
      pageRequests < this.maxPages() &&
      this.networkEvents.length === 0 &&
      pages.some((page) => page.status >= 200 && page.status < 300 && page.wordCount > 0);

    const bundle = EvidenceBundleSchema.parse({
      clientId: client.id,
      source: "http",
      capturedAt,
      site: { pages, nav, links: [...linksByKey.values()], sitemapUrls, crawlExhaustive },
      networkEvents: this.networkEvents,
    });
    this.lastEvidence = bundle;
    return bundle;
  }

  /** Fetch and parse one specific URL. Used by targeted absence verification. */
  async fetchPage(url: string): Promise<EvidencePage | PageFetchFailure | null> {
    this.ensureRun();
    const initial = normalizeAndValidateUrl(url);
    if (!initial.ok) {
      const failure = policyFailure(url, initial);
      this.recordFailure(failure);
      return pageFetchFailure(url, failure);
    }

    const fetched = await this.safeRequest(
      initial.url,
      {
        headers: {
          "user-agent": this.userAgent(),
          accept: "text/html,application/xhtml+xml",
        },
      },
      initial.url.origin,
    );
    if (fetched.kind === "failure") {
      this.recordFailure(fetched);
      return pageFetchFailure(url, fetched);
    }

    const { response, finalUrl } = fetched;
    if (!response.ok) {
      await cancelResponseBody(response);
      if (response.status === 404 || response.status === 410) return null;

      const reason = `targeted page returned HTTP ${response.status}`;
      this.recordNetworkEvent(finalUrl, "inconclusive", reason);
      return pageFetchFailure(finalUrl, { outcome: "inconclusive", reason });
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!isHtmlContentType(contentType)) {
      await cancelResponseBody(response);
      this.recordNetworkEvent(
        finalUrl,
        "inconclusive",
        `response content type is not crawlable HTML/XHTML: ${contentType || "missing"}`,
      );
      return pageFetchFailure(finalUrl, {
        outcome: "inconclusive",
        reason: `response content type is not crawlable HTML/XHTML: ${contentType || "missing"}`,
      });
    }

    const body = await this.readBoundedText(response);
    if (!body.ok) {
      this.recordNetworkEvent(finalUrl, body.outcome, body.reason);
      return pageFetchFailure(finalUrl, body);
    }
    return { ...parseHtml(body.text, finalUrl).page, status: response.status };
  }

  /**
   * HEAD (falling back to GET on 405/501) status check for a single URL, with
   * every redirect validated. `status: 0` means the request could not be
   * completed or trusted; the caller must treat that as inconclusive.
   */
  async probe(url: string): Promise<ProbeResult> {
    this.ensureRun();
    const initial = normalizeAndValidateUrl(url);
    if (!initial.ok) {
      const failure = policyFailure(url, initial);
      this.recordFailure(failure);
      return {
        requestedUrl: redactUrl(url),
        status: 0,
        finalUrl: redactUrl(url),
        ok: false,
        outcome: failure.outcome,
        reason: failure.reason,
        redirects: failure.redirects,
      };
    }

    const headers = { "user-agent": this.userAgent() };
    const request = async (method: "HEAD" | "GET"): Promise<SafeRequestResult> =>
      this.safeRequest(initial.url, { method, headers }, initial.url.origin);

    const head = await request("HEAD");
    if (head.kind === "failure") {
      this.recordFailure(head);
      return {
        requestedUrl: initial.url.toString(),
        status: 0,
        finalUrl: initial.url.toString(),
        ok: false,
        outcome: head.outcome,
        reason: head.reason,
        redirects: head.redirects,
      };
    }

    if (head.response.status === 405 || head.response.status === 501) {
      await cancelResponseBody(head.response);
      const get = await request("GET");
      if (get.kind === "failure") {
        this.recordFailure(get);
        return {
          requestedUrl: initial.url.toString(),
          status: 0,
          finalUrl: initial.url.toString(),
          ok: false,
          outcome: get.outcome,
          reason: get.reason,
          redirects: get.redirects,
        };
      }
      const result = {
        requestedUrl: initial.url.toString(),
        status: get.response.status,
        finalUrl: get.finalUrl,
        ok: get.response.ok,
        outcome: "complete" as const,
        redirects: get.redirects,
      };
      await cancelResponseBody(get.response);
      return result;
    }

    const result = {
      requestedUrl: initial.url.toString(),
      status: head.response.status,
      finalUrl: head.finalUrl,
      ok: head.response.ok,
      outcome: "complete" as const,
      redirects: head.redirects,
    };
    await cancelResponseBody(head.response);
    return result;
  }

  /** Best-effort /sitemap.xml read (follows one level of sitemap index). */
  private async readSitemap(origin: string): Promise<string[]> {
    const maxUrls = this.maxSitemapUrls();
    if (maxUrls === 0) return [];

    const collect = async (
      sitemapUrl: string,
    ): Promise<{ locs: string[]; isIndex: boolean } | null> => {
      const fetched = await this.safeRequest(
        sitemapUrl,
        {
          headers: {
            "user-agent": this.userAgent(),
            accept: "application/xml,text/xml,text/plain,application/xhtml+xml",
          },
        },
        origin,
      );
      if (fetched.kind === "failure") {
        this.recordFailure(fetched);
        return null;
      }

      const { response, finalUrl } = fetched;
      if (!response.ok) {
        await cancelResponseBody(response);
        return null;
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!isXmlContentType(contentType)) {
        await cancelResponseBody(response);
        this.recordNetworkEvent(
          finalUrl,
          "inconclusive",
          `response content type is not crawlable XML/text: ${contentType || "missing"}`,
        );
        return null;
      }

      const body = await this.readBoundedText(response);
      if (!body.ok) {
        this.recordNetworkEvent(finalUrl, body.outcome, body.reason);
        return null;
      }

      const locs: string[] = [];
      const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
      let match: RegExpExecArray | null;
      while (locs.length < maxUrls && (match = re.exec(body.text)) !== null) {
        if (match[1]) locs.push(match[1]);
      }
      return { locs, isIndex: /<sitemapindex[\s>]/i.test(body.text) };
    };

    const canonicalSameOrigin = (url: string): string | null => {
      const parsed = normalizeAndValidateUrl(url);
      if (!parsed.ok || parsed.url.origin !== origin) return null;
      return parsed.url.toString();
    };

    const root = await collect(`${origin}/sitemap.xml`);
    if (!root) return [];

    const rawUrls: string[] = [];
    if (root.isIndex) {
      const children = root.locs
        .map(canonicalSameOrigin)
        .filter((url): url is string => url !== null)
        .slice(0, MAX_SITEMAP_INDEX_CHILDREN);
      for (const child of children) {
        const sitemap = await collect(child);
        if (!sitemap) continue;
        rawUrls.push(...sitemap.locs);
        if (rawUrls.length >= maxUrls) break;
      }
    } else {
      rawUrls.push(...root.locs);
    }

    const urls: string[] = [];
    const seen = new Set<string>();
    for (const rawUrl of rawUrls) {
      if (urls.length >= maxUrls) break;
      const url = canonicalSameOrigin(rawUrl);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
    return urls;
  }
}
