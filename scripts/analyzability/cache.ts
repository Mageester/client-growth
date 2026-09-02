/**
 * Disk-backed HTTP cache for the analyzability benchmark.
 *
 * Two properties matter and they pull against each other:
 *
 *   - REPRODUCIBLE. A BEFORE/AFTER comparison is only meaningful if both runs
 *     saw the same bytes. Real sites change under you, so every response is
 *     written to disk on first sight and replayed verbatim afterwards.
 *   - POLITE. Improving crawl discovery means requesting URLs the baseline
 *     never asked for, so the cache cannot be sealed. New URLs go to the
 *     network exactly once, rate-limited per host, under a hard run-wide cap.
 *
 * Responses are stored as the crawler sees them: `redirect: "manual"`, so a 301
 * is stored as a 301 plus its Location header and the redirect chain replays
 * hop for hop. Nothing here relaxes the provider's URL policy — the cache sits
 * strictly below it, and only ever sees URLs the policy already approved.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface CacheStats {
  /** Responses replayed from disk. */
  hits: number;
  /** Responses fetched from the network and written to disk. */
  misses: number;
  /** Network attempts that failed (DNS, TLS, timeout, reset). */
  errors: number;
  /** Requests refused because the run-wide live-request cap was reached. */
  refused: number;
}

export interface CachingFetchOptions {
  dir: string;
  /** Fetch and store URLs that are not cached yet. Default true. */
  allowNetwork?: boolean;
  /** Hard cap on live network requests for the whole run. */
  maxLiveRequests?: number;
  /** Minimum gap between two live requests to the same host, in ms. */
  perHostDelayMs?: number;
  /** Per-request timeout for live fetches, in ms. */
  timeoutMs?: number;
}

interface CachedResponse {
  method: string;
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  fetchedAt: string;
}

/** Headers the crawler actually reads. Everything else is noise on disk. */
const KEPT_HEADERS = ["content-type", "location", "content-length"] as const;

/** Bodies past this are truncated: the crawler refuses them at 1MB anyway. */
const MAX_STORED_BYTES = 1_500_000;

function keyOf(method: string, url: string): string {
  return createHash("sha256").update(`${method.toUpperCase()} ${url}`).digest("hex");
}

export function createCachingFetch(options: CachingFetchOptions): {
  fetchImpl: typeof fetch;
  stats: CacheStats;
} {
  const allowNetwork = options.allowNetwork ?? true;
  const maxLive = options.maxLiveRequests ?? 2_000;
  const perHostDelayMs = options.perHostDelayMs ?? 600;
  const timeoutMs = options.timeoutMs ?? 20_000;

  mkdirSync(options.dir, { recursive: true });
  const stats: CacheStats = { hits: 0, misses: 0, errors: 0, refused: 0 };
  const lastRequestAt = new Map<string, number>();
  let liveRequests = 0;

  const read = (key: string): CachedResponse | null => {
    try {
      return JSON.parse(readFileSync(join(options.dir, `${key}.json`), "utf8")) as CachedResponse;
    } catch {
      return null;
    }
  };

  const write = (key: string, value: CachedResponse): void => {
    writeFileSync(join(options.dir, `${key}.json`), JSON.stringify(value), "utf8");
  };

  const replay = (cached: CachedResponse): Response =>
    // A 204/304 must not carry a body, and Response rejects one outright.
    new Response(cached.status === 204 || cached.status === 304 ? null : cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers: cached.headers,
    });

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const key = keyOf(method, url);

    const cached = read(key);
    if (cached) {
      stats.hits++;
      return replay(cached);
    }

    if (!allowNetwork) {
      stats.refused++;
      throw new Error(`analyzability cache miss with network disabled: ${method} ${url}`);
    }
    if (liveRequests >= maxLive) {
      stats.refused++;
      throw new Error(`analyzability live-request cap of ${maxLive} reached`);
    }

    let host = "unknown";
    try {
      host = new URL(url).host;
    } catch {
      /* the URL policy already rejected anything unparseable */
    }
    const since = Date.now() - (lastRequestAt.get(host) ?? 0);
    if (since < perHostDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, perHostDelayMs - since));
    }
    lastRequestAt.set(host, Date.now());
    liveRequests++;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      stats.errors++;
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const headers: Record<string, string> = {};
    for (const name of KEPT_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    // HEAD responses and redirects have no body worth storing; reading one is
    // also how a HEAD probe would hang.
    const hasBody = method !== "HEAD" && response.status !== 204 && response.status !== 304;
    const body = hasBody ? (await response.text()).slice(0, MAX_STORED_BYTES) : "";
    // Content-Length from a truncated store would trip the provider's own
    // body-size guard on replay for a response it originally accepted.
    if (body.length < Number(headers["content-length"] ?? "0")) delete headers["content-length"];

    const record: CachedResponse = {
      method,
      url,
      status: response.status,
      statusText: response.statusText,
      headers,
      body,
      fetchedAt: new Date().toISOString(),
    };
    write(key, record);
    stats.misses++;
    return replay(record);
  }) as typeof fetch;

  return { fetchImpl, stats };
}
