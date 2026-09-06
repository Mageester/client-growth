import { describe, expect, it, vi } from "vitest";

import { DEFAULT_USER_AGENT, HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { ClientSchema } from "@/core/schema";
import { loadRawHtml } from "./helpers/fixtures";

const ORIGIN = "https://coolbreezehvac.example";

const PAGES: Record<string, string> = {
  [`${ORIGIN}/`]: loadRawHtml("home.html"),
  [`${ORIGIN}/air-conditioning-repair`]: loadRawHtml("air-conditioning-repair.html"),
  [`${ORIGIN}/furnace-installation`]: loadRawHtml("furnace-installation.html"),
  [`${ORIGIN}/duct-cleaning`]: loadRawHtml("duct-cleaning.html"),
};

const client = ClientSchema.parse({
  id: "client-coolbreeze",
  name: "Cool Breeze HVAC",
  domain: "coolbreezehvac.example",
  offerings: [],
});

/** A fetch that serves the fixture site plus whatever robots.txt is given. */
function siteFetch(robots: string | number) {
  const requested: string[] = [];
  const impl = vi.fn(async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    requested.push(url);
    if (url === `${ORIGIN}/robots.txt`) {
      if (typeof robots === "number") return new Response("", { status: robots });
      return new Response(robots, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    const body = PAGES[url];
    if (body) {
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, requested };
}

const provider = (fetchImpl: typeof fetch) =>
  new HttpEvidenceProvider({ fetchImpl, now: () => new Date("2026-09-06T00:00:00.000Z") });

describe("the crawler under robots.txt", () => {
  it("identifies itself with a product name and a contact address", () => {
    expect(DEFAULT_USER_AGENT).toMatch(/AxiomOrbitBot/);
    expect(DEFAULT_USER_AGENT).toMatch(/\+https:\/\//);
  });

  it("asks for robots.txt before it requests any page", async () => {
    const { impl, requested } = siteFetch("User-agent: *\nDisallow:\n");
    await provider(impl).getEvidence(client);

    expect(requested[0]).toBe(`${ORIGIN}/robots.txt`);
  });

  it("does not request a disallowed page, and records it as blocked", async () => {
    const { impl, requested } = siteFetch("User-agent: *\nDisallow: /duct-cleaning\n");
    const bundle = await provider(impl).getEvidence(client);

    expect(requested).not.toContain(`${ORIGIN}/duct-cleaning`);
    expect(bundle.site.pages.map((p) => p.url)).not.toContain(`${ORIGIN}/duct-cleaning`);
    // Blocked, not absent: the difference between "we were asked not to look"
    // and "this page does not exist" is the entire honesty guarantee.
    const blocked = bundle.networkEvents.filter((e) => e.outcome === "blocked");
    expect(blocked.some((e) => e.reason.includes("robots.txt"))).toBe(true);
    expect(bundle.site.crawlExhaustive).toBe(false);
  });

  it("still reads everything that is allowed", async () => {
    const { impl } = siteFetch("User-agent: *\nDisallow: /duct-cleaning\n");
    const bundle = await provider(impl).getEvidence(client);

    const read = bundle.site.pages.filter((p) => p.status === 200).map((p) => p.url);
    expect(read).toContain(`${ORIGIN}/`);
    expect(read).toContain(`${ORIGIN}/furnace-installation`);
  });

  it("treats an absent robots.txt as unrestricted", async () => {
    const { impl } = siteFetch(404);
    const bundle = await provider(impl).getEvidence(client);

    const read = bundle.site.pages.filter((p) => p.status === 200).map((p) => p.url);
    expect(read).toContain(`${ORIGIN}/duct-cleaning`);
    expect(bundle.networkEvents.some((e) => e.reason.includes("robots.txt"))).toBe(false);
  });

  it("treats a failing robots.txt as unrestricted rather than stopping the analysis", async () => {
    const { impl } = siteFetch(503);
    const bundle = await provider(impl).getEvidence(client);
    expect(bundle.site.pages.filter((p) => p.status === 200).length).toBeGreaterThan(1);
  });

  it("obeys a rule written specifically for this crawler", async () => {
    const { impl, requested } = siteFetch(
      ["User-agent: *", "Disallow:", "", "User-agent: AxiomOrbitBot", "Disallow: /furnace-installation"].join("\n"),
    );
    await provider(impl).getEvidence(client);
    expect(requested).not.toContain(`${ORIGIN}/furnace-installation`);
  });

  it("reports a disallowed page as blocked rather than missing when verifying absence", async () => {
    const { impl, requested } = siteFetch("User-agent: *\nDisallow: /services/\n");
    const p = provider(impl);
    await p.getEvidence(client);

    const result = await p.fetchPage(`${ORIGIN}/services/heat-pumps`);
    expect(requested).not.toContain(`${ORIGIN}/services/heat-pumps`);
    expect(result).toMatchObject({ kind: "network-failure", outcome: "blocked" });
  });

  it("does not call a disallowed URL a broken link", async () => {
    const { impl, requested } = siteFetch("User-agent: *\nDisallow: /private/\n");
    const p = provider(impl);
    await p.getEvidence(client);

    const probe = await p.probe(`${ORIGIN}/private/page`);
    expect(requested).not.toContain(`${ORIGIN}/private/page`);
    expect(probe.ok).toBe(false);
    expect(probe.outcome).toBe("blocked");
    expect(probe.status).toBe(0);
  });

  it("does not apply the client's rules to a link on someone else's site", async () => {
    const { impl } = siteFetch("User-agent: *\nDisallow: /private/\n");
    const p = provider(impl);
    await p.getEvidence(client);

    const probe = await p.probe("https://supplier.example/private/page");
    expect(probe.outcome).not.toBe("blocked");
  });
});
