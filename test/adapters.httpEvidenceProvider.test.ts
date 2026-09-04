import { describe, expect, it, vi } from "vitest";

import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { ClientSchema } from "@/core/schema";
import { loadRawHtml } from "./helpers/fixtures";

const ORIGIN = "https://coolbreezehvac.example";

const PAGES: Record<string, string> = {
  [`${ORIGIN}/`]: loadRawHtml("home.html"),
  [`${ORIGIN}/air-conditioning-repair`]: loadRawHtml("air-conditioning-repair.html"),
  [`${ORIGIN}/furnace-installation`]: loadRawHtml("furnace-installation.html"),
  [`${ORIGIN}/duct-cleaning`]: loadRawHtml("duct-cleaning.html"),
};

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function makeFetch() {
  return vi.fn(async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = PAGES[url];
    if (body) return htmlResponse(body);
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

const client = ClientSchema.parse({
  id: "client-coolbreeze",
  name: "Cool Breeze HVAC",
  domain: "coolbreezehvac.example",
  offerings: [],
});

describe("HttpEvidenceProvider", () => {
  it("crawls same-origin pages via injected fetch and returns an http bundle", async () => {
    const fetchImpl = makeFetch();
    const provider = new HttpEvidenceProvider({
      fetchImpl,
      now: () => new Date("2026-08-30T00:00:00.000Z"),
    });

    const bundle = await provider.getEvidence(client);

    expect(bundle.source).toBe("http");
    expect(bundle.clientId).toBe("client-coolbreeze");
    const htmlUrls = bundle.site.pages
      .filter((p) => p.status === 200)
      .map((p) => p.url)
      .sort();
    expect(htmlUrls).toEqual(
      [
        `${ORIGIN}/`,
        `${ORIGIN}/air-conditioning-repair`,
        `${ORIGIN}/duct-cleaning`,
        `${ORIGIN}/furnace-installation`,
      ].sort(),
    );
    expect(bundle.site.nav).toContain("Furnace Installation");
    const home = bundle.site.pages.find((p) => p.url === `${ORIGIN}/`);
    expect(home?.metaDescription).toBe("");
    expect(home?.structuredDataTypes).toEqual([]);
    expect(home?.structuredDataPresent).toBe(false);
    expect(home?.images).toEqual([]);
    // Non-OK crawled URLs are recorded with their status (for the conversion rule).
    const errorPages = bundle.site.pages.filter((p) => p.status >= 400);
    expect(errorPages.map((p) => p.url).sort()).toEqual(
      [`${ORIGIN}/about`, `${ORIGIN}/contact`].sort(),
    );
    expect(errorPages.every((p) => p.status === 404)).toBe(true);
    expect(errorPages.every((p) => p.metaDescription === undefined)).toBe(true);
    expect(errorPages.every((p) => p.structuredDataTypes === undefined)).toBe(true);
    expect(errorPages.every((p) => p.images === undefined)).toBe(true);
  });

  it("never requests an off-origin URL", async () => {
    const fetchImpl = makeFetch();
    const provider = new HttpEvidenceProvider({ fetchImpl });
    await provider.getEvidence(client);

    const requested = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => String(c[0]),
    );
    expect(requested.every((u) => u.startsWith(ORIGIN))).toBe(true);
    expect(requested).not.toContain("https://facebook.com/coolbreezehvac");
  });

  it("respects the maxPages cap", async () => {
    const provider = new HttpEvidenceProvider({ fetchImpl: makeFetch(), maxPages: 2 });
    const bundle = await provider.getEvidence(client);
    expect(bundle.site.pages.filter((p) => p.status === 200)).toHaveLength(2);
  });
});

describe("HttpEvidenceProvider.probe", () => {
  it("returns the final status and falls back HEAD -> GET on 405", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method });
      if (url.endsWith("/dead")) return new Response("", { status: 404 });
      if (url.endsWith("/head-hostile")) {
        return method === "HEAD"
          ? new Response("", { status: 405 })
          : new Response("ok", { status: 200 });
      }
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new HttpEvidenceProvider({ fetchImpl });

    expect((await provider.probe("https://x.example/dead")).status).toBe(404);

    const r = await provider.probe("https://x.example/head-hostile");
    expect(r.status).toBe(200);
    expect(calls.filter((c) => c.url.endsWith("/head-hostile")).map((c) => c.method)).toEqual([
      "HEAD",
      "GET",
    ]);
  });

  it("returns status 0 when the request throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;
    const provider = new HttpEvidenceProvider({ fetchImpl });
    const r = await provider.probe("https://nope.example/");
    expect(r.status).toBe(0);
    expect(r.ok).toBe(false);
  });
});
