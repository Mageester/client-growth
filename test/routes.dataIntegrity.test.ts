import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { SCHEMA_SQL } from "@/db/schema";
import { __setSessionResolver } from "../app/lib/session.server";
import { d1LikeOver } from "./helpers/testAuth";

import * as clientsIndex from "../app/routes/clients._index";
import * as clientDetail from "../app/routes/clients.$id";
import * as servicesIndex from "../app/routes/services._index";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let raw: Database.Database;
let ctx: { cloudflare: { env: Record<string, unknown> } };
let scope: { db: never; workspaceId: string };

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
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
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

beforeEach(async () => {
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  raw.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  raw.exec(SCHEMA_SQL);

  const db = sqlDbOver(raw) as never;
  await createWorkspaceForOwner(db, { id: "ws_a", name: "A", ownerUserId: "u_a" });
  scope = { db, workspaceId: "ws_a" };

  __setSessionResolver(async () => ({
    userId: "u_a",
    user: { id: "u_a", email: "a@x.example", name: "A" },
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

describe("adding a client", () => {
  it("refuses a value that is not an analyzable website domain", async () => {
    const result = (await call(clientsIndex.action as never, {
      request: formReq({ name: "Typo Co", domain: "acme plumbing", offerings: "" }),
      context: ctx,
    })) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot be analyzed");
    expect(await repo.listClients(scope)).toHaveLength(0);
  });

  it("stores the normalized host for an accepted domain", async () => {
    await call(clientsIndex.action as never, {
      request: formReq({ name: "Acme", domain: "  HTTPS://Acme-Plumbing.com/  ", offerings: "drain cleaning" }),
      context: ctx,
    });
    const clients = await repo.listClients(scope);
    expect(clients).toHaveLength(1);
    expect(clients[0]!.domain).toBe("acme-plumbing.com");
  });

  it("refuses to overwrite a good domain with a bad one on edit", async () => {
    await call(clientsIndex.action as never, {
      request: formReq({ name: "Acme", domain: "acme-plumbing.com", offerings: "drain cleaning" }),
      context: ctx,
    });
    const id = (await repo.listClients(scope))[0]!.id;

    const result = (await call(clientDetail.action as never, {
      params: { id },
      request: formReq({ intent: "save", name: "Acme", domain: "not a domain", offerings: "" }),
      context: ctx,
    })) as { ok: boolean };

    expect(result.ok).toBe(false);
    expect((await repo.getClient(scope, id))!.domain).toBe("acme-plumbing.com");
  });
});

describe("adding a service", () => {
  const add = (name: string, priceMin: string, priceMax: string) =>
    call(servicesIndex.action as never, {
      request: formReq({ intent: "save", name, priceMin, priceMax, description: "", tags: "landing-page" }),
      context: ctx,
    });

  it("does not overwrite an existing service whose name slugs the same", async () => {
    await add("Landing Page", "900", "1800");
    await add("landing page", "50", "60"); // same slug, different service

    const services = await repo.listServices(scope);
    expect(services).toHaveLength(2);
    expect(new Set(services.map((s) => s.id)).size).toBe(2);
    // The original is untouched.
    const original = services.find((s) => s.priceMin === 900);
    expect(original).toBeDefined();
    expect(original!.priceMax).toBe(1800);
  });

  it("keeps a service inactive when it is edited", async () => {
    await add("Landing Page", "900", "1800");
    const id = (await repo.listServices(scope))[0]!.id;
    await repo.setServiceActive(scope, id, false);

    await call(servicesIndex.action as never, {
      request: formReq({ intent: "save", id, name: "Landing Page", priceMin: "1000", priceMax: "2000", description: "", tags: "landing-page" }),
      context: ctx,
    });

    const service = await repo.getService(scope, id);
    expect(service!.priceMin).toBe(1000);
    expect(service!.active).toBe(false);
  });
});
