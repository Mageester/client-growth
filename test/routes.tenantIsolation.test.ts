import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { SCHEMA_SQL } from "@/db/schema";
import { ClientSchema, ServiceSchema } from "@/core/schema";
import { __setSessionResolver } from "../app/lib/session.server";
import { d1LikeOver } from "./helpers/testAuth";

// Route modules under test (loaders/actions are plain functions).
import * as clientDetail from "../app/routes/clients.$id";
import * as clientsIndex from "../app/routes/clients._index";
import * as oppDetail from "../app/routes/opportunities.$id";
import * as oppIndex from "../app/routes/opportunities._index";
import * as servicesIndex from "../app/routes/services._index";
import * as settings from "../app/routes/settings";
import * as changes from "../app/routes/changes";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let raw: Database.Database;
let ctx: { cloudflare: { env: Record<string, unknown> } };

const svc = (id: string) =>
  ServiceSchema.parse({
    id,
    name: id,
    description: "",
    priceMin: 100,
    priceMax: 200,
    tags: ["landing-page"],
    active: true,
  });
const cli = (id: string) =>
  ClientSchema.parse({ id, name: id, domain: `${id}.example`, offerings: ["x"], notes: "" });

function sqlDbOver(db: Database.Database) {
  const stmt = (sql: string, bound: unknown[]) => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    all: async () => db.prepare(sql).all(...(bound as never[])),
    first: async () => db.prepare(sql).get(...(bound as never[])) ?? null,
    run: async () => ({ rowsAffected: db.prepare(sql).run(...(bound as never[])).changes }),
  });
  return { prepare: (sql: string) => stmt(sql, []), exec: async (s: string) => void db.exec(s) };
}

function asA() {
  __setSessionResolver(async () => ({
    userId: "u_a",
    user: { id: "u_a", email: "a@x.example", name: "A" },
  }));
}
function asAnon() {
  __setSessionResolver(async () => null);
}
function req(url = "http://localhost/", init?: RequestInit) {
  return new Request(url, init);
}
function formReq(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

/** Run a loader/action and return either its value or the thrown Response. */
async function call(fn: (a: unknown) => unknown, args: unknown): Promise<unknown> {
  try {
    return await fn(args);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

beforeEach(async () => {
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  raw.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  raw.exec(SCHEMA_SQL);

  const db = sqlDbOver(raw) as never;
  await createWorkspaceForOwner(db, { id: "ws_a", name: "A", ownerUserId: "u_a" });
  await createWorkspaceForOwner(db, { id: "ws_b", name: "B", ownerUserId: "u_b" });
  const A = { db, workspaceId: "ws_a" };
  const B = { db, workspaceId: "ws_b" };

  await repo.upsertService(A, svc("svc_a"));
  await repo.upsertClient(A, cli("cli_a"));
  await repo.upsertService(B, svc("svc_b"));
  await repo.upsertClient(B, cli("cli_b"));
  await repo.saveAnalysis(B, [
    (await import("@/core/schema")).OpportunitySchema.parse({
      id: "opp_b",
      dedupeKey: "k",
      clientId: "cli_b",
      ruleId: "missing-service-page",
      title: "T",
      detected: "d",
      evidenceRefs: [],
      rationale: "r",
      suggestedServiceId: "svc_b",
      suggestedScope: [],
      priceMin: 100,
      priceMax: 200,
      confidence: 0.8,
      billableStatus: "billable",
      status: "new",
      updatedAt: "2026-08-31T00:00:00.000Z",
    }),
  ]);

  ctx = { cloudflare: { env: { DB: d1LikeOver(raw), BETTER_AUTH_SECRET: "x".repeat(40), BETTER_AUTH_URL: "http://localhost:8787", AI_PROVIDER: "mock" } } };
});

afterEach(() => {
  __setSessionResolver(null);
  raw.close();
});

describe("Workspace A cannot reach Workspace B data via the routes", () => {
  it("GET /clients/:id for B's client -> 404", async () => {
    asA();
    const res = await call(clientDetail.loader as never, { request: req(), params: { id: "cli_b" }, context: ctx });
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(404);
  });

  it("POST /clients/:id save on B's client -> 404, B unchanged", async () => {
    asA();
    const res = await call(clientDetail.action as never, {
      request: formReq({ intent: "save", name: "hijacked", domain: "evil.example" }),
      params: { id: "cli_b" },
      context: ctx,
    });
    expect((res as Response).status).toBe(404);
    expect((raw.prepare("SELECT name FROM clients WHERE id='cli_b'").get() as { name: string }).name).toBe("cli_b");
  });

  it("POST /opportunities analyze with B's clientId -> no analysis, B unchanged", async () => {
    asA();
    const before = raw.prepare("SELECT count(*) c FROM opportunities WHERE client_id='cli_b'").get() as { c: number };
    const res = (await call(oppIndex.action as never, {
      request: formReq({ clientId: "cli_b" }),
      context: ctx,
    })) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    const after = raw.prepare("SELECT count(*) c FROM opportunities WHERE client_id='cli_b'").get() as { c: number };
    expect(after.c).toBe(before.c);
  });

  it("GET /opportunities/:id for B's opportunity -> 404", async () => {
    asA();
    const res = await call(oppDetail.loader as never, { request: req(), params: { id: "opp_b" }, context: ctx });
    expect((res as Response).status).toBe(404);
  });

  it("POST /opportunities/:id dismiss / snooze / prepare-proposal on B's opp -> 404, unchanged", async () => {
    asA();
    for (const intent of ["dismiss", "snooze", "prepare-proposal"]) {
      const res = await call(oppDetail.action as never, {
        request: formReq({ intent, days: "10" }),
        params: { id: "opp_b" },
        context: ctx,
      });
      expect((res as Response).status).toBe(404);
    }
    const stored = raw.prepare("SELECT status, proposal_md FROM opportunities WHERE id='opp_b'").get() as {
      status: string;
      proposal_md: string | null;
    };
    expect(stored.status).toBe("new");
    expect(stored.proposal_md).toBeNull();
  });

  it("GET /services and /clients only list A's rows", async () => {
    asA();
    const s = (await call(servicesIndex.loader as never, { request: req(), context: ctx })) as {
      services: { id: string }[];
    };
    expect(s.services.map((x) => x.id)).toEqual(["svc_a"]);

    const c = (await call(clientsIndex.loader as never, { request: req(), context: ctx })) as {
      clients: { id: string }[];
    };
    expect(c.clients.map((x) => x.id)).toEqual(["cli_a"]);
  });

  it("GET /changes builds the action center only from A's portfolio", async () => {
    asA();
    const home = (await call(changes.loader as never, { request: req(), context: ctx })) as {
      portfolio: { clients: number };
      actionCenter: {
        primary: Array<{ client: { id: string } }>;
        attention: Array<{ client: { id: string } }>;
      };
    };

    expect(home.portfolio.clients).toBe(1);
    expect(
      [...home.actionCenter.primary, ...home.actionCenter.attention].every(
        (item) => item.client.id === "cli_a",
      ),
    ).toBe(true);
    expect(JSON.stringify(home.actionCenter)).not.toContain("cli_b");
  });

  it("POST /services toggle-active on B's service -> no-op, B unchanged", async () => {
    asA();
    await call(servicesIndex.action as never, {
      request: formReq({ intent: "toggle-active", id: "svc_b" }),
      context: ctx,
    });
    expect((raw.prepare("SELECT active FROM services WHERE id='svc_b'").get() as { active: number }).active).toBe(1);
  });
});

describe("unauthenticated access to protected routes", () => {
  const protectedLoaders: Array<[string, (a: unknown) => unknown]> = [
    ["/opportunities", oppIndex.loader as never],
    ["/opportunities/:id", oppDetail.loader as never],
    ["/clients", clientsIndex.loader as never],
    ["/clients/:id", clientDetail.loader as never],
    ["/services", servicesIndex.loader as never],
    ["/settings", settings.loader as never],
    ["/changes", changes.loader as never],
  ];

  it("every protected loader redirects to /login when there is no session", async () => {
    asAnon();
    for (const [name, fn] of protectedLoaders) {
      const res = (await call(fn, { request: req(), params: { id: "x" }, context: ctx })) as Response;
      expect(res, name).toBeInstanceOf(Response);
      expect(res.status, name).toBe(302);
      expect(res.headers.get("location"), name).toBe("/login?returnTo=%2F");
    }
  });

  it("carries the exact protected destination through the login redirect", async () => {
    asAnon();
    const res = (await call(oppDetail.loader as never, {
      request: req("http://localhost/reports/report-1?view=summary"),
      params: { id: "report-1" },
      context: ctx,
    })) as Response;

    // The path and its query, encoded once. Login re-sanitizes before it
    // navigates, so an unsafe value that arrives here still resolves to "/".
    expect(res.headers.get("location")).toBe("/login?returnTo=%2Freports%2Freport-1%3Fview%3Dsummary");
  });

  it("protected actions also redirect to /login when unauthenticated", async () => {
    asAnon();
    const res = (await call(oppDetail.action as never, {
      request: formReq({ intent: "dismiss" }),
      params: { id: "opp_b" },
      context: ctx,
    })) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?returnTo=%2F");
  });
});
