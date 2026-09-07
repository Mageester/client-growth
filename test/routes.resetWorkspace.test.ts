import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as repo from "@/db/repositories";
import { nodeSqliteDb } from "@/db/nodeSqlite";
import { SCHEMA_SQL } from "@/db/schema";
import type { SqlBatchStatement, SqlDb, SqlValue } from "@/db/sql";
import {
  createWorkspaceForOwner,
  getWorkspace,
  resetWorkspace,
} from "@/db/workspaces";
import { hvacEvidence } from "./helpers/fixtures";
import { ClientSchema, OpportunitySchema, ServiceSchema } from "@/core/schema";
import { __setSessionResolver } from "../app/lib/session.server";
import { d1Db } from "../app/lib/d1.server";

import * as onboarding from "../app/routes/onboarding";
import * as settings from "../app/routes/settings";

/**
 * Regression coverage for owner-only "Reset workspace".
 *
 * The invariants under test:
 *
 *   1. Reset is ATOMIC. Every destructive statement runs in one db.batch; a
 *      failure anywhere leaves the workspace exactly as it was.
 *   2. Reset erases product state only. The workspace row, its id, the owner
 *      membership, the analysis_limit_reservations ledger and every Better Auth
 *      row survive untouched.
 *   3. Only the owner can trigger it, and only with the workspace name typed
 *      exactly — checked at the write boundary, not just in the UI.
 *   4. Onboarding treats an empty workspace (zero clients AND zero services) as
 *      needing agency setup again, renames the SAME workspace, and never
 *      creates a second one.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const WS_ID = "ws_reset";
const OWNER_ID = "u_owner";
const MEMBER_ID = "u_member";

// ---------------------------------------------------------------------------
// test doubles
// ---------------------------------------------------------------------------

/** better-sqlite3-backed D1-like binding WITH a transactional batch. */
function d1LikeOverWithBatch(raw: Database.Database) {
  const stmt = (sql: string, bound: unknown[]) => ({
    // Carry the SQL and bound params on the handle, as a real D1 prepared
    // statement does, so batch() can execute the handles it receives.
    sql,
    params: bound,
    bind: (...v: unknown[]) => stmt(sql, v),
    all: async () => ({ results: raw.prepare(sql).all(...(bound as never[])) }),
    first: async () => (raw.prepare(sql).get(...(bound as never[])) ?? null),
    run: async () => ({ meta: { changes: raw.prepare(sql).run(...(bound as never[])).changes } }),
  });
  return {
    prepare: (sql: string) => stmt(sql, []),
    exec: async (sql: string) => {
      raw.exec(sql);
    },
    batch: async (statements: Array<{ sql: string; params?: unknown[] }>) => {
      raw.exec("BEGIN");
      try {
        const results = [] as Array<{ meta: { changes: number } }>;
        for (const s of statements) {
          results.push({
            meta: { changes: raw.prepare(s.sql).run(...((s.params ?? []) as never[])).changes },
          });
        }
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

/** SqlDb over the D1-like binding above. */
function sqlDbOver(raw: Database.Database): SqlDb {
  return d1Db(d1LikeOverWithBatch(raw) as never);
}

function formReq(path: string, fields: Record<string, string | string[]>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
  }
  return new Request("http://localhost" + path, {
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

/** Deterministic unreachable site: onboarding POSTs still create rows, reads fail. */
function deadFetch(): typeof fetch {
  return vi.fn(async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// shared fixture state
// ---------------------------------------------------------------------------

let raw: Database.Database;
let db: SqlDb;
let ctx: { cloudflare: { env: Record<string, unknown> } };

async function seedAuthRows(): Promise<void> {
  const now = "2026-09-01T00:00:00.000Z";
  raw
    .prepare(
      `INSERT INTO "user" ("id","name","email","emailVerified","image","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(OWNER_ID, "Owner", "owner@example.test", 1, null, now, now);
  raw
    .prepare(
      `INSERT INTO "user" ("id","name","email","emailVerified","image","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(MEMBER_ID, "Member", "member@example.test", 1, null, now, now);
  raw
    .prepare(
      `INSERT INTO "session" ("id","expiresAt","token","createdAt","updatedAt","ipAddress","userAgent","userId")
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run("sess_owner", "2027-01-01T00:00:00.000Z", "tok_owner", now, now, null, null, OWNER_ID);
  raw
    .prepare(
      `INSERT INTO "account" ("id","issuer","accountId","providerId","userId","accessToken","refreshToken","idToken","accessTokenExpiresAt","refreshTokenExpiresAt","scope","password","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      "acct_owner",
      "issuer",
      "acct-1",
      "credential",
      OWNER_ID,
      null,
      null,
      null,
      null,
      null,
      null,
      "hashed-password",
      now,
      now,
    );
}

async function seedWorkspace(): Promise<void> {
  await createWorkspaceForOwner(db, { id: WS_ID, name: "Axiom Web", ownerUserId: OWNER_ID });
  // A non-owner member whose row must not survive reset.
  raw
    .prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?,?,?,?)`,
    )
    .run(WS_ID, MEMBER_ID, "member", "2026-09-01T00:00:00.000Z");
}

async function seedProductData(): Promise<void> {
  const t = { db, workspaceId: WS_ID };
  await repo.upsertService(
    t,
    ServiceSchema.parse({
      id: "svc_landing",
      name: "Service Landing Page",
      description: "",
      priceMin: 900,
      priceMax: 1800,
      tags: ["landing-page"],
      active: true,
    }),
  );
  await repo.upsertClient(
    t,
    ClientSchema.parse({
      id: "cli_northwind",
      name: "Northwind Heating",
      domain: "northwind.example",
      offerings: ["Heat Pump Installation"],
      notes: "",
    }),
  );
  // Monitoring state lives on the client row; it must vanish with the client.
  raw
    .prepare(
      `UPDATE clients SET monitoring_cadence = 'weekly', monitoring_next_due_at = ? WHERE id = ?`,
    )
    .run("2026-09-02T00:00:00.000Z", "cli_northwind");
  await repo.setCoverage(t, "cli_northwind", "svc_landing", "retainer");
  await repo.saveEvidence(t, { ...hvacEvidence(), clientId: "cli_northwind" });
  await repo.saveAnalysis(t, [
    OpportunitySchema.parse({
      id: "opp_northwind",
      dedupeKey: "northwind-landing",
      clientId: "cli_northwind",
      ruleId: "missing-service-page",
      title: "Build a landing page",
      detected: "The page is missing.",
      evidenceRefs: [],
      rationale: "Sellable work.",
      suggestedServiceId: "svc_landing",
      suggestedScope: ["Build the page"],
      priceMin: 900,
      priceMax: 1800,
      confidence: 0.9,
      billableStatus: "billable",
      status: "new",
      updatedAt: "2026-09-01T00:00:00.000Z",
    }),
  ]);
  await repo.recordAnalysisRun(t, {
    clientId: "cli_northwind",
    startedAt: "2026-09-01T00:00:00.000Z",
    finishedAt: "2026-09-01T00:01:00.000Z",
    source: "fixture",
    outcome: "findings",
    summary: "One finding.",
    limitation: null,
    pagesRead: 1,
    pagesFetched: 1,
    blockedEvents: 0,
    inconclusiveEvents: 0,
    surfaced: 1,
    stats: {},
    trigger: "manual",
    newCount: 1,
    resolvedCount: 0,
    evaluatorCalls: 0,
    evaluatorRejections: 0,
    evaluatorErrors: 0,
  });
  raw
    .prepare(
      `INSERT INTO client_competitors (id, workspace_id, client_id, name, domain, created_at)
       VALUES (?,?,?,?,?,?)`,
    )
    .run("comp_1", WS_ID, "cli_northwind", "Rival Heat", "rival.example", "2026-09-01T00:00:00.000Z");
  raw
    .prepare(`INSERT INTO workspace_branding (workspace_id, logo, updated_at) VALUES (?,?,?)`)
    .run(WS_ID, "data:image/png;base64,iVBORw0KGgo=", "2026-09-01T00:00:00.000Z");
  raw
    .prepare(
      `INSERT INTO workspace_invitations
         (id, workspace_id, invited_email, role, token_hash, expires_at, invited_by_user_id, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      "inv_1",
      WS_ID,
      "invitee@example.test",
      "member",
      "invite-token-hash",
      "2026-10-01T00:00:00.000Z",
      OWNER_ID,
      "2026-09-01T00:00:00.000Z",
    );
  raw
    .prepare(
      `INSERT INTO proposal_shares
         (id, workspace_id, opportunity_id, token_hash, snapshot, created_by_user_id, created_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      "share_1",
      WS_ID,
      "opp_northwind",
      "share-token-hash",
      JSON.stringify({ agencyName: "Axiom Web" }),
      OWNER_ID,
      "2026-09-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    );
  // The append-only usage ledger that reset must never touch.
  raw
    .prepare(
      `INSERT INTO analysis_limit_reservations (workspace_id, client_id, reserved_at, day_utc)
       VALUES (?,?,?,?)`,
    )
    .run(WS_ID, "cli_northwind", "2026-09-01T00:00:00.000Z", "2026-09-01");
}

interface Counts {
  clients: number;
  services: number;
  coverage: number;
  evidence: number;
  opportunities: number;
  analysisRuns: number;
  competitors: number;
  branding: number;
  invitations: number;
  proposalShares: number;
  reservations: number;
  members: number;
  ownerMembers: number;
  nonOwnerMembers: number;
}

async function counts(): Promise<Counts> {
  const one = (sql: string, ...bind: SqlValue[]): number => {
    const row = raw.prepare(sql).get(...(bind as never[])) as { c: number } | undefined;
    return Number(row?.c ?? 0);
  };
  return {
    clients: one(`SELECT COUNT(*) AS c FROM clients WHERE workspace_id = ?`, WS_ID),
    services: one(`SELECT COUNT(*) AS c FROM services WHERE workspace_id = ?`, WS_ID),
    coverage: one(`SELECT COUNT(*) AS c FROM client_coverage WHERE workspace_id = ?`, WS_ID),
    evidence: one(`SELECT COUNT(*) AS c FROM evidence_bundles WHERE workspace_id = ?`, WS_ID),
    opportunities: one(`SELECT COUNT(*) AS c FROM opportunities WHERE workspace_id = ?`, WS_ID),
    analysisRuns: one(`SELECT COUNT(*) AS c FROM analysis_runs WHERE workspace_id = ?`, WS_ID),
    competitors: one(`SELECT COUNT(*) AS c FROM client_competitors WHERE workspace_id = ?`, WS_ID),
    branding: one(`SELECT COUNT(*) AS c FROM workspace_branding WHERE workspace_id = ?`, WS_ID),
    invitations: one(
      `SELECT COUNT(*) AS c FROM workspace_invitations WHERE workspace_id = ?`,
      WS_ID,
    ),
    proposalShares: one(`SELECT COUNT(*) AS c FROM proposal_shares WHERE workspace_id = ?`, WS_ID),
    reservations: one(
      `SELECT COUNT(*) AS c FROM analysis_limit_reservations WHERE workspace_id = ?`,
      WS_ID,
    ),
    members: one(`SELECT COUNT(*) AS c FROM workspace_members WHERE workspace_id = ?`, WS_ID),
    ownerMembers: one(
      `SELECT COUNT(*) AS c FROM workspace_members WHERE workspace_id = ? AND user_id = ?`,
      WS_ID,
      OWNER_ID,
    ),
    nonOwnerMembers: one(
      `SELECT COUNT(*) AS c FROM workspace_members WHERE workspace_id = ? AND user_id <> ?`,
      WS_ID,
      OWNER_ID,
    ),
  };
}

function configuredCounts(): Counts {
  return {
    clients: 1,
    services: 1,
    coverage: 1,
    evidence: 1,
    opportunities: 1,
    analysisRuns: 1,
    competitors: 1,
    branding: 1,
    invitations: 1,
    proposalShares: 1,
    reservations: 1,
    members: 2,
    ownerMembers: 1,
    nonOwnerMembers: 1,
  };
}

const resetFields = {
  intent: "reset-workspace",
  confirmWorkspaceName: "Axiom Web",
};

beforeEach(async () => {
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  raw.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  raw.exec(SCHEMA_SQL);
  db = sqlDbOver(raw);
  await seedAuthRows();
  await seedWorkspace();
  __setSessionResolver(async () => ({
    userId: OWNER_ID,
    user: { id: OWNER_ID, email: "owner@example.test", name: "Owner" },
  }));
  ctx = {
    cloudflare: {
      env: {
        DB: d1LikeOverWithBatch(raw),
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

// ---------------------------------------------------------------------------
// 1. adapter batch semantics
// ---------------------------------------------------------------------------

describe("SqlDb.batch adapters", () => {
  it("D1 adapter prepares and binds every statement and calls binding.batch exactly once", async () => {
    const preparedStatements: Array<{ sql: string; params: unknown[] }> = [];
    const batchCalls: Array<unknown[]> = [];
    const binding = {
      prepare(sql: string) {
        const entry = { sql, params: [] as unknown[] };
        preparedStatements.push(entry);
        const handle = {
          bind: (...values: unknown[]) => {
            entry.params = values;
            return handle;
          },
        };
        return handle;
      },
      batch(statements: unknown[]) {
        batchCalls.push(statements);
        return Promise.resolve(statements.map(() => ({ meta: { changes: 5 } })));
      },
      exec: () => Promise.resolve(),
    };

    const results = await d1Db(binding as never).batch([
      { sql: "DELETE FROM clients WHERE workspace_id = ?", params: ["ws_a"] },
      { sql: "DELETE FROM services WHERE workspace_id = ?" },
    ] satisfies SqlBatchStatement[]);

    // Every statement was prepared, in order, with the right SQL...
    expect(preparedStatements.map((s) => s.sql)).toEqual([
      "DELETE FROM clients WHERE workspace_id = ?",
      "DELETE FROM services WHERE workspace_id = ?",
    ]);
    // ...params were bound where supplied (and omitted statements stay unbound)...
    expect(preparedStatements[0]!.params).toEqual(["ws_a"]);
    expect(preparedStatements[1]!.params).toEqual([]);
    // ...and the binding's batch primitive was used EXACTLY once with both statements.
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0]).toHaveLength(2);
    expect(results).toEqual([{ rowsAffected: 5 }, { rowsAffected: 5 }]);
  });

  it("D1 adapter propagates a batch rejection to the caller", async () => {
    const failure = new Error("D1 batch failed");
    const binding = {
      prepare: () => ({ bind: () => ({}) }),
      batch: () => Promise.reject(failure),
      exec: () => Promise.resolve(),
    };
    await expect(
      d1Db(binding as never).batch([{ sql: "DELETE FROM clients WHERE workspace_id = ?" }]),
    ).rejects.toBe(failure);
  });

  it("node:sqlite batch rolls back all preceding writes when a statement fails", async () => {
    const node = nodeSqliteDb(":memory:");
    try {
      await node.exec(SCHEMA_SQL);
      await node.batch([
        {
          sql: `INSERT INTO workspaces (id, name, owner_user_id, created_at) VALUES (?,?,?,?)`,
          params: ["ws_batch", "Batch WS", "u_batch", "2026-09-01T00:00:00.000Z"],
        },
        // Violates the workspace_members composite primary key (duplicate row).
        {
          sql: `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
                VALUES ('ws_batch','u_batch','owner','2026-09-01T00:00:00.000Z')`,
        },
        {
          sql: `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
                VALUES ('ws_batch','u_batch','owner','2026-09-01T00:00:00.000Z')`,
        },
      ] satisfies SqlBatchStatement[]).then(
        () => {
          throw new Error("expected the batch to reject");
        },
        () => undefined,
      );

      const ws = await node
        .prepare(`SELECT COUNT(*) AS c FROM workspaces WHERE id = 'ws_batch'`)
        .first<{ c: number }>();
      const members = await node
        .prepare(`SELECT COUNT(*) AS c FROM workspace_members WHERE workspace_id = 'ws_batch'`)
        .first<{ c: number }>();
      // The whole batch aborted: neither the workspace nor its member was committed.
      expect(ws?.c).toBe(0);
      expect(members?.c).toBe(0);
    } finally {
      node.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. resetWorkspace domain function
// ---------------------------------------------------------------------------

describe("resetWorkspace", () => {
  it("erases product state, preserves workspace id, owner membership and reservations", async () => {
    await seedProductData();
    expect(await counts()).toEqual(configuredCounts());

    const result = await resetWorkspace(db, WS_ID, OWNER_ID, "Axiom Web");

    expect(result).toEqual({ ok: true, workspaceId: WS_ID });
    expect(await counts()).toEqual({
      clients: 0,
      services: 0,
      coverage: 0,
      evidence: 0,
      opportunities: 0,
      analysisRuns: 0,
      competitors: 0,
      branding: 0,
      invitations: 0,
      proposalShares: 0,
      // The append-only ledger survives, so usage limits are NOT reset.
      reservations: 1,
      members: 1,
      ownerMembers: 1,
      nonOwnerMembers: 0,
    });

    const ws = await getWorkspace(db, WS_ID);
    expect(ws).not.toBeNull();
    expect(ws!.id).toBe(WS_ID);
    expect(ws!.name).toBe("Axiom Web");
    expect(ws!.ownerUserId).toBe(OWNER_ID);

    const reservation = raw
      .prepare(
        `SELECT client_id, reserved_at, day_utc FROM analysis_limit_reservations WHERE workspace_id = ?`,
      )
      .get(WS_ID) as { client_id: string; reserved_at: string; day_utc: string };
    expect(reservation).toEqual({
      client_id: "cli_northwind",
      reserved_at: "2026-09-01T00:00:00.000Z",
      day_utc: "2026-09-01",
    });

    expect(await raw.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  });

  it("rejects a non-owner without deleting anything", async () => {
    await seedProductData();

    const result = await resetWorkspace(db, WS_ID, MEMBER_ID, "Axiom Web");

    expect(result).toEqual({
      ok: false,
      error: "Only the workspace owner can reset the workspace.",
    });
    expect(await counts()).toEqual(configuredCounts());
  });

  it("rejects a wrong confirmation name without deleting anything", async () => {
    await seedProductData();

    const result = await resetWorkspace(db, WS_ID, OWNER_ID, "Axiom Web & Co");

    expect(result).toEqual({
      ok: false,
      error: "Confirmation did not match the workspace name.",
    });
    expect(await counts()).toEqual(configuredCounts());
  });

  it("leaves the workspace untouched when the batch fails mid-reset", async () => {
    await seedProductData();

    // A db whose batch always fails, simulating a mid-batch statement error.
    const failingDb: SqlDb = {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare(sql),
      batch: () => Promise.reject(new Error("simulated mid-batch failure")),
    };

    const result = await resetWorkspace(failingDb, WS_ID, OWNER_ID, "Axiom Web");

    expect(result).toEqual({
      ok: false,
      error: "Reset could not be completed. Nothing was changed.",
    });
    // Nothing was partially deleted: every pre-reset row is still there.
    expect(await counts()).toEqual(configuredCounts());
  });
});

// ---------------------------------------------------------------------------
// 3. settings route
// ---------------------------------------------------------------------------

describe("settings reset-workspace intent", () => {
  it("redirects the owner to /onboarding after a successful reset", async () => {
    await seedProductData();

    const res = (await call(settings.action as never, {
      request: formReq("/settings", resetFields),
      context: ctx,
    })) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/onboarding");
    expect(await counts()).toEqual({
      clients: 0,
      services: 0,
      coverage: 0,
      evidence: 0,
      opportunities: 0,
      analysisRuns: 0,
      competitors: 0,
      branding: 0,
      invitations: 0,
      proposalShares: 0,
      reservations: 1,
      members: 1,
      ownerMembers: 1,
      nonOwnerMembers: 0,
    });
  });

  it("rejects a non-owner POST with an error and deletes nothing", async () => {
    await seedProductData();
    __setSessionResolver(async () => ({
      userId: MEMBER_ID,
      user: { id: MEMBER_ID, email: "member@example.test", name: "Member" },
    }));

    const result = (await call(settings.action as never, {
      request: formReq("/settings", resetFields),
      context: ctx,
    })) as { error?: string };

    expect(result.error).toMatch(/owner/i);
    expect(await counts()).toEqual(configuredCounts());
  });

  it("rejects a wrong confirmation with an error and deletes nothing", async () => {
    await seedProductData();

    const result = (await call(settings.action as never, {
      request: formReq("/settings", { ...resetFields, confirmWorkspaceName: "axiom web" }),
      context: ctx,
    })) as { error?: string };

    expect(result.error).toMatch(/match/i);
    expect(await counts()).toEqual(configuredCounts());
  });

  it("keeps Better Auth user, session and account rows intact", async () => {
    await seedProductData();
    const authBefore = {
      user: raw.prepare(`SELECT * FROM "user" WHERE id = ?`).get(OWNER_ID),
      session: raw.prepare(`SELECT * FROM "session" WHERE id = ?`).get("sess_owner"),
      account: raw.prepare(`SELECT * FROM "account" WHERE id = ?`).get("acct_owner"),
    };

    await call(settings.action as never, {
      request: formReq("/settings", resetFields),
      context: ctx,
    });

    expect(raw.prepare(`SELECT * FROM "user" WHERE id = ?`).get(OWNER_ID)).toEqual(
      authBefore.user,
    );
    expect(raw.prepare(`SELECT * FROM "session" WHERE id = ?`).get("sess_owner")).toEqual(
      authBefore.session,
    );
    expect(raw.prepare(`SELECT * FROM "account" WHERE id = ?`).get("acct_owner")).toEqual(
      authBefore.account,
    );
    // The owner is still resolvable as a workspace member, so the session keeps working.
    const ws = await getWorkspace(db, WS_ID);
    expect(ws).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. onboarding after reset
// ---------------------------------------------------------------------------

describe("onboarding for a reset (empty) workspace", () => {
  it("shows the agency field prefilled with the existing workspace name", async () => {
    // Workspace exists, zero clients AND zero services — the reset state.
    const data = (await call(onboarding.loader as never, {
      request: new Request("http://localhost/onboarding"),
      context: ctx,
    })) as {
      stage: string;
      hasWorkspace: boolean;
      needsAgencySetup: boolean;
      workspaceName: string;
    };

    expect(data.stage).toBe("setup");
    expect(data.hasWorkspace).toBe(true);
    expect(data.needsAgencySetup).toBe(true);
    expect(data.workspaceName).toBe("Axiom Web");

    const router = createMemoryRouter(
      [
        {
          path: "*",
          element: createElement(onboarding.default, { loaderData: data, actionData: undefined } as never),
        },
      ],
      { initialEntries: ["/onboarding"] },
    );
    const html = renderToStaticMarkup(createElement(RouterProvider, { router }));

    // The agency section is visible again, and the existing name is prefilled.
    expect(html).toContain("Your agency");
    expect(html).toMatch(/name="workspaceName"[^>]*value="Axiom Web"|value="Axiom Web"[^>]*name="workspaceName"/);
  });

  it("renames the SAME workspace on submit and never creates a second one", async () => {
    vi.stubGlobal("fetch", deadFetch());

    const res = (await call(onboarding.action as never, {
      request: formReq("/onboarding", {
        workspaceName: "Axiom Web Rebuilt",
        landingOn: "on",
        landingMin: "900",
        landingMax: "1800",
        clientName: "Fresh Client",
        clientDomain: "fresh.example",
      }),
      context: ctx,
    })) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/onboarding\?client=/);

    // Exactly one workspace, with the SAME id, renamed in place.
    const rows = raw.prepare(`SELECT id, name, owner_user_id FROM workspaces`).all() as Array<{
      id: string;
      name: string;
      owner_user_id: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ id: WS_ID, name: "Axiom Web Rebuilt", owner_user_id: OWNER_ID });

    const t = { db, workspaceId: WS_ID };
    expect(await repo.listClients(t)).toHaveLength(1);
    expect((await repo.listServices(t)).length).toBeGreaterThan(0);
  });

  it("keeps the workspace name when the submit reuses it", async () => {
    vi.stubGlobal("fetch", deadFetch());

    await call(onboarding.action as never, {
      request: formReq("/onboarding", {
        workspaceName: "Axiom Web",
        landingOn: "on",
        landingMin: "900",
        landingMax: "1800",
        clientName: "Fresh Client",
        clientDomain: "fresh.example",
      }),
      context: ctx,
    });

    const rows = raw.prepare(`SELECT id, name FROM workspaces`).all() as Array<{
      id: string;
      name: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ id: WS_ID, name: "Axiom Web" });
  });
});

describe("onboarding confirm-stage ordering (unchanged)", () => {
  it("still reaches the confirm stage via /onboarding?client=<id> after stage one", async () => {
    vi.stubGlobal("fetch", deadFetch());

    const setup = (await call(onboarding.action as never, {
      request: formReq("/onboarding", {
        workspaceName: "Axiom Web",
        landingOn: "on",
        landingMin: "900",
        landingMax: "1800",
        clientName: "Northwind Heating",
        clientDomain: "northwind.example",
      }),
      context: ctx,
    })) as Response;
    expect(setup.status).toBe(302);
    const clientId = new URL(
      setup.headers.get("location")!,
      "http://localhost",
    ).searchParams.get("client")!;

    // The workspace now has one client, yet ?client=<id> must still enter stage two.
    const data = (await call(onboarding.loader as never, {
      request: new Request("http://localhost/onboarding?client=" + clientId),
      context: ctx,
    })) as { stage: string; client: { id: string } };

    expect(data.stage).toBe("confirm");
    expect(data.client.id).toBe(clientId);
  });
});

describe("onboarding setup action hardening", () => {
  it("refuses to create anything for a configured workspace", async () => {
    await seedProductData();

    const res = (await call(onboarding.action as never, {
      request: formReq("/onboarding", {
        workspaceName: "Axiom Web",
        landingOn: "on",
        landingMin: "900",
        landingMax: "1800",
        clientName: "Sneaky Client",
        clientDomain: "sneaky.example",
      }),
      context: ctx,
    })) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/opportunities");

    const t = { db, workspaceId: WS_ID };
    expect(await repo.listClients(t)).toHaveLength(1);
    expect((await repo.getClient(t, "cli_northwind"))!.name).toBe("Northwind Heating");
    expect(await repo.listServices(t)).toHaveLength(1);
  });
});
