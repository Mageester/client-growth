import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientSchema, ServiceSchema } from "@/core/schema";
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
<nav><a href="/services">Services</a></nav>
<h1>Cool Air Heating</h1>
<p>${"We service homes across the county. ".repeat(30)}</p>
</body></html>`;

function siteFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/sitemap.xml") || url.endsWith("/robots.txt")) {
      return new Response("", { status: 404 });
    }
    return new Response(PAGE, { status: 200, headers: { "content-type": "text/html" } });
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

  it("runs website analysis on the production schema without the paused table", async () => {
    const result = await runAnalysis(scope, env, "cli-a", { cooldownMs: 0 });

    expect(result.verdict.outcome).toBeDefined();
    expect(statements.some((sql) => /external_business_claims/i.test(sql))).toBe(false);
  });
});
