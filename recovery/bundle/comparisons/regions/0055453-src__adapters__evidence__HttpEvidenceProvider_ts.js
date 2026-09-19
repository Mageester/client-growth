// src/adapters/evidence/HttpEvidenceProvider.ts
var DEFAULT_MAX_PAGES = 10;
var DEFAULT_MAX_SITEMAP_URLS = 100;
var DEFAULT_MAX_RESPONSE_BYTES = 25e5;
var DEFAULT_REQUEST_TIMEOUT_MS = 8e3;
var DEFAULT_MAX_REDIRECTS = 5;
var DEFAULT_MAX_REQUESTS = 40;
var MAX_SITEMAP_INDEX_CHILDREN = 2;
var FALLBACK_REQUEST_TIMEOUT_MS = 4e3;
var FALLBACK_MAX_REQUESTS = 6;
var FALLBACK_MAX_PAGES = 3;
var MIN_PAGES_FOR_EXHAUSTIVE = 3;
function decoderFor(response) {
  const charset = /charset=\s*"?([\w-]+)"?/i.exec(response.headers.get("content-type") ?? "")?.[1];
  if (!charset || /^utf-?8$/i.test(charset)) return new TextDecoder();
  try {
    return new TextDecoder(charset);
  } catch {
    return new TextDecoder();
  }
}
__name(decoderFor, "decoderFor");
var DEFAULT_USER_AGENT = "AxiomOrbitBot/1.0 (+https://getaxiom.ca/bot; website evidence for the site's own agency)";
var REDIRECT_STATUSES = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
function analysisAbortError() {
  const error3 = new Error("analysis aborted");
  error3.name = "AbortError";
  return error3;
}
__name(analysisAbortError, "analysisAbortError");
function monotonicNow() {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}
__name(monotonicNow, "monotonicNow");
function boundedResponseTime(value) {
  return Math.min(12e4, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
}
__name(boundedResponseTime, "boundedResponseTime");
function responseTransferSize(response) {
  const raw = response.headers.get("content-length");
  const value = raw ? Number(raw.trim()) : 0;
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 2e7) : 0;
}
__name(responseTransferSize, "responseTransferSize");
function redactedObservationUrl(input) {
  try {
    const url = new URL(redactUrl(input));
    for (const key of [...url.searchParams.keys()]) {
      if (/pass(word)?|token|secret|api[-_]?key|auth|credential/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return "https://invalid.local/";
  }
}
__name(redactedObservationUrl, "redactedObservationUrl");
function resourceTypeForUrl(input) {
  try {
    const pathname = new URL(input).pathname.toLowerCase();
    if (/\.css$/.test(pathname)) return "stylesheet";
    if (/\.(?:m?js|jsmodule)$/.test(pathname)) return "script";
    if (/\.(?:png|jpe?g|gif|webp|svg|ico|avif)$/.test(pathname)) return "image";
    if (/\.(?:woff2?|ttf|otf|eot)$/.test(pathname)) return "font";
    if (/\.(?:json|xml)$/.test(pathname)) return "fetch";
  } catch {
  }
  return "document";
}
__name(resourceTypeForUrl, "resourceTypeForUrl");
function nonNegativeInt(value, fallback) {
  return value !== void 0 && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}
__name(nonNegativeInt, "nonNegativeInt");
function positiveInt(value, fallback) {
  return value !== void 0 && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
__name(positiveInt, "positiveInt");
var emptyPage = /* @__PURE__ */ __name((url, status) => ({
  url,
  status,
  title: "",
  h1s: [],
  headings: [],
  textExcerpt: "",
  wordCount: 0,
  forms: []
}), "emptyPage");
function isHtmlContentType(value) {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "text/html" || mediaType === "application/xhtml+xml";
}
__name(isHtmlContentType, "isHtmlContentType");
function isXmlContentType(value) {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/xml" || mediaType === "text/xml" || mediaType === "text/plain" || mediaType.endsWith("+xml");
}
__name(isXmlContentType, "isXmlContentType");
function isRedirectStatus(status) {
  return REDIRECT_STATUSES.has(status);
}
__name(isRedirectStatus, "isRedirectStatus");
function contentLengthExceeds(response, maxBytes) {
  const raw = response.headers.get("content-length");
  if (!raw) return false;
  const length = Number(raw.trim());
  return Number.isSafeInteger(length) && length >= 0 && length > maxBytes;
}
__name(contentLengthExceeds, "contentLengthExceeds");
function cancelResponseBody(response) {
  try {
    const cancellation = response.body?.cancel();
    void cancellation?.catch(() => {
    });
  } catch {
  }
}
__name(cancelResponseBody, "cancelResponseBody");
function policyFailure(input, result, redirects = 0, stage = "page") {
  return {
    kind: "failure",
    outcome: "blocked",
    url: redactUrl(input),
    reason: result.reason,
    code: "policy",
    stage,
    redirects
  };
}
__name(policyFailure, "policyFailure");
function originFailure(input, redirects, stage = "page") {
  return {
    kind: "failure",
    outcome: "blocked",
    url: redactUrl(input),
    reason: "redirect leaves the allowed same-site boundary",
    code: "redirect",
    stage,
    redirects
  };
}
__name(originFailure, "originFailure");
function requestBudgetFailure(input, redirects, stage = "page") {
  return {
    kind: "failure",
    outcome: "inconclusive",
    url: redactUrl(input),
    reason: "request budget exhausted",
    code: "request-budget",
    stage,
    redirects
  };
}
__name(requestBudgetFailure, "requestBudgetFailure");
function pageFetchFailure(url, failure) {
  return {
    kind: "network-failure",
    requestedUrl: redactUrl(url),
    outcome: failure.outcome,
    reason: failure.reason,
    code: failure.code
  };
}
__name(pageFetchFailure, "pageFetchFailure");
function inferFailureCode(reason) {
  const text = reason.toLowerCase();
  if (text.includes("timeout")) return "timeout";
  if (text.includes("robots")) return "robots";
  if (text.includes("content type")) return "content-type";
  if (text.includes("content-length") || text.includes("body exceeds")) return "response-size";
  if (text.includes("redirect")) return "redirect";
  if (text.includes("budget")) return "request-budget";
  if (text.includes("http ")) return "http-status";
  if (text.includes("policy") || text.includes("destination") || text.includes("scheme")) {
    return "policy";
  }
  if (text.includes("aborted")) return "aborted";
  return "network";
}
__name(inferFailureCode, "inferFailureCode");
function alternateOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.hostname.includes(":")) return null;
    const host = canonicalSiteHost(url.hostname);
    const alternateHost = url.hostname.toLowerCase().startsWith("www.") ? host : `www.${host}`;
    if (alternateHost === url.hostname.toLowerCase()) return null;
    url.hostname = alternateHost;
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.origin;
  } catch {
    return null;
  }
}
__name(alternateOrigin, "alternateOrigin");
function readablePageCount(evidence) {
  return evidence.site.pages.filter(
    (page) => page.status >= 200 && page.status < 300 && page.wordCount > 0
  ).length;
}
__name(readablePageCount, "readablePageCount");
function combineCoverage(primary, alternate) {
  const ignored = /* @__PURE__ */ new Map();
  for (const entry2 of [...primary.ignoredUrls, ...alternate.ignoredUrls]) {
    ignored.set(`${entry2.reason}\0${entry2.url}`, entry2);
  }
  return {
    discoveredUrls: primary.discoveredUrls + alternate.discoveredUrls,
    attemptedUrls: primary.attemptedUrls + alternate.attemptedUrls,
    retrievedUrls: primary.retrievedUrls + alternate.retrievedUrls,
    renderedUrls: primary.renderedUrls + alternate.renderedUrls,
    failedUrls: primary.failedUrls + alternate.failedUrls,
    ignoredUrls: [...ignored.values()].slice(0, 100),
    redirectHops: primary.redirectHops + alternate.redirectHops,
    canonicalPages: primary.canonicalPages + alternate.canonicalPages,
    maxDepth: Math.max(primary.maxDepth, alternate.maxDepth),
    screenshotsCaptured: primary.screenshotsCaptured + alternate.screenshotsCaptured
  };
}
__name(combineCoverage, "combineCoverage");
function combineEvidenceBundles(primary, alternate) {
  const pages = /* @__PURE__ */ new Map();
  for (const page of [...primary.site.pages, ...alternate.site.pages]) {
    const key = crawlKey(page.url);
    const existing = pages.get(key);
    if (!existing || page.wordCount > existing.wordCount) pages.set(key, page);
  }
  const sitemapUrls = /* @__PURE__ */ new Map();
  for (const url of [
    ...primary.site.sitemapUrls,
    ...alternate.site.sitemapUrls
  ]) {
    sitemapUrls.set(crawlKey(url), url);
  }
  const links2 = /* @__PURE__ */ new Map();
  for (const link of [...primary.site.links, ...alternate.site.links]) {
    const key = `${link.scheme}:${link.href}`;
    const existing = links2.get(key);
    if (!existing) {
      links2.set(key, link);
      continue;
    }
    links2.set(key, {
      ...existing,
      label: existing.label || link.label,
      ariaLabel: existing.ariaLabel || link.ariaLabel,
      title: existing.title || link.title,
      inNav: existing.inNav || link.inNav,
      inServiceNav: existing.inServiceNav || link.inServiceNav,
      foundOn: [.../* @__PURE__ */ new Set([...existing.foundOn, ...link.foundOn])]
    });
  }
  return EvidenceBundleSchema.parse({
    ...primary,
    site: {
      ...primary.site,
      pages: [...pages.values()],
      nav: [.../* @__PURE__ */ new Set([...primary.site.nav, ...alternate.site.nav])],
      links: [...links2.values()],
      sitemapUrls: [...sitemapUrls.values()],
      // Neither origin produced a readable recovery, so the combined result
      // cannot establish that the entire site was inspected.
      crawlExhaustive: false,
      coverage: primary.site.coverage && alternate.site.coverage ? combineCoverage(primary.site.coverage, alternate.site.coverage) : primary.site.coverage ?? alternate.site.coverage
    },
    networkEvents: [
      ...primary.networkEvents,
      ...alternate.networkEvents
    ],
    ...primary.resourceFailures || alternate.resourceFailures ? {
      resourceFailures: [
        ...primary.resourceFailures ?? [],
        ...alternate.resourceFailures ?? []
      ].slice(0, 200)
    } : {},
    ...primary.performanceObservations || alternate.performanceObservations ? {
      performanceObservations: [
        ...primary.performanceObservations ?? [],
        ...alternate.performanceObservations ?? []
      ].slice(0, 100)
    } : {}
  });
}
__name(combineEvidenceBundles, "combineEvidenceBundles");
function shouldTryAlternateOrigin(evidence) {
  return evidence.networkEvents.some(
    (event) => event.code === "timeout" || event.code === "network" || event.code === "aborted" || // Some otherwise valid sites send the apex through an HTTP downgrade
    // before returning to their secure www origin. We never follow that
    // insecure hop, but can safely try the already-allowed HTTPS sibling
    // directly and recover the public pages without widening the site boundary.
    event.code === "redirect" || event.code === "js-shell"
  );
}
__name(shouldTryAlternateOrigin, "shouldTryAlternateOrigin");
function looksLikeClientRenderedShell(html2, parsed) {
  if (parsed.page.h1s.length > 0 || parsed.page.headings.length > 0 || parsed.links.length > 0) {
    return false;
  }
  if (parsed.page.wordCount > 12) return false;
  const hasMountPoint = /<(?:div|main|body)\b[^>]*(?:id\s*=\s*["'](?:root|app|__next|svelte)["']|data-reactroot\b)/i.test(
    html2
  );
  const hasClientScript = /<script\b[^>]*(?:type\s*=\s*["']module["']|src\s*=)/i.test(html2);
  return hasMountPoint && hasClientScript;
}
__name(looksLikeClientRenderedShell, "looksLikeClientRenderedShell");
var HttpEvidenceProvider = class _HttpEvidenceProvider {
  constructor(options = {}) {
    this.options = options;
  }
  options;
  static {
    __name(this, "HttpEvidenceProvider");
  }
  requestBudgetRemaining = null;
  /** Resolved once per crawl, then consulted before every same-site request. */
  robots = ALLOW_ALL;
  /** The origin `robots` was read from. Rules never apply to another origin. */
  robotsOrigin = null;
  networkEvents = [];
  resourceFailures = [];
  performanceObservations = [];
  lastEvidence = null;
  resolveFetch() {
    const rawFetch = this.options.fetchImpl ?? globalThis.fetch;
    if (typeof rawFetch !== "function") {
      throw new Error("HttpEvidenceProvider: no fetch implementation available");
    }
    return this.options.fetchImpl ?? rawFetch.bind(globalThis);
  }
  userAgent() {
    const configured = this.options.userAgent?.trim();
    return configured || DEFAULT_USER_AGENT;
  }
  maxPages() {
    return Math.min(nonNegativeInt(this.options.maxPages, DEFAULT_MAX_PAGES), DEFAULT_MAX_PAGES);
  }
  maxSitemapUrls() {
    return Math.min(
      nonNegativeInt(this.options.maxSitemapUrls, DEFAULT_MAX_SITEMAP_URLS),
      DEFAULT_MAX_SITEMAP_URLS
    );
  }
  maxResponseBytes() {
    return Math.min(
      positiveInt(this.options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES),
      DEFAULT_MAX_RESPONSE_BYTES
    );
  }
  requestTimeoutMs() {
    return Math.min(
      positiveInt(this.options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
      DEFAULT_REQUEST_TIMEOUT_MS
    );
  }
  maxRedirects() {
    return Math.min(nonNegativeInt(this.options.maxRedirects, DEFAULT_MAX_REDIRECTS), DEFAULT_MAX_REDIRECTS);
  }
  maxRequests() {
    return Math.min(nonNegativeInt(this.options.maxRequests, DEFAULT_MAX_REQUESTS), DEFAULT_MAX_REQUESTS);
  }
  startRun() {
    this.requestBudgetRemaining = this.maxRequests();
    this.networkEvents = [];
    this.resourceFailures = [];
    this.performanceObservations = [];
    this.lastEvidence = null;
  }
  ensureRun() {
    if (this.requestBudgetRemaining === null) this.startRun();
  }
  consumeRequest(input, redirects) {
    this.ensureRun();
    if ((this.requestBudgetRemaining ?? 0) <= 0) {
      return requestBudgetFailure(input, redirects);
    }
    this.requestBudgetRemaining = (this.requestBudgetRemaining ?? 1) - 1;
    return null;
  }
  recordNetworkEvent(url, outcome, reason, metadata = {}) {
    const event = {
      url: redactUrl(url),
      outcome,
      reason,
      code: metadata.code ?? inferFailureCode(reason),
      stage: metadata.stage ?? "page",
      ...metadata.status === void 0 ? {} : { status: metadata.status },
      ...metadata.redirects === void 0 ? {} : { redirects: metadata.redirects }
    };
    this.networkEvents.push(event);
    if (this.lastEvidence) this.lastEvidence.networkEvents.push(event);
  }
  recordFailure(failure) {
    this.recordNetworkEvent(failure.url, failure.outcome, failure.reason, {
      code: failure.code,
      stage: failure.stage,
      status: failure.status,
      redirects: failure.redirects
    });
  }
  observationTime() {
    return (this.options.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
  }
  recordPerformanceObservation(pageUrl, response, responseTimeMs, transferSizeBytes) {
    const observation = {
      pageUrl: redactedObservationUrl(pageUrl),
      status: response.status,
      responseTimeMs: boundedResponseTime(responseTimeMs),
      transferSizeBytes: Math.min(2e7, Math.max(0, Math.floor(transferSizeBytes))),
      source: "http",
      observedAt: this.observationTime()
    };
    if (this.performanceObservations.length < 100) this.performanceObservations.push(observation);
    if (this.lastEvidence && (this.lastEvidence.performanceObservations?.length ?? 0) < 100) {
      this.lastEvidence.performanceObservations ??= [];
      this.lastEvidence.performanceObservations.push(observation);
    }
  }
  recordResourceFailure(pageUrl, url, reason, status, cause) {
    if (!isSameSite(url, pageUrl)) return;
    const failure = {
      pageUrl: redactedObservationUrl(pageUrl),
      url: redactedObservationUrl(url),
      resourceType: resourceTypeForUrl(url),
      ...status === void 0 ? {} : { status },
      reason: reason.slice(0, 500),
      source: "http",
      ...cause === void 0 ? {} : { cause },
      observedAt: this.observationTime()
    };
    if (this.resourceFailures.length < 200) this.resourceFailures.push(failure);
    if (this.lastEvidence && (this.lastEvidence.resourceFailures?.length ?? 0) < 200) {
      this.lastEvidence.resourceFailures ??= [];
      this.lastEvidence.resourceFailures.push(failure);
    }
  }
  throwIfAborted() {
    if (this.options.signal?.aborted) throw analysisAbortError();
  }
  /**
   * Fetch one URL with manual redirects. Each hop is parsed and policy-checked
   * before its request is issued. The request budget is charged per hop.
   */
  async safeRequest(input, init2, allowedOrigin, stage = "page") {
    this.ensureRun();
    this.throwIfAborted();
    const initial = normalizeAndValidateUrl(input);
    if (!initial.ok) return policyFailure(input, initial, 0, stage);
    if (allowedOrigin && !isSameSite(initial.url, allowedOrigin)) {
      return originFailure(initial.url, 0, stage);
    }
    const fetchImpl = this.resolveFetch();
    const initialUrl = initial.url.toString();
    let current = initialUrl;
    let redirects = 0;
    let responseTimeMs = 0;
    for (; ; ) {
      this.throwIfAborted();
      if (allowedOrigin && current !== initialUrl && !isSameSite(current, allowedOrigin)) {
        return originFailure(current, redirects, stage);
      }
      const budgetFailure = this.consumeRequest(current, redirects);
      if (budgetFailure) {
        return { ...budgetFailure, stage };
      }
      const controller = new AbortController();
      let timedOut = false;
      let timer;
      const externalSignal = this.options.signal;
      let removeExternalAbortListener;
      let rejectExternalAbort;
      const externalAbort = externalSignal ? new Promise((_, reject) => {
        rejectExternalAbort = reject;
      }) : null;
      const onExternalAbort = /* @__PURE__ */ __name(() => {
        controller.abort(externalSignal?.reason);
        rejectExternalAbort?.(analysisAbortError());
      }, "onExternalAbort");
      if (externalSignal) {
        if (externalSignal.aborted) onExternalAbort();
        else {
          externalSignal.addEventListener("abort", onExternalAbort, { once: true });
          removeExternalAbortListener = /* @__PURE__ */ __name(() => externalSignal.removeEventListener("abort", onExternalAbort), "removeExternalAbortListener");
        }
      }
      const requestTimeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error("request timeout"));
        }, this.requestTimeoutMs());
      });
      let response;
      const requestStartedAt = monotonicNow();
      try {
        const pending = [
          fetchImpl(current, {
            ...init2,
            redirect: "manual",
            signal: controller.signal
          }),
          requestTimeout
        ];
        if (externalAbort) pending.push(externalAbort);
        response = await Promise.race(pending);
        if (timedOut) {
          await cancelResponseBody(response);
          return {
            kind: "failure",
            outcome: "inconclusive",
            url: redactUrl(current),
            reason: "request timeout",
            code: "timeout",
            stage,
            redirects
          };
        }
      } catch {
        if (this.options.signal?.aborted) throw analysisAbortError();
        return {
          kind: "failure",
          outcome: "inconclusive",
          url: redactUrl(current),
          reason: timedOut ? "request timeout" : "network request failed",
          code: timedOut ? "timeout" : "network",
          stage,
          redirects
        };
      } finally {
        responseTimeMs += boundedResponseTime(monotonicNow() - requestStartedAt);
        if (timer !== void 0) clearTimeout(timer);
        removeExternalAbortListener?.();
      }
      const responseUrl = response.url?.trim();
      if (responseUrl && responseUrl !== current) {
        const observed = normalizeAndValidateUrl(responseUrl);
        if (!observed.ok) {
          await cancelResponseBody(response);
          return policyFailure(responseUrl, observed, redirects, stage);
        }
        if (allowedOrigin && !isSameSite(observed.url, allowedOrigin)) {
          await cancelResponseBody(response);
          return originFailure(observed.url, redirects, stage);
        }
        if (observed.url.toString() !== current) {
          await cancelResponseBody(response);
          return {
            kind: "failure",
            outcome: "inconclusive",
            url: redactUrl(observed.url),
            reason: "fetch reported a redirect without a manually validated Location",
            code: "redirect",
            stage,
            redirects
          };
        }
      }
      if (!isRedirectStatus(response.status)) {
        return {
          kind: "response",
          response,
          finalUrl: current,
          redirects,
          responseTimeMs: boundedResponseTime(responseTimeMs)
        };
      }
      if (redirects >= this.maxRedirects()) {
        await cancelResponseBody(response);
        return {
          kind: "failure",
          outcome: "inconclusive",
          url: redactUrl(current),
          reason: `redirect limit of ${this.maxRedirects()} hops exhausted`,
          code: "redirect",
          stage,
          redirects
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
          code: "redirect",
          stage,
          redirects
        };
      }
      const next = normalizeAndValidateUrl(location, current);
      if (!next.ok) {
        await cancelResponseBody(response);
        return policyFailure(location, next, redirects, stage);
      }
      if (allowedOrigin && !isSameSite(next.url, allowedOrigin)) {
        await cancelResponseBody(response);
        return originFailure(next.url, redirects + 1, stage);
      }
      await cancelResponseBody(response);
      current = next.url.toString();
      redirects++;
    }
  }
  async readBoundedText(response) {
    this.throwIfAborted();
    const maxBytes = this.maxResponseBytes();
    if (contentLengthExceeds(response, maxBytes)) {
      await cancelResponseBody(response);
      return {
        ok: false,
        outcome: "inconclusive",
        reason: `response Content-Length exceeds ${maxBytes} bytes`,
        code: "response-size"
      };
    }
    if (!response.body) return { ok: true, text: "", bytes: 0 };
    let reader;
    try {
      reader = response.body.getReader();
    } catch {
      cancelResponseBody(response);
      return {
        ok: false,
        outcome: "inconclusive",
        reason: "response body could not be read",
        code: "response-body"
      };
    }
    const cancelReader = /* @__PURE__ */ __name((reason) => {
      try {
        void reader.cancel(reason).catch(() => {
        });
      } catch {
      }
    }, "cancelReader");
    const decoder2 = decoderFor(response);
    const chunks = [];
    let totalBytes = 0;
    let timedOut = false;
    let bodyTimer;
    const externalSignal = this.options.signal;
    let removeExternalAbortListener;
    let rejectExternalAbort;
    const externalAbort = externalSignal ? new Promise((_, reject) => {
      rejectExternalAbort = reject;
    }) : null;
    const onExternalAbort = /* @__PURE__ */ __name(() => {
      cancelReader("analysis aborted");
      rejectExternalAbort?.(analysisAbortError());
    }, "onExternalAbort");
    if (externalSignal) {
      if (externalSignal.aborted) onExternalAbort();
      else {
        externalSignal.addEventListener("abort", onExternalAbort, { once: true });
        removeExternalAbortListener = /* @__PURE__ */ __name(() => externalSignal.removeEventListener("abort", onExternalAbort), "removeExternalAbortListener");
      }
    }
    const bodyTimeout = new Promise((_, reject) => {
      bodyTimer = setTimeout(() => {
        timedOut = true;
        cancelReader("response body timeout");
        reject(new Error("response body timeout"));
      }, this.requestTimeoutMs());
    });
    try {
      for (; ; ) {
        const pending = [reader.read(), bodyTimeout];
        if (externalAbort) pending.push(externalAbort);
        const { done, value } = await Promise.race(pending);
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          cancelReader("response body byte cap exceeded");
          return {
            ok: false,
            outcome: "inconclusive",
            reason: `response body exceeds ${maxBytes} bytes`,
            code: "response-size"
          };
        }
        chunks.push(decoder2.decode(value, { stream: true }));
      }
      chunks.push(decoder2.decode());
      return { ok: true, text: chunks.join(""), bytes: totalBytes };
    } catch {
      cancelReader("response body could not be read");
      if (this.options.signal?.aborted) throw analysisAbortError();
      return {
        ok: false,
        outcome: "inconclusive",
        reason: timedOut ? "response body timeout" : "response body could not be read",
        code: timedOut ? "timeout" : "response-body"
      };
    } finally {
      if (bodyTimer !== void 0) clearTimeout(bodyTimer);
      removeExternalAbortListener?.();
      try {
        reader.releaseLock();
      } catch {
      }
    }
  }
  async getEvidence(client) {
    this.throwIfAborted();
    this.startRun();
    const capturedAt2 = (this.options.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
    const originResult = normalizeOrigin(client.domain);
    if (!originResult.ok) {
      this.recordNetworkEvent(client.domain, "blocked", originResult.reason, {
        code: "policy",
        stage: "page"
      });
      const blocked = EvidenceBundleSchema.parse({
        clientId: client.id,
        source: "http",
        capturedAt: capturedAt2,
        site: {
          pages: [],
          nav: [],
          links: [],
          sitemapUrls: [],
          coverage: {
            discoveredUrls: 0,
            attemptedUrls: 0,
            retrievedUrls: 0,
            renderedUrls: 0,
            failedUrls: 0,
            ignoredUrls: [],
            redirectHops: 0,
            canonicalPages: 0,
            maxDepth: 0,
            screenshotsCaptured: 0
          }
        },
        networkEvents: this.networkEvents
      });
      this.lastEvidence = blocked;
      return blocked;
    }
    const fetchHeaders = {
      "user-agent": this.userAgent(),
      accept: "text/html,application/xhtml+xml"
    };
    const startUrl = originResult.url.toString();
    const origin = originResult.url.origin;
    const visited = /* @__PURE__ */ new Set();
    const seenFinalUrls = /* @__PURE__ */ new Set();
    const pages = [];
    const linksByKey = /* @__PURE__ */ new Map();
    let nav = [];
    let pageRequests = 0;
    const discoveredKeys = /* @__PURE__ */ new Set();
    const attemptedKeys = /* @__PURE__ */ new Set();
    const retrievedKeys = /* @__PURE__ */ new Set();
    const failedKeys = /* @__PURE__ */ new Set();
    const ignoredUrls = [];
    const ignoredKeys = /* @__PURE__ */ new Set();
    let redirectHops = 0;
    let maxDepth = 0;
    const ignore = /* @__PURE__ */ __name((rawUrl, reason) => {
      const url = redactUrl(rawUrl);
      const key = `${reason}:${url}`;
      if (ignoredKeys.has(key) || ignoredUrls.length >= 100) return;
      ignoredKeys.add(key);
      ignoredUrls.push({ url, reason });
    }, "ignore");
    const frontier = /* @__PURE__ */ new Map();
    let discovered = 0;
    const enqueue = /* @__PURE__ */ __name((rawUrl, options = {}) => {
      const parsed = normalizeAndValidateUrl(rawUrl);
      if (!parsed.ok) {
        ignore(rawUrl, "invalid-url");
        return;
      }
      if (!isSameSite(parsed.url, origin)) {
        ignore(rawUrl, "off-site");
        return;
      }
      const url = parsed.url.toString();
      const key = crawlKey(url);
      discoveredKeys.add(key);
      if (visited.has(key)) {
        ignore(url, "duplicate");
        return;
      }
      const priority = crawlPriority(url, options);
      const existing = frontier.get(key);
      if (existing && existing.priority >= priority) return;
      frontier.set(key, {
        url: existing?.url ?? url,
        priority,
        discovered: existing?.discovered ?? discovered++,
        depth: Math.min(existing?.depth ?? Number.POSITIVE_INFINITY, options.depth ?? 0)
      });
    }, "enqueue");
    const takeNext = /* @__PURE__ */ __name(() => {
      let bestKey;
      let bestScore = { priority: Number.NEGATIVE_INFINITY, discovered: Number.POSITIVE_INFINITY };
      for (const [key, candidate] of frontier) {
        if (candidate.priority > bestScore.priority || candidate.priority === bestScore.priority && candidate.discovered < bestScore.discovered) {
          bestKey = key;
          bestScore = candidate;
        }
      }
      if (bestKey === void 0) return void 0;
      const selected = frontier.get(bestKey);
      frontier.delete(bestKey);
      return selected ? { url: selected.url, depth: selected.depth } : void 0;
    }, "takeNext");
    enqueue(startUrl);
    this.robots = await this.readRobots(origin);
    this.robotsOrigin = origin;
    const sitemapUrls = await this.readSitemap(origin);
    for (const url of sitemapUrls) {
      if (looksLikeServiceUrl(url) || isServiceHub(url)) enqueue(url);
    }
    while (pageRequests < this.maxPages()) {
      const selected = takeNext();
      if (selected === void 0) break;
      const { url, depth } = selected;
      if (visited.has(crawlKey(url))) continue;
      visited.add(crawlKey(url));
      if (!this.robotsAllows(url)) {
        ignore(url, "robots");
        this.recordNetworkEvent(url, "blocked", "disallowed by the site's robots.txt", {
          code: "robots",
          stage: "page"
        });
        continue;
      }
      pageRequests++;
      attemptedKeys.add(crawlKey(url));
      maxDepth = Math.max(maxDepth, depth);
      const fetched = await this.safeRequest(url, { headers: fetchHeaders }, origin, "page");
      if (fetched.kind === "failure") {
        failedKeys.add(crawlKey(fetched.url));
        redirectHops += fetched.redirects;
        this.recordFailure(fetched);
        continue;
      }
      const { response, finalUrl } = fetched;
      redirectHops += fetched.redirects;
      visited.add(crawlKey(finalUrl));
      const duplicate = seenFinalUrls.has(crawlKey(finalUrl));
      seenFinalUrls.add(crawlKey(finalUrl));
      if (!response.ok) {
        failedKeys.add(crawlKey(finalUrl));
        this.recordPerformanceObservation(
          finalUrl,
          response,
          fetched.responseTimeMs,
          responseTransferSize(response)
        );
        await cancelResponseBody(response);
        const reason = `page returned HTTP ${response.status}`;
        this.recordResourceFailure(finalUrl, finalUrl, reason, response.status);
        this.recordNetworkEvent(finalUrl, "inconclusive", reason, {
          code: "http-status",
          stage: "page",
          status: response.status,
          redirects: fetched.redirects
        });
        if (!duplicate) pages.push(emptyPage(finalUrl, response.status));
        continue;
      }
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!isHtmlContentType(contentType)) {
        failedKeys.add(crawlKey(finalUrl));
        this.recordPerformanceObservation(
          finalUrl,
          response,
          fetched.responseTimeMs,
          responseTransferSize(response)
        );
        await cancelResponseBody(response);
        const reason = `response content type is not crawlable HTML/XHTML: ${contentType || "missing"}`;
        this.recordResourceFailure(finalUrl, finalUrl, reason, response.status);
        this.recordNetworkEvent(
          finalUrl,
          "inconclusive",
          reason,
          { code: "content-type", stage: "page", status: response.status }
        );
        if (!duplicate) pages.push(emptyPage(finalUrl, response.status));
        continue;
      }
      const body = await this.readBoundedText(response);
      if (!body.ok) {
        failedKeys.add(crawlKey(finalUrl));
        this.recordPerformanceObservation(
          finalUrl,
          response,
          fetched.responseTimeMs,
          responseTransferSize(response)
        );
        this.recordResourceFailure(
          finalUrl,
          finalUrl,
          body.reason,
          response.status,
          "orbit-limit"
        );
        this.recordNetworkEvent(finalUrl, body.outcome, body.reason, {
          code: body.code,
          stage: "page",
          status: response.status
        });
        if (!duplicate) pages.push(emptyPage(finalUrl, response.status));
        continue;
      }
      this.recordPerformanceObservation(
        finalUrl,
        response,
        fetched.responseTimeMs,
        body.bytes
      );
      const parsed = parseHtml(body.text, finalUrl);
      for (const externalUrl of parsed.offSiteHttpLinks) ignore(externalUrl, "off-site");
      if (looksLikeClientRenderedShell(body.text, parsed)) {
        failedKeys.add(crawlKey(finalUrl));
        this.recordNetworkEvent(
          finalUrl,
          "inconclusive",
          "page appears to be a client-rendered JavaScript shell; readable page content was not present in the response",
          {
            code: "js-shell",
            stage: "page",
            status: response.status,
            redirects: fetched.redirects
          }
        );
        if (!duplicate) pages.push(emptyPage(finalUrl, response.status));
        continue;
      }
      if (!duplicate) pages.push({ ...parsed.page, status: response.status });
      if (parsed.page.wordCount > 0) retrievedKeys.add(crawlKey(finalUrl));
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
          if (link.inServiceNav) existing.inServiceNav = true;
          if (!existing.foundOn.includes(finalUrl)) existing.foundOn.push(finalUrl);
        }
        if (link.scheme !== "http") continue;
        if (isPlatformInfrastructurePath(link.href)) {
          ignore(link.href, "platform-path");
          continue;
        }
        enqueue(link.href, {
          inNav: link.inNav,
          inServiceNav: link.inServiceNav,
          depth: depth + 1
        });
      }
    }
    if (frontier.size > 0 && pageRequests >= this.maxPages()) {
      for (const candidate of frontier.values()) ignore(candidate.url, "page-budget");
    }
    const readablePages = pages.filter(
      (page) => page.status >= 200 && page.status < 300 && page.wordCount > 0
    ).length;
    const coveredGround = readablePages >= MIN_PAGES_FOR_EXHAUSTIVE || sitemapUrls.length > 0;
    const crawlExhaustive = frontier.size === 0 && pageRequests < this.maxPages() && this.networkEvents.length === 0 && readablePages > 0 && coveredGround;
    const bundle = EvidenceBundleSchema.parse({
      clientId: client.id,
      source: "http",
      capturedAt: capturedAt2,
      site: {
        pages,
        nav,
        links: [...linksByKey.values()],
        sitemapUrls,
        crawlExhaustive,
        coverage: {
          discoveredUrls: discoveredKeys.size,
          attemptedUrls: attemptedKeys.size,
          retrievedUrls: retrievedKeys.size,
          renderedUrls: 0,
          failedUrls: failedKeys.size,
          ignoredUrls,
          redirectHops,
          canonicalPages: seenFinalUrls.size,
          maxDepth,
          screenshotsCaptured: 0
        }
      },
      networkEvents: this.networkEvents,
      ...this.resourceFailures.length > 0 ? { resourceFailures: this.resourceFailures } : {},
      ...this.performanceObservations.length > 0 ? { performanceObservations: this.performanceObservations } : {}
    });
    if (readablePages === 0 && this.options.allowAlternateOriginFallback !== false && shouldTryAlternateOrigin(bundle)) {
      const alternate = alternateOrigin(origin);
      if (alternate && alternate !== origin) {
        const fallback = new _HttpEvidenceProvider({
          ...this.options,
          allowAlternateOriginFallback: false,
          requestTimeoutMs: Math.min(this.requestTimeoutMs(), FALLBACK_REQUEST_TIMEOUT_MS),
          maxRequests: Math.min(this.maxRequests(), FALLBACK_MAX_REQUESTS),
          maxPages: Math.min(this.maxPages(), FALLBACK_MAX_PAGES)
        });
        const alternateEvidence = await fallback.getEvidence({ ...client, domain: alternate });
        if (readablePageCount(alternateEvidence) > 0) {
          this.lastEvidence = alternateEvidence;
          return alternateEvidence;
        }
        const combined = combineEvidenceBundles(bundle, alternateEvidence);
        this.lastEvidence = combined;
        return combined;
      }
    }
    this.lastEvidence = bundle;
    return bundle;
  }
  /** Fetch and parse one specific URL. Used by targeted absence verification. */
  async fetchPage(url) {
    this.ensureRun();
    this.throwIfAborted();
    const initial = normalizeAndValidateUrl(url);
    if (!initial.ok) {
      const failure = policyFailure(url, initial, 0, "targeted-page");
      this.recordFailure(failure);
      return pageFetchFailure(url, failure);
    }
    if (!this.robotsAllows(initial.url)) {
      const failure = {
        outcome: "blocked",
        reason: "disallowed by the site's robots.txt",
        code: "robots"
      };
      this.recordNetworkEvent(initial.url.toString(), failure.outcome, failure.reason, {
        code: failure.code,
        stage: "targeted-page"
      });
      return pageFetchFailure(url, failure);
    }
    const fetched = await this.safeRequest(
      initial.url,
      {
        headers: {
          "user-agent": this.userAgent(),
          accept: "text/html,application/xhtml+xml"
        }
      },
      initial.url.origin,
      "targeted-page"
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
      this.recordNetworkEvent(finalUrl, "inconclusive", reason, {
        code: "http-status",
        stage: "targeted-page",
        status: response.status,
        redirects: fetched.redirects
      });
      return pageFetchFailure(finalUrl, {
        outcome: "inconclusive",
        reason,
        code: "http-status"
      });
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!isHtmlContentType(contentType)) {
      await cancelResponseBody(response);
      this.recordNetworkEvent(
        finalUrl,
        "inconclusive",
        `response content type is not crawlable HTML/XHTML: ${contentType || "missing"}`,
        { code: "content-type", stage: "targeted-page", status: response.status }
      );
      return pageFetchFailure(finalUrl, {
        outcome: "inconclusive",
        reason: `response content type is not crawlable HTML/XHTML: ${contentType || "missing"}`,
        code: "content-type"
      });
    }
    const body = await this.readBoundedText(response);
    if (!body.ok) {
      this.recordNetworkEvent(finalUrl, body.outcome, body.reason, {
        code: body.code,
        stage: "targeted-page",
        status: response.status
      });
      return pageFetchFailure(finalUrl, body);
    }
    return { ...parseHtml(body.text, finalUrl).page, status: response.status };
  }
  /**
   * HEAD (falling back to GET on 405/501) status check for a single URL, with
   * every redirect validated. `status: 0` means the request could not be
   * completed or trusted; the caller must treat that as inconclusive.
   */
  async probe(url) {
    this.ensureRun();
    this.throwIfAborted();
    const initial = normalizeAndValidateUrl(url);
    if (!initial.ok) {
      const failure = policyFailure(url, initial, 0, "probe");
      this.recordFailure(failure);
      return {
        requestedUrl: redactUrl(url),
        status: 0,
        finalUrl: redactUrl(url),
        ok: false,
        outcome: failure.outcome,
        reason: failure.reason,
        redirects: failure.redirects
      };
    }
    if (!this.robotsAllows(initial.url)) {
      const reason = "disallowed by the site's robots.txt";
      this.recordNetworkEvent(initial.url.toString(), "blocked", reason, {
        code: "robots",
        stage: "probe"
      });
      return {
        requestedUrl: initial.url.toString(),
        status: 0,
        finalUrl: initial.url.toString(),
        ok: false,
        outcome: "blocked",
        reason,
        redirects: 0
      };
    }
    const headers2 = { "user-agent": this.userAgent() };
    const request = /* @__PURE__ */ __name(async (method) => this.safeRequest(initial.url, { method, headers: headers2 }, initial.url.origin, "probe"), "request");
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
        redirects: head.redirects
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
          redirects: get.redirects
        };
      }
      const result2 = {
        requestedUrl: initial.url.toString(),
        status: get.response.status,
        finalUrl: get.finalUrl,
        ok: get.response.ok,
        outcome: "complete",
        redirects: get.redirects
      };
      await cancelResponseBody(get.response);
      return result2;
    }
    const result = {
      requestedUrl: initial.url.toString(),
      status: head.response.status,
      finalUrl: head.finalUrl,
      ok: head.response.ok,
      outcome: "complete",
      redirects: head.redirects
    };
    await cancelResponseBody(head.response);
    return result;
  }
  /** Whether robots.txt permits requesting this same-site URL. */
  robotsAllows(url) {
    if (this.robots.unrestricted || this.robotsOrigin === null) return true;
    try {
      const parsed = typeof url === "string" ? new URL(url) : url;
      if (parsed.origin !== this.robotsOrigin) return true;
      return isAllowed(this.robots, robotsPath(parsed));
    } catch {
      return true;
    }
  }
  /**
   * Read and parse /robots.txt.
   *
   * Absent or unreadable means unrestricted, deliberately. RFC 9309 permits
   * treating a 5xx as a full disallow, and for a general-purpose web crawler
   * that is the polite reading. This crawler only ever visits sites its own
   * operator's client has engaged them to look after, so letting one flaky
   * response silently convert an analysis into "we could not look" would cost
   * the agency real information to buy a courtesy nobody asked for. A file that
   * loads and says no is obeyed exactly.
   */
  async readRobots(origin) {
    const fetched = await this.safeRequest(
      `${origin}/robots.txt`,
      { headers: { "user-agent": this.userAgent(), accept: "text/plain" } },
      origin,
      "robots"
    );
    if (fetched.kind === "failure") {
      if (fetched.outcome === "inconclusive") this.recordFailure(fetched);
      return ALLOW_ALL;
    }
    const { response } = fetched;
    if (!response.ok) {
      await cancelResponseBody(response);
      return ALLOW_ALL;
    }
    const body = await this.readBoundedText(response);
    if (!body.ok) {
      this.recordNetworkEvent(`${origin}/robots.txt`, body.outcome, body.reason, {
        code: body.code,
        stage: "robots"
      });
      return ALLOW_ALL;
    }
    return policyFor(body.text, this.userAgent());
  }
  /** Best-effort /sitemap.xml read (follows one level of sitemap index). */
  async readSitemap(origin) {
    const maxUrls = this.maxSitemapUrls();
    if (maxUrls === 0) return [];
    const collect = /* @__PURE__ */ __name(async (sitemapUrl) => {
      const fetched = await this.safeRequest(
        sitemapUrl,
        {
          headers: {
            "user-agent": this.userAgent(),
            accept: "application/xml,text/xml,text/plain,application/xhtml+xml"
          }
        },
        origin,
        "sitemap"
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
          { code: "content-type", stage: "sitemap", status: response.status }
        );
        return null;
      }
      const body = await this.readBoundedText(response);
      if (!body.ok) {
        this.recordNetworkEvent(finalUrl, body.outcome, body.reason, {
          code: body.code,
          stage: "sitemap",
          status: response.status
        });
        return null;
      }
      const locs = [];
      const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
      let match;
      while (locs.length < maxUrls && (match = re.exec(body.text)) !== null) {
        if (match[1]) locs.push(match[1]);
      }
      return { locs, isIndex: /<sitemapindex[\s>]/i.test(body.text) };
    }, "collect");
    const sameOriginUrl = /* @__PURE__ */ __name((url) => {
      const parsed = normalizeAndValidateUrl(url);
      if (!parsed.ok || !isSameSite(parsed.url, origin)) return null;
      return parsed.url.toString();
    }, "sameOriginUrl");
    const root2 = await collect(`${origin}/sitemap.xml`);
    if (!root2) return [];
    const rawUrls = [];
    if (root2.isIndex) {
      const children = root2.locs.map(sameOriginUrl).filter((url) => url !== null).slice(0, MAX_SITEMAP_INDEX_CHILDREN);
      for (const child of children) {
        const sitemap = await collect(child);
        if (!sitemap) continue;
        rawUrls.push(...sitemap.locs);
        if (rawUrls.length >= maxUrls) break;
      }
    } else {
      rawUrls.push(...root2.locs);
    }
    const urls = [];
    const seen = /* @__PURE__ */ new Set();
    for (const rawUrl of rawUrls) {
      if (urls.length >= maxUrls) break;
      const url = sameOriginUrl(rawUrl);
      const key = url ? crawlKey(url) : null;
      if (!url || !key || seen.has(key)) continue;
      seen.add(key);
      urls.push(url);
    }
    return urls;
  }
};
