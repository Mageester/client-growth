import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildProjectViews } from "@/core/projectPackaging";
import type { Client } from "@/core/schema";
import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import type { RunResult, SqlDb, SqlStatement, SqlValue } from "@/db/sql";
import { runAnalysis } from "../app/lib/analysis.server";
import * as clientDetail from "../app/routes/clients.$id";
import { __setSessionResolver } from "../app/lib/session.server";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const PRODUCTION_SCHEMA_LAST_MIGRATION = "0022_sales_funnel.sql";

function applyProductionSchemaThrough0022(raw: Database.Database): void {
  for (const migration of readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql") && file <= PRODUCTION_SCHEMA_LAST_MIGRATION)
    .sort()) {
    raw.exec(readFileSync(join(migrationsDir, migration), "utf8"));
  }
}

function recordingSqlDb(raw: Database.Database, statements: string[]): SqlDb {
  const statement = (sql: string, bound: SqlValue[]): SqlStatement => ({
    bind(...values: SqlValue[]) {
      return statement(sql, values);
    },
    all<T>() {
      return Promise.resolve(raw.prepare(sql).all(...(bound as never[])) as T[]);
    },
    first<T>() {
      return Promise.resolve((raw.prepare(sql).get(...(bound as never[])) ?? null) as T | null);
    },
    run(): Promise<RunResult> {
      const result = raw.prepare(sql).run(...(bound as never[]));
      return Promise.resolve({ rowsAffected: Number(result.changes ?? 0) });
    },
  });

  return {
    exec(sql) {
      raw.exec(sql);
      return Promise.resolve();
    },
    prepare(sql) {
      statements.push(sql);
      return statement(sql, []);
    },
    async batch(batchStatements) {
      raw.exec("BEGIN");
      try {
        const results = batchStatements.map((batchStatement) => {
          const result = raw
            .prepare(batchStatement.sql)
            .run(...((batchStatement.params ?? []) as never[]));
          return { rowsAffected: Number(result.changes ?? 0) };
        });
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function recordingD1Database(raw: Database.Database, statements: string[]) {
  const statement = (sql: string, bound: unknown[]) => ({
    bind(...values: unknown[]) {
      return statement(sql, values);
    },
    async all() {
      return { results: raw.prepare(sql).all(...(bound as never[])) };
    },
    async first(column?: string) {
      const row = raw.prepare(sql).get(...(bound as never[])) as Record<string, unknown> | undefined;
      if (!row) return null;
      return column ? (row[column] ?? null) : row;
    },
    async run() {
      return { meta: { changes: Number(raw.prepare(sql).run(...(bound as never[])).changes ?? 0) } };
    },
  });

  return {
    prepare(sql: string) {
      statements.push(sql);
      return statement(sql, []);
    },
    async exec(sql: string) {
      raw.exec(sql);
    },
    async batch(batchStatements: Array<{ run(): Promise<{ meta?: { changes?: number } }> }>) {
      return Promise.all(batchStatements.map((batchStatement) => batchStatement.run()));
    },
  };
}

const PAGE = `<!doctype html><html><head><title>Cool Air</title></head><body>
<nav><a href="/services">Services</a><a href="/services/emergency">More services</a></nav>
<h1>Cool Air Heating</h1>
<p>${"We service homes across the county. ".repeat(30)}</p>
</body></html>`;

const TECHNICAL_PAGE = `<!doctype html><html><head></head><body>
<nav><a href="/services">Services</a><a href="/services/emergency">More services</a></nav>
<h1>Cool Air Heating</h1>
<p>${"We service homes across the county. ".repeat(30)}</p>
</body></html>`;

function siteFetch(page = PAGE): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/sitemap.xml") || url.endsWith("/robots.txt")) {
      return new Response("", { status: 404 });
    }
    return new Response(page, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
}

let raw: Database.Database;
let scope: { db: SqlDb; workspaceId: string };
let statements: string[];
let env: Record<string, unknown>;

beforeEach(async () => {
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  applyProductionSchemaThrough0022(raw);
  statements = [];
  const db = recordingSqlDb(raw, statements);
  scope = { db, workspaceId: "ws_a" };
  env = {
    AI_PROVIDER: "mock",
    MAX_AI_CALLS_PER_RUN: "10",
    ENABLE_EXTERNAL_BUSINESS_MISMATCH: "false",
  };

  await createWorkspaceForOwner(db, { id: "ws_a", name: "A", ownerUserId: "u_a" });
  await db.prepare(
    "INSERT INTO services (id, workspace_id, name, description, price_min, price_max, tags, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    "svc-landing",
    "ws_a",
    "Landing page",
    "",
    900,
    1800,
    '["landing-page"]',
    1,
    new Date().toISOString(),
  ).run();
  await db.prepare(
    "INSERT INTO services (id, workspace_id, name, description, price_min, price_max, tags, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    "svc-missing-title",
    "ws_a",
    "Title repair",
    "",
    150,
    300,
    '["missing-title"]',
    1,
    new Date().toISOString(),
  ).run();
  await db.prepare(
    "INSERT INTO clients (id, workspace_id, name, domain, offerings, notes, updated_at, monitoring_cadence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    "cli-a",
    "ws_a",
    "Cool Air",
    "coolair.example",
    '["furnace repair"]',
    "",
    new Date().toISOString(),
    "off",
  ).run();

  __setSessionResolver(async () => ({
    userId: "u_a",
    user: { id: "u_a", email: "a@example.test", name: "A" },
  }));
  vi.stubGlobal("fetch", siteFetch());
});

afterEach(() => {
  __setSessionResolver(null);
  vi.unstubAllGlobals();
  raw.close();
});

describe("paused external mismatch boundary", () => {
  it("loads the client route on the production schema without the paused table", async () => {
    const routeStatements: string[] = [];
    const data = await clientDetail.loader({
      request: new Request("http://localhost/clients/cli-a"),
      params: { id: "cli-a" },
      context: {
        cloudflare: {
          env: { ...env, DB: recordingD1Database(raw, routeStatements) },
        },
      },
    } as never);

    expect(data.client.id).toBe("cli-a");
    expect(data.externalClaims).toEqual([]);
    expect(routeStatements.some((sql) => /external_business_claims/i.test(sql))).toBe(false);
  });

  it("keeps the default-off client and analysis paths tenant-scoped", async () => {
    await createWorkspaceForOwner(scope.db, { id: "ws_b", name: "B", ownerUserId: "u_b" });
    await scope.db
      .prepare(
        "INSERT INTO clients (id, workspace_id, name, domain, offerings, notes, updated_at, monitoring_cadence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "cli-b",
        "ws_b",
        "Other Air",
        "otherair.example",
        '["boiler repair"]',
        "",
        new Date().toISOString(),
        "off",
      )
      .run();

    const routeStatements: string[] = [];
    await expect(
      clientDetail.loader({
        request: new Request("http://localhost/clients/cli-b"),
        params: { id: "cli-b" },
        context: {
          cloudflare: {
            env: { ...env, DB: recordingD1Database(raw, routeStatements) },
          },
        },
      } as never),
    ).rejects.toMatchObject({ status: 404 });

    await expect(runAnalysis(scope, env, "cli-b", { cooldownMs: 0 })).rejects.toMatchObject({ status: 404 });
    expect(routeStatements.some((sql) => /external_business_claims/i.test(sql))).toBe(false);
    expect(statements.some((sql) => /external_business_claims/i.test(sql))).toBe(false);
  });

  it("runs website analysis on the production schema without the paused table", async () => {
    const result = await runAnalysis(scope, env, "cli-a", { cooldownMs: 0 });

    expect(result.verdict.outcome).toBeDefined();
    expect(statements.some((sql) => /external_business_claims/i.test(sql))).toBe(false);
  });

  it("preserves website-only commercial candidates, reconciliation, and project packaging", async () => {
    const first = await runAnalysis(scope, env, "cli-a", { cooldownMs: 0 });
    const commercial = first.opportunities.find((opportunity) => opportunity.ruleId === "missing-service-page");

    expect(commercial).toBeDefined();
    expect(commercial!.detected).not.toMatch(/official business profile/i);
    expect(commercial!.evidenceRefs.some((reference) => reference.startsWith("external:"))).toBe(false);

    await repo.saveAnalysis(scope, [
      {
        ...commercial!,
        status: "accepted",
        acceptedAt: "2026-09-07T00:00:00.000Z",
      },
    ]);
    const second = await runAnalysis(scope, env, "cli-a", { cooldownMs: 0 });
    const reconciled = second.opportunities.find(
      (opportunity) => opportunity.dedupeKey === commercial!.dedupeKey,
    );

    expect(reconciled).toMatchObject({
      id: commercial!.id,
      status: "accepted",
      acceptedAt: "2026-09-07T00:00:00.000Z",
    });
    expect(second.newlyFound.map((opportunity) => opportunity.id)).not.toContain(commercial!.id);

    const client: Pick<Client, "id" | "name" | "domain"> = {
      id: "cli-a",
      name: "Cool Air",
      domain: "coolair.example",
    };
    const projects = buildProjectViews(
      (await repo.listOpportunities(scope, "cli-a")).map((opportunity) => ({
        client,
        opportunity,
        serviceName: opportunity.suggestedServiceId === "svc-landing" ? "Landing page" : "Title repair",
      })),
    );
    const packagedIds = projects.flatMap((project) => project.opportunityIds);
    expect(packagedIds).toContain(commercial!.id);
    expect(new Set(packagedIds).size).toBe(packagedIds.length);
    expect(statements.some((sql) => /external_business_claims/i.test(sql))).toBe(false);
  });

  it("keeps technical findings working without synthesizing mismatch opportunities", async () => {
    vi.stubGlobal("fetch", siteFetch(TECHNICAL_PAGE));
    const result = await runAnalysis(scope, env, "cli-a", { cooldownMs: 0 });

    expect(result.opportunities.some((opportunity) => opportunity.ruleId === "missing-title")).toBe(true);
    expect(result.opportunities.some((opportunity) => /official business profile/i.test(opportunity.detected))).toBe(
      false,
    );
    expect(
      result.opportunities.flatMap((opportunity) => opportunity.evidenceRefs).some((reference) =>
        reference.startsWith("external:"),
      ),
    ).toBe(false);
    expect(statements.some((sql) => /external_business_claims/i.test(sql))).toBe(false);
  });

  it("rejects paused business-profile writes before reaching the missing table", async () => {
    const routeStatements: string[] = [];
    const result = await clientDetail.action({
      request: new Request("http://localhost/clients/cli-a", {
        method: "POST",
        body: new URLSearchParams({ intent: "import-external-profile" }),
      }),
      params: { id: "cli-a" },
      context: {
        cloudflare: {
          env: { ...env, DB: recordingD1Database(raw, routeStatements) },
        },
      },
    } as never);

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/paused/i);
    expect(routeStatements.some((sql) => /external_business_claims/i.test(sql))).toBe(false);
  });

  it("cannot run the mismatch path when its explicit flag lacks the required schema", async () => {
    await expect(
      runAnalysis(
        scope,
        { ...env, ENABLE_EXTERNAL_BUSINESS_MISMATCH: "true" },
        "cli-a",
        { cooldownMs: 0 },
      ),
    ).rejects.toThrow(/no such table: external_business_claims/);
    expect(statements.some((sql) => /external_business_claims/i.test(sql))).toBe(true);
  });
});
