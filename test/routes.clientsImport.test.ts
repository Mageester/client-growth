import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_CLIENT_IMPORT_BYTES } from "@/core/clientImport";
import { ClientSchema } from "@/core/schema";
import { ClientImportConflictError, insertClientsAtomically } from "@/db/clientImport";
import * as repo from "@/db/repositories";
import { SCHEMA_SQL } from "@/db/schema";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { __setSessionResolver } from "../app/lib/session.server";
import * as clientsImport from "../app/routes/clients.import";
import { MAX_CLIENT_IMPORT_REQUEST_BYTES } from "../app/routes/clients.import";
import { d1LikeOver } from "./helpers/testAuth";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let raw: Database.Database;
let scope: { db: never; workspaceId: string };
let scopeB: { db: never; workspaceId: string };
let ctx: { cloudflare: { env: Record<string, unknown> } };

function sqlDbOver(db: Database.Database) {
  const stmt = (sql: string, bound: unknown[]) => ({
    bind: (...values: unknown[]) => stmt(sql, values),
    all: async () => db.prepare(sql).all(...(bound as never[])),
    first: async () => db.prepare(sql).get(...(bound as never[])) ?? null,
    run: async () => ({ rowsAffected: db.prepare(sql).run(...(bound as never[])).changes }),
  });
  return { prepare: (sql: string) => stmt(sql, []), exec: async (sql: string) => void db.exec(sql) };
}

function formReq(fields: Record<string, string>) {
  return new Request("http://localhost/clients/import", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

async function call(fn: (args: unknown) => unknown, args: unknown): Promise<unknown> {
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
  scopeB = { db, workspaceId: "ws_b" };
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

const action = (fields: Record<string, string>) =>
  call(clientsImport.action as never, { request: formReq(fields), context: ctx });

describe("bulk client import route", () => {
  it("previews parsed rows without writing clients or analysis data", async () => {
    const csv = [
      "name,domain,offerings",
      "Northwind Heating,northwind.example,heat pumps; duct cleaning",
      "Acme Roofing,acme.example,roofing; siding",
    ].join("\n");

    const result = (await action({ intent: "preview", csv })) as {
      ok: boolean;
      stage: string;
      rows: Array<{ name: string; domain: string; offerings: string[] }>;
      issues: unknown[];
    };

    expect(result.ok).toBe(true);
    expect(result.stage).toBe("preview");
    expect(result.rows).toEqual([
      {
        line: 2,
        name: "Northwind Heating",
        domain: "northwind.example",
        offerings: ["heat pumps", "duct cleaning"],
      },
      {
        line: 3,
        name: "Acme Roofing",
        domain: "acme.example",
        offerings: ["roofing", "siding"],
      },
    ]);
    expect(result.issues).toEqual([]);
    expect(await repo.listClients(scope)).toHaveLength(0);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM analysis_runs").get()).toEqual({ count: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM evidence_bundles").get()).toEqual({ count: 0 });
  });

  it("revalidates on explicit confirmation and creates new profiles without overwriting", async () => {
    const csv = [
      "name,domain,offerings",
      "Northwind Heating,northwind.example,heat pumps; duct cleaning",
      "Acme Roofing,acme.example,roofing; siding",
    ].join("\n");

    await action({ intent: "preview", csv });
    const result = (await action({ intent: "confirm", csv })) as {
      ok: boolean;
      stage: string;
      imported: number;
      clients: Array<{ id: string; name: string }>;
    };

    expect(result).toMatchObject({
      ok: true,
      stage: "complete",
      imported: 2,
      clients: [
        expect.objectContaining({ name: "Northwind Heating" }),
        expect.objectContaining({ name: "Acme Roofing" }),
      ],
    });
    const clients = await repo.listClients(scope);
    expect(clients).toHaveLength(2);
    expect(clients.map((client) => client.domain)).toEqual([
      "acme.example",
      "northwind.example",
    ]);
    expect(clients.find((client) => client.domain === "northwind.example")?.offerings).toEqual([
      "heat pumps",
      "duct cleaning",
    ]);
    expect(new Set(clients.map((client) => client.id)).size).toBe(2);
  });

  it("checks tenant duplicates again at confirmation and writes nothing on a conflict", async () => {
    const csv = "name,domain,offerings\nAcme Copy,acme.example,roofing";
    const preview = (await action({ intent: "preview", csv })) as { ok: boolean; issues: unknown[] };
    expect(preview.ok).toBe(true);

    await repo.upsertClient(
      scope,
      ClientSchema.parse({
        id: "client-existing",
        name: "Acme",
        domain: "acme.example",
        offerings: ["roofing"],
        notes: "Original",
      }),
    );

    const result = (await action({ intent: "confirm", csv })) as {
      ok: boolean;
      stage: string;
      issues: Array<{ line: number; message: string }>;
    };

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("preview");
    expect(result.issues[0]?.message).toMatch(/already watching/i);
    expect(await repo.listClients(scope)).toEqual([
      expect.objectContaining({ id: "client-existing", name: "Acme", notes: "Original" }),
    ]);
  });

  it("allows the same domain in another workspace while keeping the import tenant scoped", async () => {
    await repo.upsertClient(
      scopeB,
      ClientSchema.parse({
        id: "client-other-workspace",
        name: "Other workspace",
        domain: "shared.example",
        offerings: [],
        notes: "",
      }),
    );

    const result = (await action({
      intent: "confirm",
      csv: "name,domain,offerings\nOur client,shared.example,service",
    })) as { ok: boolean; imported: number; clients: Array<{ id: string; name: string }> };

    expect(result).toMatchObject({
      ok: true,
      stage: "complete",
      imported: 1,
      clients: [expect.objectContaining({ name: "Our client" })],
    });
    expect((await repo.listClients(scope)).map((client) => client.domain)).toEqual(["shared.example"]);
    expect((await repo.listClients(scopeB)).map((client) => client.domain)).toEqual(["shared.example"]);
  });

  it("refuses malformed or oversized confirmations without partial writes", async () => {
    const tooMany = [
      "name,domain,offerings",
      ...Array.from({ length: 51 }, (_, index) => `Client ${index},client-${index}.example,service`),
    ].join("\n");
    const result = (await action({ intent: "confirm", csv: tooMany })) as {
      ok: boolean;
      stage: string;
      issues: unknown[];
    };

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("preview");
    expect(result.issues.length).toBeGreaterThan(0);
    expect(await repo.listClients(scope)).toHaveLength(0);
  });

  it("rejects an oversized request before reading the form body", async () => {
    const request = new Request("http://localhost/clients/import", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(MAX_CLIENT_IMPORT_BYTES * 2 + 1),
      },
      body: new URLSearchParams({ intent: "preview", csv: "ignored" }),
    });
    const result = (await call(clientsImport.action as never, { request, context: ctx })) as {
      ok: boolean;
      stage: string;
      error: string;
    };

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("input");
    expect(result.error).toMatch(/request under/i);
    expect(await repo.listClients(scope)).toHaveLength(0);
  });

  it("rejects an oversized body without Content-Length while streaming it", async () => {
    const body = new URLSearchParams({
      intent: "preview",
      csv: "x".repeat(MAX_CLIENT_IMPORT_REQUEST_BYTES + 1),
    }).toString();
    const request = new Request("http://localhost/clients/import", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(request.headers.get("content-length")).toBeNull();

    const result = (await call(clientsImport.action as never, { request, context: ctx })) as {
      ok: boolean;
      stage: string;
      error: string;
    };

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("input");
    expect(result.error).toMatch(/request under/i);
    expect(await repo.listClients(scope)).toHaveLength(0);
  });

  it("confirms the full 50-row import in one D1-safe statement", async () => {
    const csv = [
      "name,domain,offerings",
      ...Array.from(
        { length: 50 },
        (_, index) => `Client ${index},client-${index}.example,service ${index}`,
      ),
    ].join("\n");

    const result = (await action({ intent: "confirm", csv })) as {
      ok: boolean;
      stage: string;
      imported: number;
      clients: Array<{ id: string; name: string }>;
    };

    expect(result).toMatchObject({ ok: true, stage: "complete", imported: 50 });
    expect(result.clients).toHaveLength(50);
    expect(await repo.listClients(scope)).toHaveLength(50);
  });

  it("does not partially insert when a domain appears after preview", async () => {
    await repo.upsertClient(
      scope,
      ClientSchema.parse({
        id: "client-existing-domain",
        name: "Existing",
        domain: "existing.example",
        offerings: [],
        notes: "Keep me",
      }),
    );

    const batch = [
      ClientSchema.parse({
        id: "client-stale-domain",
        name: "Stale duplicate",
        domain: "existing.example",
        offerings: [],
        notes: "",
      }),
      ClientSchema.parse({
        id: "client-fresh-domain",
        name: "Fresh",
        domain: "fresh.example",
        offerings: [],
        notes: "",
      }),
    ];

    await expect(insertClientsAtomically(scope, batch)).rejects.toBeInstanceOf(
      ClientImportConflictError,
    );
    expect(await repo.listClients(scope)).toEqual([
      expect.objectContaining({ id: "client-existing-domain", name: "Existing" }),
    ]);
  });

  it("keeps a primary-key collision insert-only and atomic", async () => {
    await repo.upsertClient(
      scope,
      ClientSchema.parse({
        id: "client-collision",
        name: "Existing",
        domain: "existing.example",
        offerings: [],
        notes: "Keep me",
      }),
    );

    const batch = [
      ClientSchema.parse({
        id: "client-collision",
        name: "Would overwrite",
        domain: "would-overwrite.example",
        offerings: [],
        notes: "",
      }),
      ClientSchema.parse({
        id: "client-fresh",
        name: "Would partially insert",
        domain: "would-partially-insert.example",
        offerings: [],
        notes: "",
      }),
    ];

    await expect(insertClientsAtomically(scope, batch)).rejects.toBeInstanceOf(
      ClientImportConflictError,
    );
    expect(await repo.listClients(scope)).toEqual([
      expect.objectContaining({
        id: "client-collision",
        name: "Existing",
        domain: "existing.example",
        notes: "Keep me",
      }),
    ]);
  });
});
