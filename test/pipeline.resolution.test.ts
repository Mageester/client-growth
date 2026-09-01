import { describe, expect, it } from "vitest";

import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import { analyzeClient } from "@/pipeline/analyzeClient";
import type { Client, Service } from "@/core/schema";

const ORIGIN = "https://fixit.example";

/** A small real-shaped site whose "Get a Free Quote" CTA can be broken or fixed. */
function siteWhereQuotePageIs(status: number): typeof fetch {
  const pages: Record<string, { status: number; body: string }> = {
    "/": {
      status: 200,
      body: `<html><head><title>Fixit Roofing</title></head><body>
        <nav><a href="/services/roof-repair">Roof Repair</a>
             <a href="/services/gutter-cleaning">Gutter Cleaning</a>
             <a href="/contact">Contact Us</a></nav>
        <h1>Fixit Roofing</h1><a href="/get-a-quote">Get a Free Quote</a></body></html>`,
    },
    "/services/roof-repair": {
      status: 200,
      body: `<html><head><title>Roof Repair</title></head><body><h1>Roof Repair</h1><h2>roof repair</h2></body></html>`,
    },
    "/services/gutter-cleaning": {
      status: 200,
      body: `<html><head><title>Gutter Cleaning</title></head><body><h1>Gutter Cleaning</h1><h2>gutter cleaning</h2></body></html>`,
    },
    "/contact": {
      status: 200,
      body: `<html><head><title>Contact</title></head><body><h1>Contact Us</h1></body></html>`,
    },
    "/get-a-quote": {
      status,
      body: `<html><head><title>Get a Quote</title></head><body><h1>Get a Quote</h1></body></html>`,
    },
  };
  return async (input, init) => {
    const url = new URL(String(input));
    const headers = { "content-type": "text/html" };
    const entry = pages[url.pathname];
    if (!entry) return new Response("nf", { status: 404, headers });
    if (((init as RequestInit | undefined)?.method ?? "GET") === "HEAD") {
      return new Response(null, { status: entry.status, headers });
    }
    return new Response(entry.body, { status: entry.status, headers });
  };
}

/** A domain that never answers — the "client site is down / typo'd" case. */
const deadFetch: typeof fetch = async () => {
  throw new Error("getaddrinfo ENOTFOUND");
};

const client: Client = {
  id: "c1",
  name: "Fixit Roofing",
  domain: "fixit.example",
  offerings: ["roof repair", "gutter cleaning"],
  notes: "",
};

const catalog: Service[] = [
  { id: "svc-landing", name: "Service Landing Page", description: "", priceMin: 900, priceMax: 1800, tags: ["landing-page"], active: true },
  { id: "svc-conv", name: "Conversion Path Fix", description: "", priceMin: 300, priceMax: 900, tags: ["conversion-fix"], active: true },
];

const run = (fetchImpl: typeof fetch, existing = [] as never[]) =>
  analyzeClient({
    client,
    catalog,
    coverage: [],
    existing,
    evidenceProvider: new HttpEvidenceProvider({ fetchImpl }),
    evaluator: new MockEvaluator(),
  });

describe("re-analysis reconciles against the current state of the site", () => {
  it("marks a previously surfaced opportunity resolved once the client fixes it", async () => {
    const before = await run(siteWhereQuotePageIs(404));
    expect(before.reachability.reached).toBe(true);
    expect(before.opportunities.map((o) => o.ruleId)).toContain("broken-conversion-path");

    const after = await run(siteWhereQuotePageIs(200), before.opportunities as never);
    expect(after.opportunities).toHaveLength(0);
    expect(after.resolved.map((o) => o.status)).toEqual(["resolved"]);
    expect(after.stats.resolved).toBe(1);
    // The resolved row keeps its identity so the upsert updates in place.
    expect(after.resolved[0]!.dedupeKey).toBe(before.opportunities[0]!.dedupeKey);
  });

  it("never resolves anything from a run that could not reach the site", async () => {
    const before = await run(siteWhereQuotePageIs(404));
    const after = await run(deadFetch, before.opportunities as never);

    expect(after.reachability.reached).toBe(false);
    expect(after.resolved).toHaveLength(0);
    expect(after.stats.resolved).toBe(0);
  });

  it("leaves an agency decision (dismissed / snoozed) alone", async () => {
    const before = await run(siteWhereQuotePageIs(404));
    const dismissed = before.opportunities.map((o) => ({ ...o, status: "dismissed" as const }));

    const after = await run(siteWhereQuotePageIs(200), dismissed as never);
    expect(after.resolved).toHaveLength(0);
  });
});
