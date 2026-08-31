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
    const urls = bundle.site.pages.map((p) => p.url).sort();
    expect(urls).toEqual(
      [
        `${ORIGIN}/`,
        `${ORIGIN}/air-conditioning-repair`,
        `${ORIGIN}/duct-cleaning`,
        `${ORIGIN}/furnace-installation`,
      ].sort(),
    );
    expect(bundle.site.nav).toContain("Furnace Installation");
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
    expect(bundle.site.pages).toHaveLength(2);
  });
});
