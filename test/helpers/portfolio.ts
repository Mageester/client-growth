import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { vi } from "vitest";

import { ClientSchema, ServiceSchema } from "@/core/schema";
import type { MonitoringCadence } from "@/core/monitoring";
import * as repo from "@/db/repositories";
import { SCHEMA_SQL } from "@/db/schema";
import type { RunResult, SqlDb, SqlStatement, SqlValue } from "@/db/sql";
import type { TenantScope } from "@/db/tenant";
import { createWorkspaceForOwner } from "@/db/workspaces";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

/**
 * A deterministic multi-workspace portfolio for the monitoring scale tests.
 *
 * Every site is served from this file — no network, no provider, no live
 * DeepSeek — but the analysis that runs against them is the real one. The point
 * of the fixture is to make a realistic portfolio (several agencies, a few dozen
 * clients, a mix of monitoring states and a mix of site health) reproducible, so
 * assertions about batching, isolation and change detection are about the
 * scheduler rather than about luck.
 */

export function sqlDbOver(raw: Database.Database): SqlDb {
  const stmt = (sql: string, bound: SqlValue[]): SqlStatement => ({
    bind: (...v: SqlValue[]) => stmt(sql, v),
    all: <T,>() => Promise.resolve(raw.prepare(sql).all(...(bound as never[])) as T[]),
    first: <T,>() =>
      Promise.resolve((raw.prepare(sql).get(...(bound as never[])) ?? null) as T | null),
    run: (): Promise<RunResult> =>
      Promise.resolve({ rowsAffected: Number(raw.prepare(sql).run(...(bound as never[])).changes) }),
  });
  return {
    exec: (sql: string) => {
      raw.exec(sql);
      return Promise.resolve();
    },
    prepare: (sql: string) => stmt(sql, []),
  };
}

/** What the client's website does when it is crawled. */
export type SiteKind =
  /** Sells three things, has a page for two — one genuine missing-service gap. */
  | "gap"
  /** Sells three things and has a page for each. Read successfully, nothing to sell. */
  | "clean"
  /** Every request fails. Must be reported inconclusive, never clean. */
  | "unreachable";

export interface FixtureClient {
  clientId: string;
  workspaceId: string;
  domain: string;
  site: SiteKind;
  cadence: MonitoringCadence;
  /** Relative to `now`. Negative = already due. Null = not scheduled. */
  dueOffsetMs: number | null;
  claimedOffsetMs?: number | null;
}

const OFFERINGS = ["furnace repair", "duct cleaning", "heat pump installation"];

function homepage(name: string): string {
  return `<!doctype html><html><head><title>${name}</title></head><body>
<nav><a href="/services">Services</a><a href="/contact">Contact</a></nav>
<h1>${name}</h1>
<p>${"We service homes across the county every day of the week. ".repeat(30)}</p>
</body></html>`;
}

function servicesPage(covered: string[]): string {
  return `<!doctype html><html><head><title>Services</title></head><body>
<h1>Our services</h1>
${covered.map((s) => `<h2>${s}</h2>`).join("\n")}
<p>${covered.join(", ")}. ${"Trusted local specialists for your home. ".repeat(30)}</p>
</body></html>`;
}

/**
 * One fetch implementation for the whole portfolio, routed by hostname. Requests
 * to an `unreachable` client's domain throw exactly the way a dead host does.
 */
export function portfolioFetch(clients: FixtureClient[]): typeof fetch {
  // Looks the client up per request rather than snapshotting, so a test can
  // repair or re-break one site between scans — which is the whole point of
  // change detection.
  const byHost = new Map(clients.map((c) => [c.domain, c]));
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const kind = byHost.get(url.hostname)?.site;
    if (kind === "unreachable") throw new TypeError("fetch failed");
    if (url.pathname.endsWith("/sitemap.xml")) return new Response("", { status: 404 });
    if (url.pathname.includes("/services")) {
      return new Response(
        servicesPage(kind === "clean" ? OFFERINGS : OFFERINGS.slice(0, 2)),
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    return new Response(homepage(url.hostname), {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as unknown as typeof fetch;
}

export interface Portfolio {
  raw: Database.Database;
  db: SqlDb;
  /** Workspace id -> scope. Every assertion about isolation uses these. */
  scopes: Map<string, TenantScope>;
  clients: FixtureClient[];
  scopeFor(workspaceId: string): TenantScope;
  close(): void;
}

/**
 * Deterministic spread of monitoring state and site health across the portfolio.
 * Index-driven rather than random so a failure is always reproducible.
 */
function specFor(index: number, workspaceId: string, now: Date): FixtureClient {
  const cadence: MonitoringCadence = index % 3 === 0 ? "off" : "weekly";
  const due = index % 3 === 1; // of the monitored ones, half are due
  const site: SiteKind =
    index % 7 === 3 ? "unreachable" : index % 2 === 0 ? "clean" : "gap";
  const slug = `${workspaceId.replace(/^ws_/, "")}${index}`;
  return {
    clientId: `cli_${slug}`,
    workspaceId,
    domain: `site-${slug}.example`,
    site,
    cadence,
    dueOffsetMs: cadence === "off" ? null : due ? -60 * 60 * 1000 : 3 * 24 * 60 * 60 * 1000,
  };
}

export async function buildPortfolio(input: {
  workspaces?: number;
  perWorkspace?: number;
  now?: Date;
}): Promise<Portfolio> {
  const workspaceCount = input.workspaces ?? 3;
  const perWorkspace = input.perWorkspace ?? 10;
  const now = input.now ?? new Date();

  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  raw.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  raw.exec(SCHEMA_SQL);
  const db = sqlDbOver(raw);

  const scopes = new Map<string, TenantScope>();
  const clients: FixtureClient[] = [];

  for (let w = 0; w < workspaceCount; w++) {
    const workspaceId = `ws_${String.fromCharCode(97 + w)}`;
    await createWorkspaceForOwner(db, {
      id: workspaceId,
      name: `Agency ${workspaceId}`,
      ownerUserId: `u_${workspaceId}`,
    });
    const scope: TenantScope = { db, workspaceId };
    scopes.set(workspaceId, scope);

    // Both of today's rules are reachable from every workspace's catalog, so an
    // empty result is never explained away by a catalog gap.
    await repo.upsertService(
      scope,
      ServiceSchema.parse({
        id: `svc_page_${workspaceId}`,
        name: "Service landing page",
        description: "",
        priceMin: 900,
        priceMax: 1800,
        tags: ["landing-page"],
        active: true,
      }),
    );
    await repo.upsertService(
      scope,
      ServiceSchema.parse({
        id: `svc_fix_${workspaceId}`,
        name: "Conversion path repair",
        description: "",
        priceMin: 300,
        priceMax: 1000,
        tags: ["conversion-repair"],
        active: true,
      }),
    );

    for (let i = 0; i < perWorkspace; i++) {
      const spec = specFor(i, workspaceId, now);
      await repo.upsertClient(
        scope,
        ClientSchema.parse({
          id: spec.clientId,
          name: `Client ${spec.clientId}`,
          domain: spec.domain,
          offerings: OFFERINGS,
          notes: "",
        }),
      );
      await setMonitoringDirect(db, spec, now);
      clients.push(spec);
    }
  }

  return {
    raw,
    db,
    scopes,
    clients,
    scopeFor(workspaceId: string): TenantScope {
      const scope = scopes.get(workspaceId);
      if (!scope) throw new Error(`no scope for ${workspaceId}`);
      return scope;
    },
    close: () => raw.close(),
  };
}

/**
 * Write monitoring state straight to the row.
 *
 * Fixture-only. The product path (`setMonitoringCadence`) derives `nextDueAt`
 * from the clock, which is exactly what these tests need to control; it has its
 * own tests.
 */
export async function setMonitoringDirect(
  db: SqlDb,
  spec: Pick<FixtureClient, "clientId" | "workspaceId" | "cadence" | "dueOffsetMs"> & {
    claimedOffsetMs?: number | null;
  },
  now: Date,
): Promise<void> {
  const stamp = (offset: number | null | undefined) =>
    offset === null || offset === undefined ? null : new Date(now.getTime() + offset).toISOString();
  await db
    .prepare(
      `UPDATE clients SET monitoring_cadence = ?, monitoring_next_due_at = ?, monitoring_claimed_at = ?
       WHERE id = ? AND workspace_id = ?`,
    )
    .bind(
      spec.cadence,
      stamp(spec.dueOffsetMs),
      stamp(spec.claimedOffsetMs ?? null),
      spec.clientId,
      spec.workspaceId,
    )
    .run();
}

export const FIXTURE_OFFERINGS = OFFERINGS;
