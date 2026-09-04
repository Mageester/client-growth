import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { SCHEMA_SQL } from "@/db/schema";
import { ClientSchema, ServiceSchema } from "@/core/schema";
import { CrossWorkspaceError } from "@/db/tenant";
import { runAnalysis } from "../app/lib/analysis.server";
import { clientState } from "../app/lib/portfolio";
import { __setSessionResolver } from "../app/lib/session.server";
import { d1LikeOver } from "./helpers/testAuth";
import * as clientDetail from "../app/routes/clients.$id";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const FIRST_RUN_AT = new Date("2026-09-04T12:00:00.000Z");
const SECOND_RUN_AT = new Date("2026-09-04T12:06:00.000Z");

let raw: Database.Database;
let scope: { db: never; workspaceId: string };
let otherScope: { db: never; workspaceId: string };
let env: Record<string, unknown>;

function sqlDbOver(db: Database.Database) {
  const stmt = (sql: string, bound: unknown[]) => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    all: async () => db.prepare(sql).all(...(bound as never[])),
    first: async () => db.prepare(sql).get(...(bound as never[])) ?? null,
    run: async () => ({ rowsAffected: db.prepare(sql).run(...(bound as never[])).changes }),
  });
  return { prepare: (sql: string) => stmt(sql, []), exec: async (s: string) => void db.exec(s) };
}

const PAGE = `<!doctype html><html><head><title>Cool Air</title></head><body>
<nav><a href="/services">Services</a><a href="/contact">Contact</a></nav>
<h1>Cool Air Heating</h1>
<p>${"We service homes across the county. ".repeat(30)}</p>
</body></html>`;

const SERVICES_PAGE = `<!doctype html><html><head><title>Services</title></head><body>
<h1>Our services</h1><h2>Furnace repair</h2><h2>Duct cleaning</h2>
<p>${"Furnace repair and duct cleaning for homes. ".repeat(30)}</p>
</body></html>`;

/** Serves a small, deterministic two-page site. No network. */
function siteFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/sitemap.xml")) return new Response("", { status: 404 });
    const body = url.includes("/services") ? SERVICES_PAGE : PAGE;
    return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
}

beforeEach(async () => {
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  raw.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  raw.exec(SCHEMA_SQL);

  const db = sqlDbOver(raw) as never;
  await createWorkspaceForOwner(db, { id: "ws_a", name: "A", ownerUserId: "u_a" });
  await createWorkspaceForOwner(db, { id: "ws_b", name: "B", ownerUserId: "u_b" });
  scope = { db, workspaceId: "ws_a" };
  otherScope = { db, workspaceId: "ws_b" };

  await repo.upsertService(
    scope,
    ServiceSchema.parse({
      id: "svc_a",
      name: "Service Landing Page",
      description: "",
      priceMin: 900,
      priceMax: 1800,
      tags: ["landing-page"],
      active: true,
    }),
  );
  await repo.upsertClient(
    scope,
    ClientSchema.parse({
      id: "cli_a",
      name: "Cool Air",
      domain: "coolair.example",
      offerings: ["furnace repair", "duct cleaning", "heat pump installation"],
      notes: "",
    }),
  );
  await repo.upsertClient(
    otherScope,
    ClientSchema.parse({
      id: "cli_b",
      name: "Other",
      domain: "other.example",
      offerings: ["x"],
      notes: "",
    }),
  );

  env = { AI_PROVIDER: "mock", MAX_AI_CALLS_PER_RUN: "10" };
});

afterEach(() => {
  __setSessionResolver(null);
  vi.unstubAllGlobals();
  raw.close();
});

describe("every analysis persists a truthful outcome", () => {
  it("records a run that read the site and found work", async () => {
    vi.stubGlobal("fetch", siteFetch());
    const result = await runAnalysis(scope, env, "cli_a");

    const run = await repo.getLatestAnalysisRun(scope, "cli_a");
    expect(run).not.toBeNull();
    expect(run!.outcome).toBe(result.verdict.outcome);
    expect(run!.pagesRead).toBeGreaterThan(0);
    expect(run!.summary).toBe(result.verdict.summary);
    expect(["findings", "clean"]).toContain(run!.outcome);
  });

  it("honours MAX_AI_CALLS_PER_RUN from the environment", async () => {
    // The per-run spend ceiling is configuration, not a constant, so the wiring
    // from env -> pipeline is asserted rather than assumed. Candidates beyond the
    // cap are left unjudged, never surfaced unjudged.
    vi.stubGlobal("fetch", siteFetch());
    const capped = await runAnalysis(scope, { ...env, MAX_AI_CALLS_PER_RUN: "1" }, "cli_a");

    expect(capped.stats.aiCalls).toBe(1);
    expect(capped.stats.evaluated).toBe(1);
    expect(capped.opportunities.length).toBeLessThanOrEqual(1);
  });

  it("records inconclusive — never clean — when the domain cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    );
    const result = await runAnalysis(scope, env, "cli_a");

    expect(result.opportunities).toHaveLength(0);
    expect(result.verdict.outcome).toBe("inconclusive");

    const run = await repo.getLatestAnalysisRun(scope, "cli_a");
    expect(run!.outcome).toBe("inconclusive");
    expect(run!.pagesRead).toBe(0);
    expect(run!.summary).not.toMatch(/no unmet billable work/i);
    expect(clientState({ outcome: run!.outcome, openCount: 0 })).toBe("inconclusive");
  });

  it("records inconclusive for a domain the URL policy refuses outright", async () => {
    const outbound = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", outbound as unknown as typeof fetch);
    await repo.upsertClient(
      scope,
      ClientSchema.parse({
        id: "cli_a",
        name: "Cool Air",
        domain: "127.0.0.1",
        offerings: ["furnace repair", "duct cleaning"],
        notes: "",
      }),
    );

    const result = await runAnalysis(scope, env, "cli_a");
    expect(result.verdict.outcome).toBe("inconclusive");
    expect(result.verdict.limitation).toMatch(/network policy/i);
    // Fail closed: a refused target must never be fetched.
    expect(outbound).not.toHaveBeenCalled();

    const run = await repo.getLatestAnalysisRun(scope, "cli_a");
    expect(run!.blockedEvents).toBeGreaterThan(0);
    expect(run!.outcome).toBe("inconclusive");
  });

  it("produces no opportunity at all from a failed crawl", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
    );
    const result = await runAnalysis(scope, env, "cli_a");
    expect(result.opportunities).toHaveLength(0);
    expect(await repo.listOpportunities(scope, "cli_a")).toHaveLength(0);
    expect(result.verdict.outcome).toBe("inconclusive");
  });

  it("keeps a history so an earlier clean run is not overwritten by a later failure", async () => {
    vi.stubGlobal("fetch", siteFetch());
    await runAnalysis(scope, env, "cli_a", { now: FIRST_RUN_AT });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    );
    await runAnalysis(scope, env, "cli_a", { now: SECOND_RUN_AT });

    const runs = await repo.listAnalysisRuns(scope, "cli_a", 10);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.outcome).toBe("inconclusive");
    expect(runs[0]!.finishedAt >= runs[1]!.finishedAt).toBe(true);
  });

  it("reports the newest run per client, not an arbitrary row", async () => {
    vi.stubGlobal("fetch", siteFetch());
    await runAnalysis(scope, env, "cli_a", { now: FIRST_RUN_AT });
    await runAnalysis(scope, env, "cli_a", { now: SECOND_RUN_AT });

    const latest = await repo.getLatestAnalysisRun(scope, "cli_a");
    const byClient = await repo.latestAnalysisRunByClient(scope);
    expect(byClient.get("cli_a")?.id).toBe(latest!.id);
  });
});

describe("analysis runs are workspace-scoped", () => {
  it("a run written for another workspace's client is rejected", async () => {
    await expect(
      repo.recordAnalysisRun(scope, {
        clientId: "cli_b",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        source: "http",
        outcome: "clean",
        summary: "x",
        limitation: null,
        pagesRead: 1,
        pagesFetched: 1,
        blockedEvents: 0,
        inconclusiveEvents: 0,
        surfaced: 0,
        stats: {},
        trigger: "manual",
        newCount: 0,
        resolvedCount: 0,
        evaluatorCalls: 0,
        evaluatorRejections: 0,
        evaluatorErrors: 0,
      }),
    ).rejects.toBeInstanceOf(CrossWorkspaceError);
  });

  it("one workspace never sees another workspace's runs", async () => {
    vi.stubGlobal("fetch", siteFetch());
    await runAnalysis(scope, env, "cli_a");

    expect(await repo.getLatestAnalysisRun(otherScope, "cli_a")).toBeNull();
    expect(await repo.listAnalysisRuns(otherScope, "cli_a")).toHaveLength(0);
    expect(await repo.latestAnalysisRunByClient(otherScope)).toHaveProperty("size", 0);
  });

  it("analyzing another workspace's client 404s before any network call", async () => {
    const outbound = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", outbound as unknown as typeof fetch);
    await expect(runAnalysis(scope, env, "cli_b")).rejects.toBeInstanceOf(Response);
    expect(outbound).not.toHaveBeenCalled();
  });
});

describe("the client page tells the truth about the last run", () => {
  beforeEach(() => {
    __setSessionResolver(async () => ({
      userId: "u_a",
      user: { id: "u_a", email: "a@x.example", name: "A" },
    }));
  });

  it("shows the inconclusive state rather than an empty clean page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    );
    await runAnalysis(scope, env, "cli_a");

    const ctx = { cloudflare: { env: { ...env, DB: d1LikeOver(raw) } } };
    const data = (await clientDetail.loader({
      request: new Request("http://localhost/clients/cli_a"),
      params: { id: "cli_a" },
      context: ctx,
    } as never)) as { state: string; runs: Array<{ outcome: string }> };

    expect(data.state).toBe("inconclusive");
    expect(data.runs[0]!.outcome).toBe("inconclusive");
  });

  it("shows never-analyzed for a client with no runs", async () => {
    const ctx = { cloudflare: { env: { ...env, DB: d1LikeOver(raw) } } };
    const data = (await clientDetail.loader({
      request: new Request("http://localhost/clients/cli_a"),
      params: { id: "cli_a" },
      context: ctx,
    } as never)) as { state: string; runs: unknown[] };
    expect(data.state).toBe("never");
    expect(data.runs).toHaveLength(0);
  });
});
