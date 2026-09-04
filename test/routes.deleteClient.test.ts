import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ClientSchema } from "@/core/schema";
import * as repo from "@/db/repositories";
import { SCHEMA_SQL } from "@/db/schema";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { __setSessionResolver } from "../app/lib/session.server";
import * as clientDetail from "../app/routes/clients.$id";
import { d1LikeOver } from "./helpers/testAuth";

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

function formReq(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

async function call(fn: (a: unknown) => unknown, args: unknown): Promise<unknown> {
  try {
    return await fn(args);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
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
  scope = { db, workspaceId: "ws_a" };
  const scopeB = { db, workspaceId: "ws_b" };
  await repo.upsertClient(
    scope,
    ClientSchema.parse({ id: "cli_a", name: "Alpha", domain: "alpha.example", offerings: [], notes: "" }),
  );
  await repo.upsertClient(
    scopeB,
    ClientSchema.parse({ id: "cli_b", name: "Beta", domain: "beta.example", offerings: [], notes: "" }),
  );

  __setSessionResolver(async () => ({
    userId: "u_a",
    user: { id: "u_a", email: "a@example.com", name: "A" },
  }));
  ctx = {
    cloudflare: {
      env: {
        DB: d1LikeOver(raw),
        BETTER_AUTH_SECRET: "x".repeat(40),
        BETTER_AUTH_URL: "http://localhost:8787",
        AI_PROVIDER: "mock",
      },
    },
  };
});

afterEach(() => {
  __setSessionResolver(null);
  raw.close();
});

describe("client deletion route", () => {
  it("requires an exact name and redirects after deleting the scoped client", async () => {
    const mismatch = await call(clientDetail.action as never, {
      request: formReq({ intent: "delete", confirmation: "Alpha typo" }),
      params: { id: "cli_a" },
      context: ctx,
    });
    expect(mismatch).toEqual({
      ok: false,
      error: "Type Alpha exactly to confirm deletion.",
    });
    expect((await repo.getClient(scope, "cli_a"))?.name).toBe("Alpha");

    const deleted = await call(clientDetail.action as never, {
      request: formReq({ intent: "delete", confirmation: "Alpha" }),
      params: { id: "cli_a" },
      context: ctx,
    });
    expect(deleted).toBeInstanceOf(Response);
    expect((deleted as Response).status).toBe(302);
    expect((deleted as Response).headers.get("location")).toBe("/clients");
    expect(await repo.getClient(scope, "cli_a")).toBeNull();
  });

  it("returns 404 for a missing or cross-workspace client", async () => {
    const missing = await call(clientDetail.action as never, {
      request: formReq({ intent: "delete", confirmation: "Missing" }),
      params: { id: "missing" },
      context: ctx,
    });
    expect(missing).toBeInstanceOf(Response);
    expect((missing as Response).status).toBe(404);

    const crossWorkspace = await call(clientDetail.action as never, {
      request: formReq({ intent: "delete", confirmation: "Beta" }),
      params: { id: "cli_b" },
      context: ctx,
    });
    expect(crossWorkspace).toBeInstanceOf(Response);
    expect((crossWorkspace as Response).status).toBe(404);
    expect(raw.prepare("SELECT id FROM clients WHERE id = ? AND workspace_id = ?").get("cli_b", "ws_b")).toEqual({
      id: "cli_b",
    });
  });
});
