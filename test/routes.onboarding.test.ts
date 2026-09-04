import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as repo from "@/db/repositories";
import { getWorkspaceForUser } from "@/db/workspaces";
import { SCHEMA_SQL } from "@/db/schema";
import { __setSessionResolver } from "../app/lib/session.server";
import { d1LikeOver } from "./helpers/testAuth";

import * as onboarding from "../app/routes/onboarding";

/**
 * Onboarding is two stages, and these tests exist to keep it that way.
 *
 * Thirteen of the first fourteen real analysis runs came back inconclusive. The
 * cause was not the engine: it was a single-stage signup that asked an agency
 * owner to type what a client sells from memory, before Axiom Orbit had shown
 * them anything. Four of six real clients were recorded with one offering or
 * none, and the engine needs two before it will claim anything is missing —
 * every one of those runs was structurally guaranteed to fail.
 *
 * The rules being defended here:
 *
 *   1. Stage one reads the site and NOTHING else. No evaluator, no run
 *      recorded, so a first attempt costs nothing and cannot leave a client
 *      looking analyzed.
 *   2. A crawl that fails is carried forward and said out loud, not swallowed.
 *   3. Nothing the crawl proposed is saved because it was proposed. Only the
 *      boxes a person left checked are written to the client.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let raw: Database.Database;
let scope: { db: never; workspaceId: string };
let ctx: { cloudflare: { env: Record<string, unknown> } };

function sqlDbOver(db: Database.Database) {
  const stmt = (sql: string, bound: unknown[]) => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    all: async () => db.prepare(sql).all(...(bound as never[])),
    first: async () => db.prepare(sql).get(...(bound as never[])) ?? null,
    run: async () => ({ rowsAffected: db.prepare(sql).run(...(bound as never[])).changes }),
  });
  return { prepare: (sql: string) => stmt(sql, []), exec: async (s: string) => void db.exec(s) };
}

function formReq(fields: Record<string, string | string[]>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
  }
  return new Request("http://localhost/onboarding", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

async function call(fn: (a: unknown) => unknown, args: unknown): Promise<unknown> {
  try {
    return await fn(args);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

const HOME = `<!doctype html><html><head><title>Northwind Heating</title></head><body>
<nav><a href="/services/heat-pump-installation">Heat Pump Installation</a>
<a href="/services/boiler-repair">Boiler Repair</a>
<a href="/about">About</a></nav>
<h1>Northwind Heating</h1>
<p>${"We keep homes warm across the county all winter long. ".repeat(30)}</p>
</body></html>`;

function servicePage(title: string) {
  return `<!doctype html><html><head><title>${title}</title></head><body>
<h1>${title}</h1><p>${`Book ${title.toLowerCase()} with our engineers today. `.repeat(30)}</p>
</body></html>`;
}

/** A small, deterministic site with a real services section. No network. */
function siteFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/sitemap.xml")) return new Response("", { status: 404 });
    if (url.includes("/services/heat-pump-installation")) {
      return new Response(servicePage("Heat Pump Installation"), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url.includes("/services/boiler-repair")) {
      return new Response(servicePage("Boiler Repair"), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response(HOME, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
}

/** The whole site is unreachable — a DNS failure, not a 404. */
function deadFetch(): typeof fetch {
  return vi.fn(async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  }) as unknown as typeof fetch;
}

const SETUP_FIELDS = {
  workspaceName: "Axiom Web",
  landingOn: "on",
  landingName: "Service Landing Page",
  landingMin: "900",
  landingMax: "1800",
  servicepagesOn: "on",
  servicepagesName: "Service Pages Build",
  servicepagesMin: "2500",
  servicepagesMax: "6000",
  conversionOn: "on",
  conversionName: "Conversion Path Fix",
  conversionMin: "300",
  conversionMax: "900",
  clientName: "Northwind Heating",
  clientDomain: "northwind.example",
};

beforeEach(async () => {
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  raw.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  raw.exec(SCHEMA_SQL);
  scope = { db: sqlDbOver(raw) as never, workspaceId: "" };
  __setSessionResolver(async () => ({
    userId: "u_new",
    user: { id: "u_new", email: "new@x.example", name: "New" },
  }));
  ctx = {
    cloudflare: {
      env: {
        DB: d1LikeOver(raw),
        BETTER_AUTH_SECRET: "x".repeat(40),
        BETTER_AUTH_URL: "http://localhost:8787",
        AI_PROVIDER: "mock",
        MAX_AI_CALLS_PER_RUN: "10",
      },
    },
  };
});

afterEach(() => {
  __setSessionResolver(null);
  vi.unstubAllGlobals();
  raw.close();
});

/** The workspace stage one just created, plus a scope pointing at it. */
async function workspaceScope() {
  const ws = await getWorkspaceForUser(scope.db, "u_new");
  expect(ws).not.toBeNull();
  return { db: scope.db, workspaceId: ws!.id };
}

async function runSetup() {
  return (await call(onboarding.action as never, {
    request: formReq(SETUP_FIELDS),
    context: ctx,
  })) as Response;
}

describe("onboarding stage one: read the site, judge nothing", () => {
  it("creates the client with no offerings and hands stage two the crawl", async () => {
    vi.stubGlobal("fetch", siteFetch());
    const res = await runSetup();

    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location).toMatch(/^\/onboarding\?client=client-northwind-heating-/);

    const t = await workspaceScope();
    const clientId = new URL(location, "http://localhost").searchParams.get("client")!;
    const client = await repo.getClient(t, clientId);

    // The offerings box is gone from stage one on purpose: what a business
    // sells is a question the site answers better than its agency's memory.
    expect(client!.offerings).toEqual([]);

    // Evidence, but no verdict. Spending an evaluator call here would judge a
    // client profile that is still empty, and recording a run would make the
    // client look analyzed when nothing was assessed.
    expect(await repo.getLatestEvidence(t, clientId)).not.toBeNull();
    expect(await repo.getLatestAnalysisRun(t, clientId)).toBeNull();
  });

  it("reaches stage two with nothing invented when the site is unreachable", async () => {
    vi.stubGlobal("fetch", deadFetch());
    const res = await runSetup();

    // The workspace, catalog and client all survive — only the reading failed,
    // and stage two says so and offers a retry rather than stranding the user.
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/onboarding\?client=/);

    const t = await workspaceScope();
    const clients = await repo.listClients(t);
    expect(clients).toHaveLength(1);

    // A crawl that reached nothing stores an empty bundle rather than throwing,
    // and an empty bundle must stay empty: no page was read, so no offering can
    // be suggested and no run may be recorded.
    const evidence = await repo.getLatestEvidence(t, clients[0]!.id);
    expect(evidence!.site.pages).toHaveLength(0);
    expect(clients[0]!.offerings).toEqual([]);
    expect(await repo.getLatestAnalysisRun(t, clients[0]!.id)).toBeNull();
  });

  it("requires at least one service, since findings are priced from the catalog", async () => {
    const res = (await call(onboarding.action as never, {
      request: formReq({
        workspaceName: "Axiom Web",
        clientName: "Northwind Heating",
        clientDomain: "northwind.example",
      }),
      context: ctx,
    })) as { error?: string };

    expect(res.error).toMatch(/at least one service/i);
  });

  it("rejects a bad domain before creating any workspace", async () => {
    const res = (await call(onboarding.action as never, {
      request: formReq({ ...SETUP_FIELDS, clientDomain: "not a domain" }),
      context: ctx,
    })) as { error?: string };

    expect(res.error).toMatch(/website address/i);
    expect(await getWorkspaceForUser(scope.db, "u_new")).toBeNull();
  });
});

describe("onboarding stage two: the agency confirms", () => {
  async function reachStageTwo() {
    vi.stubGlobal("fetch", siteFetch());
    const res = await runSetup();
    const clientId = new URL(res.headers.get("location")!, "http://localhost").searchParams.get(
      "client",
    )!;
    return { t: await workspaceScope(), clientId };
  }

  it("offers what the crawl found, with its provenance, and saves none of it yet", async () => {
    const { t, clientId } = await reachStageTwo();

    const data = (await call(onboarding.loader as never, {
      request: new Request("http://localhost/onboarding?client=" + clientId),
      context: ctx,
    })) as {
      stage: string;
      crawl: { readablePages: number } | null;
      suggestions: Array<{ label: string; evidence: unknown[] }>;
    };

    expect(data.stage).toBe("confirm");
    expect(data.crawl!.readablePages).toBeGreaterThan(0);
    expect(data.suggestions.length).toBeGreaterThan(0);
    // A suggestion with no provenance is something the agency has to verify
    // from scratch anyway, so there is no unattributed line in this list.
    for (const suggestion of data.suggestions) {
      expect(suggestion.evidence.length).toBeGreaterThan(0);
    }

    // Reading stage two changes nothing. Only the confirm post writes.
    expect((await repo.getClient(t, clientId))!.offerings).toEqual([]);
  });

  it("saves only the boxes left checked, and merges what was typed", async () => {
    const { t, clientId } = await reachStageTwo();

    const res = (await call(onboarding.action as never, {
      request: formReq({
        intent: "analyze",
        clientId,
        // One suggestion kept, one dropped — the dropped one must not appear.
        offering: ["Heat Pump Installation"],
        moreOfferings: "boiler servicing\nHEAT PUMP INSTALLATION\n",
      }),
      context: ctx,
    })) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/opportunities?client=" + clientId);

    const client = await repo.getClient(t, clientId);
    // Deduped case-insensitively, keeping the spelling the agency confirmed.
    expect(client!.offerings).toEqual(["Heat Pump Installation", "boiler servicing"]);
    expect(client!.offerings).not.toContain("Boiler Repair");

    // Now, and only now, is a run recorded.
    expect(await repo.getLatestAnalysisRun(t, clientId)).not.toBeNull();
  });

  it("will not re-enter onboarding for a client that has been analyzed", async () => {
    const { clientId } = await reachStageTwo();
    await call(onboarding.action as never, {
      request: formReq({
        intent: "analyze",
        clientId,
        offering: ["Heat Pump Installation", "Boiler Repair"],
      }),
      context: ctx,
    });

    const res = (await call(onboarding.loader as never, {
      request: new Request("http://localhost/onboarding?client=" + clientId),
      context: ctx,
    })) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/opportunities?client=" + clientId);
  });

  it("re-reads the site on request without recording a run", async () => {
    const { t, clientId } = await reachStageTwo();

    const res = (await call(onboarding.action as never, {
      request: formReq({ intent: "reread", clientId }),
      context: ctx,
    })) as Response;

    expect(res.headers.get("location")).toBe("/onboarding?client=" + clientId);
    expect(await repo.getLatestAnalysisRun(t, clientId)).toBeNull();
  });
});
