import { describe, expect, it, vi } from "vitest";

import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { normalizeAndValidateUrl } from "@/adapters/evidence/urlPolicy";
import { analyzeClient } from "@/pipeline/analyzeClient";
import { ClientSchema, EvidenceBundleSchema, ServiceSchema } from "@/core/schema";
import type { EvidenceBundle, EvidencePage } from "@/core/schema";
import type { EvidenceProvider, ProbeResult } from "@/ports/EvidenceProvider";
import type { OpportunityEvaluator } from "@/ports/OpportunityEvaluator";

const PUBLIC = "https://public.example";

function client(domain: string, offerings: string[] = []): ReturnType<typeof ClientSchema.parse> {
  return ClientSchema.parse({
    id: "security-client",
    name: "Security Client",
    domain,
    offerings,
  });
}

function htmlResponse(body = "<html><title>Home</title><body>ok</body></html>", init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...init.headers },
    ...init,
  });
}

function xmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/xml; charset=utf-8", ...init.headers },
    ...init,
  });
}

function evidenceForPipeline(input: {
  pages?: Array<Partial<EvidencePage> & { url: string }>;
  links?: Array<{
    href: string;
    label: string;
    foundOn?: string[];
  }>;
}): EvidenceBundle {
  return EvidenceBundleSchema.parse({
    clientId: "security-client",
    source: "http",
    capturedAt: "2026-08-31T00:00:00.000Z",
    site: {
      pages: (input.pages ?? []).map((page) => ({
        url: page.url,
        status: page.status ?? 200,
        title: page.title ?? "",
        h1s: page.h1s ?? [],
        headings: page.headings ?? [],
        textExcerpt: page.textExcerpt ?? "",
        wordCount: page.wordCount ?? 100,
        forms: page.forms ?? [],
      })),
      nav: [],
      links: (input.links ?? []).map((link) => ({
        href: link.href,
        label: link.label,
        foundOn: link.foundOn ?? [`${PUBLIC}/`],
      })),
      sitemapUrls: [],
    },
  });
}

const conversionFix = ServiceSchema.parse({
  id: "svc-conversion-fix",
  name: "Conversion Path Fix",
  description: "Repair a broken conversion element.",
  priceMin: 300,
  priceMax: 900,
  tags: ["conversion-fix"],
  active: true,
});

const landingPage = ServiceSchema.parse({
  id: "svc-landing-page",
  name: "Service Landing Page",
  description: "Build a service page.",
  priceMin: 900,
  priceMax: 1800,
  tags: ["landing-page"],
  active: true,
});

describe("HttpEvidenceProvider network policy", () => {
  it.each([
    "http://localhost",
    "http://localhost.",
    "HTTP://LOCALHOST",
    "http://foo.localhost.",
    "http://service.local",
    "http://service.local.",
    "http://home.arpa",
    "http://intranet",
    "http://127.0.0.1",
    "http://127.1",
    "http://2130706433",
    "http://0177.0.0.1",
    "http://0x7f000001",
    "http://192.168.1.10",
    "http://10.0.0.1",
    "http://172.16.0.1",
    "http://169.254.169.254",
    "http://100.64.0.1",
    "http://0.0.0.0",
    "http://224.0.0.1",
    "http://[::1]",
    "http://[0:0:0:0:0:0:0:1]",
    "http://[::ffff:127.0.0.1]",
    "http://[::ffff:192.168.1.10]",
    "http://[fc00::1]",
    "http://[fd12:3456::1]",
    "http://[fe80::1]",
    "http://[fec0::1]",
    "http://[FE80:0:0:0:0:0:0:1]",
    "http://[FD00:0000:0000:0000:0000:0000:0000:0001]",
    "http://[2001:db8::1]",
    "file:///etc/passwd",
    "ftp://public.example/file",
    "javascript:alert(1)",
  ])("blocks unsafe URL %s before fetch", async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new HttpEvidenceProvider({ fetchImpl });

    const result = await provider.probe(url);

    expect(result.status).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("blocked");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["http://127.1/", "127.0.0.1"],
    ["http://2130706433/", "127.0.0.1"],
    ["http://0177.0.0.1/", "127.0.0.1"],
    ["http://0x7f000001/", "127.0.0.1"],
  ])("policy sees the canonical IPv4 address for %s", (input, canonicalHost) => {
    expect(new URL(input).hostname).toBe(canonicalHost);
    const result = normalizeAndValidateUrl(input);
    expect(result).toMatchObject({ ok: false, kind: "private-host" });
  });

  it("policy sees the canonical IPv4-mapped IPv6 address", () => {
    expect(new URL("http://[::ffff:127.0.0.1]/").hostname).toBe("[::ffff:7f00:1]");
    expect(normalizeAndValidateUrl("http://[::ffff:127.0.0.1]/")).toMatchObject({
      ok: false,
      kind: "private-host",
    });
  });

  it("removes fragments from the canonical URL sent to the network", () => {
    const result = normalizeAndValidateUrl("HTTPS://Public.Example/path#not-sent");

    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.url.toString()).toBe("https://public.example/path");
  });

  it("classifies a reserved IPv6 documentation literal as non-public", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new HttpEvidenceProvider({ fetchImpl });

    const result = await provider.probe("http://[2001:db8::1]/");

    expect(result.outcome).toBe("blocked");
    expect(result.reason).toMatch(/non-public IPv6/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows a public IPv6 literal after canonicalization", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl });

    const result = await provider.probe("HTTP://[2001:4860:4860::8888]/");

    expect(result.status).toBe(200);
    expect(result.outcome).toBe("complete");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    "http://user:pass@example.com/",
    "http://127.0.0.1@example.com/",
    "https://USER:PASS@Public.Example/",
  ])("rejects credentials in %s", async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new HttpEvidenceProvider({ fetchImpl });

    const result = await provider.probe(url);

    expect(result.status).toBe(0);
    expect(result.outcome).toBe("blocked");
    expect(result.reason).toMatch(/credential|userinfo/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a public normalized hostname and sends the centralized product User-Agent", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) =>
      new Response(null, { status: 204, headers: { "content-type": "text/plain" }, ...init }),
    ) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl });

    const result = await provider.probe("HTTPS://Public.Example/");

    expect(result.status).toBe(204);
    expect(result.outcome).toBe("complete");
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["user-agent"]).toMatch(/ClientGrowthBot/i);
  });

  it("records a blocked initial domain as network evidence without issuing a request", async () => {
    const fetchImpl = vi.fn(async () => htmlResponse()) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl });

    const result = await provider.getEvidence(client("http://localhost"));
    const networkEvents = (result as EvidenceBundle & {
      networkEvents: Array<{ outcome: string; reason: string }>;
    }).networkEvents;

    expect(result.site.pages).toEqual([]);
    expect(networkEvents).toEqual([
      expect.objectContaining({ outcome: "blocked" }),
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not persist credential-bearing links or form actions from HTML", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith("/sitemap.xml")) return new Response("", { status: 404 });
      return htmlResponse(
        `<a href="https://user:pass@public.example/get-a-quote">Get a Quote</a>` +
          `<form action="https://user:pass@public.example/submit"><button>Send</button></form>`,
      );
    }) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl, maxPages: 1 });

    const result = await provider.getEvidence(client("public.example"));

    expect(result.site.links.some((link) => link.href.includes("user:pass"))).toBe(false);
    expect(result.site.pages[0]?.forms[0]?.action).toBe("");
  });
});

describe("HttpEvidenceProvider redirect safety", () => {
  it("blocks a public URL redirecting to localhost before the next request", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("", { status: 302, headers: { location: "http://localhost/admin" } }),
    ) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl });

    const result = await provider.probe(`${PUBLIC}/start`);

    expect(result.status).toBe(0);
    expect(result.outcome).toBe("blocked");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("blocks a public URL redirecting to a private IP before the next request", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("", { status: 302, headers: { location: "http://192.168.1.10/secret" } }),
    ) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl });

    const result = await provider.probe(`${PUBLIC}/start`);

    expect(result.status).toBe(0);
    expect(result.outcome).toBe("blocked");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("blocks a crawler redirect to localhost without recording a page", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith("/sitemap.xml")) return new Response("", { status: 404 });
      return new Response("", { status: 302, headers: { location: "http://localhost/admin" } });
    }) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl });

    const result = await provider.getEvidence(client("public.example"));

    expect(result.site.pages).toEqual([]);
    expect(result.networkEvents).toEqual([
      expect.objectContaining({ outcome: "blocked" }),
    ]);
    const requestedUrls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => String(call[0]),
    );
    expect(requestedUrls).toContain(`${PUBLIC}/sitemap.xml`);
    expect(requestedUrls).not.toContain("http://localhost/admin");
  });

  it("follows a public same-origin redirect after validating it", async () => {
    const calls: Array<{ url: string; redirect: RequestRedirect }> = [];
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, redirect: init?.redirect as RequestRedirect });
      return url.endsWith("/start")
        ? new Response("", { status: 302, headers: { location: "/final" } })
        : new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl });

    const result = await provider.probe(`${PUBLIC}/start`);

    expect(result).toMatchObject({ status: 200, ok: true, finalUrl: `${PUBLIC}/final`, outcome: "complete" });
    expect(calls).toEqual([
      { url: `${PUBLIC}/start`, redirect: "manual" },
      { url: `${PUBLIC}/final`, redirect: "manual" },
    ]);
  });

  it("stops at the configured redirect-hop limit and never issues the next hop", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      const n = Number(new URL(url).pathname.slice(2) || "0");
      return new Response("", {
        status: 302,
        headers: { location: `${PUBLIC}/r${n + 1}` },
      });
    }) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl, maxRedirects: 2 });

    const result = await provider.probe(`${PUBLIC}/r0`);

    expect(result.status).toBe(0);
    expect(result.outcome).toBe("inconclusive");
    expect(result.reason).toMatch(/redirect/i);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not follow an unsupported-scheme redirect", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("", { status: 302, headers: { location: "javascript:alert(1)" } }),
    ) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl });

    const result = await provider.probe(`${PUBLIC}/start`);

    expect(result.status).toBe(0);
    expect(result.outcome).toBe("blocked");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not let a same-origin probe redirect to another public origin", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("", { status: 302, headers: { location: "https://other.example/" } }),
    ) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl });

    const result = await provider.probe(`${PUBLIC}/start`);

    expect(result.status).toBe(0);
    expect(result.outcome).toBe("blocked");
    expect(result.reason).toMatch(/origin/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a fetch implementation reports a hidden same-origin redirect", async () => {
    const fetchImpl = vi.fn(async () =>
      ({
        status: 200,
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
        body: null,
        url: `${PUBLIC}/hidden-final`,
      } as unknown as Response),
    ) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl });

    const page = await provider.fetchPage(`${PUBLIC}/hidden-start`);

    expect(page).toMatchObject({ kind: "network-failure", outcome: "inconclusive" });
    expect((page as { reason: string }).reason).toMatch(/manual|redirect/i);
  });

  it.each([401, 403, 429, 500, 503])(
    "treats targeted HTTP %i as an inconclusive fetch failure rather than absence evidence",
    async (status) => {
      const fetchImpl = vi.fn(async () => new Response("", { status })) as unknown as typeof fetch;
      const provider = new HttpEvidenceProvider({ fetchImpl });

      const page = await provider.fetchPage(`${PUBLIC}/service`);

      expect(page).toMatchObject({ kind: "network-failure", outcome: "inconclusive" });
      expect((page as { reason: string }).reason).toMatch(new RegExp(`HTTP ${status}`));
    },
  );

  it.each([404, 410])("keeps targeted HTTP %i as a definite missing-page result", async (status) => {
    const fetchImpl = vi.fn(async () => new Response("", { status })) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl });

    expect(await provider.fetchPage(`${PUBLIC}/missing`)).toBeNull();
  });
});

describe("HttpEvidenceProvider resource and response limits", () => {
  it("rejects an oversized Content-Length before reading the body", async () => {
    let bodyRead = false;
    const body = {
      getReader() {
        bodyRead = true;
        throw new Error("body should not be read after Content-Length rejection");
      },
      cancel: vi.fn(),
    } as unknown as ReadableStream<Uint8Array>;
    const fetchImpl = vi.fn(async () =>
      ({
        status: 200,
        ok: true,
        headers: new Headers({
          "content-type": "text/html",
          "content-length": "1001",
        }),
        body,
        url: "",
      } as unknown as Response),
    ) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl, maxResponseBytes: 1000 });

    const page = await provider.fetchPage(`${PUBLIC}/large`);

    expect(page).toMatchObject({ kind: "network-failure", outcome: "inconclusive" });
    expect(bodyRead).toBe(false);
  });

  it("cuts off a streaming response that exceeds the byte cap and cancels it", async () => {
    let cancelled = false;
    const body = {
      getReader() {
        let reads = 0;
        return {
          async read() {
            reads++;
            if (reads <= 3) return { done: false, value: new Uint8Array(8) };
            return { done: true, value: undefined };
          },
          async cancel() {
            cancelled = true;
          },
          releaseLock() {},
        } as unknown as ReadableStreamDefaultReader<Uint8Array>;
      },
    } as unknown as ReadableStream<Uint8Array>;
    const fetchImpl = vi.fn(async () =>
      ({
        status: 200,
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
        body,
        url: "",
      } as unknown as Response),
    ) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl, maxResponseBytes: 16 });

    const page = await provider.fetchPage(`${PUBLIC}/streaming-large`);

    expect(page).toMatchObject({ kind: "network-failure", outcome: "inconclusive" });
    expect(cancelled).toBe(true);
  });

  it("times out a response body that stalls after headers", async () => {
    let cancelled = false;
    const body = {
      getReader() {
        return {
          read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined),
          async cancel() {
            cancelled = true;
          },
          releaseLock() {},
        } as unknown as ReadableStreamDefaultReader<Uint8Array>;
      },
    } as unknown as ReadableStream<Uint8Array>;
    const fetchImpl = vi.fn(async () =>
      ({
        status: 200,
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
        body,
        url: "",
      } as unknown as Response),
    ) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl, requestTimeoutMs: 5 });

    const result = await Promise.race([
      provider.fetchPage(`${PUBLIC}/stalled-body`),
      new Promise<"test-timeout">((resolve) => setTimeout(() => resolve("test-timeout"), 100)),
    ]);

    expect(result).not.toBe("test-timeout");
    expect(result).toMatchObject({ kind: "network-failure", outcome: "inconclusive" });
    expect((result as { reason: string }).reason).toMatch(/timeout/i);
    expect(cancelled).toBe(true);
  });

  it.each([
    "application/pdf",
    "image/png",
    "video/mp4",
    "application/octet-stream",
  ])("does not parse non-HTML content type %s", async (contentType) => {
    const fetchImpl = vi.fn(async () =>
      new Response("<html><title>Not HTML</title></html>", {
        status: 200,
        headers: { "content-type": contentType },
      }),
    ) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl });

    expect(await provider.fetchPage(`${PUBLIC}/binary`)).toMatchObject({
      kind: "network-failure",
      outcome: "inconclusive",
    });
  });

  it("accepts XHTML pages and limits sitemap URLs consumed", async () => {
    const sitemap = [
      "https://public.example/services/one",
      "https://public.example/services/two",
      "https://public.example/services/three",
      "https://other.example/not-allowed",
    ].map((url) => `<loc>${url}</loc>`).join("");
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/sitemap.xml")) return xmlResponse(`<urlset>${sitemap}</urlset>`);
      return new Response(
        "<html xmlns='http://www.w3.org/1999/xhtml'><title>Home</title></html>",
        { status: 200, headers: { "content-type": "application/xhtml+xml" } },
      );
    }) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl, maxSitemapUrls: 2 });

    const result = await provider.getEvidence(client("public.example"));

    expect(result.site.sitemapUrls).toEqual([
      "https://public.example/services/one",
      "https://public.example/services/two",
    ]);
  });

  it("counts HEAD and fallback GET requests against the shared request budget", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() === "HEAD") return new Response("", { status: 405 });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl, maxRequests: 1 });

    const result = await provider.probe(`${PUBLIC}/head-hostile`);

    expect(result.status).toBe(0);
    expect(result.outcome).toBe("inconclusive");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("carries the request budget from crawl and sitemap activity into later probes", async () => {
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/sitemap.xml")) return new Response("", { status: 404 });
      if ((init?.method ?? "GET").toUpperCase() === "HEAD") return new Response("", { status: 200 });
      return htmlResponse();
    }) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl, maxRequests: 2 });

    await provider.getEvidence(client("public.example"));
    const result = await provider.probe(`${PUBLIC}/after-crawl`);

    expect(result.status).toBe(0);
    expect(result.outcome).toBe("inconclusive");
    expect(result.reason).toMatch(/budget/i);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns timeout/network failures as inconclusive", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      if (!init?.signal) throw new Error("missing abort signal");
      await new Promise<void>((resolve) => {
        init.signal?.addEventListener("abort", () => resolve(), { once: true });
        setTimeout(resolve, 20);
      });
      throw new Error("aborted");
    }) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl, requestTimeoutMs: 1 });

    const result = await provider.probe(`${PUBLIC}/slow`);

    expect(result.status).toBe(0);
    expect(result.outcome).toBe("inconclusive");
    expect(result.reason).toMatch(/timeout|network/i);
  });

  it("returns a timeout even when an injected fetch ignores abort", async () => {
    const fetchImpl = vi.fn(async () => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl, requestTimeoutMs: 5 });

    const result = await Promise.race([
      provider.probe(`${PUBLIC}/ignores-abort`),
      new Promise<"test-timeout">((resolve) => setTimeout(() => resolve("test-timeout"), 100)),
    ]);

    expect(result).not.toBe("test-timeout");
    expect(result).toMatchObject({ status: 0, outcome: "inconclusive" });
    expect((result as { reason: string }).reason).toMatch(/timeout/i);
  });
});

describe("network-policy failures fail closed in the analysis pipeline", () => {
  const evaluator: OpportunityEvaluator = {
    evaluate: vi.fn(async () => ({
      verdict: "surface" as const,
      confidence: 1,
      rationale: "should never be called",
      suggestedScope: [],
    })),
  };

  it("a blocked verification URL does not become missing-service-page or an AI call", async () => {
    const evidence = evidenceForPipeline({
      pages: [
        { url: `${PUBLIC}/services/furnace-repair`, title: "Furnace Repair" },
        { url: `${PUBLIC}/services/duct-cleaning`, title: "Duct Cleaning" },
      ],
      links: [{ href: `${PUBLIC}/pool-heater-installation`, label: "Pool Heater Installation" }],
    });
    const provider: EvidenceProvider = {
      getEvidence: async () => evidence,
      fetchPage: async (url) => ({
        kind: "network-failure" as const,
        requestedUrl: url,
        outcome: "blocked" as const,
        reason: "unsafe redirect to localhost",
      }),
    };

    const result = await analyzeClient({
      client: client("public.example", ["pool heater installation"]),
      catalog: [landingPage],
      coverage: [],
      evidenceProvider: provider,
      evaluator,
    });

    expect(result.opportunities).toEqual([]);
    expect(result.opportunities.some((o) => o.ruleId === "missing-service-page")).toBe(false);
    expect(result.stats.aiCalls).toBe(0);
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });

  it.each([
    "blocked destination",
    "unsafe redirect",
    "redirect limit exhaustion",
    "timeout",
    "oversized response",
    "invalid content type",
  ])("a %s cannot become broken-conversion-path or an AI call", async () => {
    const evidence = evidenceForPipeline({
      pages: [{ url: `${PUBLIC}/` }],
      links: [{ href: `${PUBLIC}/get-a-quote`, label: "Get a Quote" }],
    });
    const probe = vi.fn(async (url: string): Promise<ProbeResult> => ({
      requestedUrl: url,
      status: 0,
      finalUrl: url,
      ok: false,
      outcome: "blocked",
      reason: "network policy test",
    }));
    const provider: EvidenceProvider = {
      getEvidence: async () => evidence,
      probe,
    };

    const result = await analyzeClient({
      client: client("public.example"),
      catalog: [conversionFix],
      coverage: [],
      evidenceProvider: provider,
      evaluator,
    });

    expect(result.opportunities).toEqual([]);
    expect(result.opportunities.some((o) => o.ruleId === "broken-conversion-path")).toBe(false);
    expect(result.stats.aiCalls).toBe(0);
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });

  it("does not treat a prefix-matching third-party origin as same-origin", async () => {
    const evidence = evidenceForPipeline({
      pages: [{ url: `${PUBLIC}/` }],
      links: [{ href: "https://public.example.evil/get-a-quote", label: "Get a Quote" }],
    });
    const probe = vi.fn(async (url: string): Promise<ProbeResult> => ({
      requestedUrl: url,
      status: 404,
      finalUrl: url,
      ok: false,
      outcome: "complete",
    }));
    const provider: EvidenceProvider = {
      getEvidence: async () => evidence,
      probe,
    };

    const result = await analyzeClient({
      client: client("public.example"),
      catalog: [conversionFix],
      coverage: [],
      evidenceProvider: provider,
      evaluator,
    });

    expect(result.opportunities).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });
});
