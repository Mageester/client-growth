import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import type { TenantScope } from "@/db/tenant";
import { analyzeClient } from "@/pipeline/analyzeClient";
import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import { ClientSchema, ServiceSchema } from "@/core/schema";

/**
 * The full loop an agency actually lives in: analyze a client site, surface a
 * defect, hand it to the client, then re-analyze after they fix it. The stored
 * opportunity must stop counting as active billable work — and a run that never
 * reached the site must never cause that.
 */

let db: NodeSqliteDb;
let t: TenantScope;

const ORIGIN = "https://fixit.example";

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
    "/services/roof-repair": { status: 200, body: `<html><head><title>Roof Repair</title></head><body><h1>Roof Repair</h1><h2>roof repair</h2></body></html>` },
    "/services/gutter-cleaning": { status: 200, body: `<html><head><title>Gutter Cleaning</title></head><body><h1>Gutter Cleaning</h1><h2>gutter cleaning</h2></body></html>` },
    "/contact": { status: 200, body: `<html><head><title>Contact</title></head><body><h1>Contact Us</h1></body></html>` },
    "/get-a-quote": { status, body: `<html><head><title>Get a Quote</title></head><body><h1>Get a Quote</h1></body></html>` },
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

const unreachable: typeof fetch = async () => {
  throw new Error("getaddrinfo ENOTFOUND fixit.example");
};

/** Exactly what app/lib/analysis.server.ts does, over the real repositories. */
async function analyzeAndPersist(fetchImpl: typeof fetch) {
  const client = (await repo.getClient(t, "client-fixit"))!;
  const result = await analyzeClient({
    client,
    catalog: await repo.listServices(t),
    coverage: await repo.listCoverage(t, client.id),
    existing: await repo.listOpportunities(t, client.id),
    evidenceProvider: new HttpEvidenceProvider({ fetchImpl }),
    evaluator: new MockEvaluator(),
  });
  await repo.saveEvidence(t, result.evidence);
  await repo.saveAnalysis(t, [...result.opportunities, ...result.suppressed, ...result.resolved]);
  return result;
}

/** What the Opportunities page counts as active billable work. */
async function activeCount(): Promise<number> {
  const rows = await repo.listOpportunities(t, "client-fixit");
  return rows.filter(
    (o) => o.billableStatus === "billable" && (o.status === "new" || o.status === "proposal_prepared"),
  ).length;
}

beforeEach(async () => {
  db = nodeSqliteDb(":memory:");
  await repo.applySchema(db);
  await createWorkspaceForOwner(db, { id: "ws_test", name: "Test", ownerUserId: "u1" });
  t = { db, workspaceId: "ws_test" };

  for (const s of [
    { id: "svc-landing", name: "Service Landing Page", description: "", priceMin: 900, priceMax: 1800, tags: ["landing-page"], active: true },
    { id: "svc-conv", name: "Conversion Path Fix", description: "", priceMin: 300, priceMax: 900, tags: ["conversion-fix"], active: true },
  ]) {
    await repo.upsertService(t, ServiceSchema.parse(s));
  }
  await repo.upsertClient(
    t,
    ClientSchema.parse({
      id: "client-fixit",
      name: "Fixit Roofing",
      domain: "fixit.example",
      offerings: ["roof repair", "gutter cleaning"],
      notes: "",
    }),
  );
});

afterEach(() => db.close());

describe("analyze -> client fixes the site -> re-analyze", () => {
  it("stops billing for a defect the client has fixed", async () => {
    const first = await analyzeAndPersist(siteWhereQuotePageIs(404));
    expect(first.reachability.reached).toBe(true);
    expect(await activeCount()).toBe(1);

    const second = await analyzeAndPersist(siteWhereQuotePageIs(200));
    expect(second.reachability.reached).toBe(true);
    expect(second.stats.resolved).toBe(1);

    // The row is kept for history, but no longer counted or offered as work.
    const rows = await repo.listOpportunities(t, "client-fixit");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("resolved");
    expect(await activeCount()).toBe(0);
  });

  it("keeps the opportunity when the site could not be reached", async () => {
    await analyzeAndPersist(siteWhereQuotePageIs(404));
    expect(await activeCount()).toBe(1);

    const blind = await analyzeAndPersist(unreachable);
    expect(blind.reachability.reached).toBe(false);
    expect(blind.stats.resolved).toBe(0);

    // Nothing was learned, so nothing changes.
    expect(await activeCount()).toBe(1);
    const rows = await repo.listOpportunities(t, "client-fixit");
    expect(rows[0]!.status).toBe("new");
  });

  it("re-surfaces the opportunity if the client breaks it again", async () => {
    await analyzeAndPersist(siteWhereQuotePageIs(404));
    await analyzeAndPersist(siteWhereQuotePageIs(200));
    expect(await activeCount()).toBe(0);

    await analyzeAndPersist(siteWhereQuotePageIs(404));
    expect(await activeCount()).toBe(1);
    const rows = await repo.listOpportunities(t, "client-fixit");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("new");
  });
});
