import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import { SCHEMA_SQL } from "@/db/schema";
import type { SqlDb } from "@/db/sql";
import type { TenantScope } from "@/db/tenant";
import { createWorkspaceForOwner } from "@/db/workspaces";
import {
  claimWorkspaceDigest,
  collectDigestFacts,
  finishWorkspaceDigest,
  getMonitorDigestSettings,
  listMonitorDigestRuns,
  listWorkspacesDueForDigest,
  recordMonitorDigestRun,
  setMonitorDigestSettings,
} from "@/db/monitorDigests";
import { buildMonitorDigest } from "@/core/monitorDigest";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const NOW = new Date("2026-09-08T13:00:00.000Z");
const SINCE = "2026-09-01T00:00:00.000Z";
const UNTIL = "2026-09-08T00:00:00.000Z";

let handle: NodeSqliteDb;
let db: SqlDb;
let t: TenantScope;

async function insertUser(id: string, email: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, email, email, NOW.toISOString(), NOW.toISOString())
    .run();
}

async function insertClient(input: {
  id: string;
  workspaceId: string;
  name?: string;
  domain?: string;
  cadence?: "off" | "weekly";
  averageJobValue?: number | null;
}): Promise<void> {
  await db
    .prepare(
      `INSERT INTO clients (id, workspace_id, name, domain, updated_at, monitoring_cadence, average_job_value)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.workspaceId,
      input.name ?? input.id,
      input.domain ?? `${input.id}.example`,
      NOW.toISOString(),
      input.cadence ?? "weekly",
      input.averageJobValue ?? null,
    )
    .run();
}

async function insertRun(input: {
  workspaceId: string;
  clientId: string;
  finishedAt: string;
  trigger: "manual" | "scheduled";
  outcome: string;
  newCount?: number;
  resolvedCount?: number;
}): Promise<void> {
  await db
    .prepare(
      `INSERT INTO analysis_runs
         (workspace_id, client_id, started_at, finished_at, source, outcome, summary, trigger, new_count, resolved_count)
       VALUES (?, ?, ?, ?, 'http', ?, '', ?, ?, ?)`,
    )
    .bind(
      input.workspaceId,
      input.clientId,
      input.finishedAt,
      input.finishedAt,
      input.outcome,
      input.trigger,
      input.newCount ?? 0,
      input.resolvedCount ?? 0,
    )
    .run();
}

async function insertOpp(input: {
  id: string;
  workspaceId: string;
  clientId: string;
  title?: string;
  priceMin: number;
  priceMax: number;
  status?: string;
  billable?: "billable" | "already_covered";
}): Promise<void> {
  await db
    .prepare(
      `INSERT INTO opportunities
         (id, workspace_id, dedupe_key, client_id, rule_id, title, detected, rationale,
          suggested_service_id, price_min, price_max, confidence, billable_status, status, updated_at)
       VALUES (?, ?, ?, ?, 'missing-service-page', ?, ?, '', 'svc', ?, ?, 0.8, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.workspaceId,
      input.id,
      input.clientId,
      input.title ?? input.id,
      NOW.toISOString(),
      input.priceMin,
      input.priceMax,
      input.billable ?? "billable",
      input.status ?? "new",
      NOW.toISOString(),
    )
    .run();
}

beforeEach(async () => {
  handle = nodeSqliteDb(":memory:");
  await handle.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  await handle.exec(SCHEMA_SQL);
  db = handle;
  await insertUser("u_ws", "owner@agency.example");
  await createWorkspaceForOwner(db, { id: "ws", name: "Northwind", ownerUserId: "u_ws" });
  t = { db, workspaceId: "ws" };
});

afterEach(() => handle.close());

describe("digest settings", () => {
  it("defaults to weekly, only-on-change, no explicit recipient", async () => {
    expect(await getMonitorDigestSettings(t)).toEqual({
      cadence: "weekly",
      onlyOnChange: true,
      recipient: null,
    });
  });

  it("round-trips a saved preference and normalizes a blank recipient to null", async () => {
    await setMonitorDigestSettings(t, { cadence: "weekly", onlyOnChange: false, recipient: "  ops@agency.example " });
    expect(await getMonitorDigestSettings(t)).toEqual({
      cadence: "weekly",
      onlyOnChange: false,
      recipient: "ops@agency.example",
    });

    await setMonitorDigestSettings(t, { cadence: "weekly", onlyOnChange: true, recipient: "   " });
    expect((await getMonitorDigestSettings(t)).recipient).toBeNull();
  });

  it("turning the digest off clears the schedule so the tick stops selecting it", async () => {
    await setMonitorDigestSettings(t, { cadence: "off", onlyOnChange: true, recipient: null });
    expect((await getMonitorDigestSettings(t)).cadence).toBe("off");
    expect(await listWorkspacesDueForDigest(db, { now: NOW, limit: 10 })).toEqual([]);
  });
});

describe("collectDigestFacts", () => {
  it("reports change only from scheduled scans of monitored clients, in the window", async () => {
    await insertClient({ id: "cli_1", workspaceId: "ws", averageJobValue: 3000 });
    await insertClient({ id: "cli_2", workspaceId: "ws" });
    await insertClient({ id: "cli_off", workspaceId: "ws", cadence: "off" });

    // cli_1: two scheduled scans in-window; a manual scan and an out-of-window
    // scan that must both be ignored.
    await insertRun({ workspaceId: "ws", clientId: "cli_1", finishedAt: "2026-09-03T13:00:00.000Z", trigger: "scheduled", outcome: "findings", newCount: 1 });
    await insertRun({ workspaceId: "ws", clientId: "cli_1", finishedAt: "2026-09-06T13:00:00.000Z", trigger: "scheduled", outcome: "findings", newCount: 1, resolvedCount: 1 });
    await insertRun({ workspaceId: "ws", clientId: "cli_1", finishedAt: "2026-09-06T14:00:00.000Z", trigger: "manual", outcome: "findings", newCount: 5 });
    await insertRun({ workspaceId: "ws", clientId: "cli_1", finishedAt: "2026-08-20T13:00:00.000Z", trigger: "scheduled", outcome: "findings", newCount: 9 });
    // cli_2: scanned, clean.
    await insertRun({ workspaceId: "ws", clientId: "cli_2", finishedAt: "2026-09-04T13:00:00.000Z", trigger: "scheduled", outcome: "clean" });
    // cli_off: a scheduled run exists but the client is not monitored now.
    await insertRun({ workspaceId: "ws", clientId: "cli_off", finishedAt: "2026-09-04T13:00:00.000Z", trigger: "scheduled", outcome: "findings", newCount: 3 });

    await insertOpp({ id: "o_small", workspaceId: "ws", clientId: "cli_1", priceMin: 900, priceMax: 1800 });
    await insertOpp({ id: "o_big", workspaceId: "ws", clientId: "cli_1", title: "Water heater page", priceMin: 1200, priceMax: 2600 });
    await insertOpp({ id: "o_closed", workspaceId: "ws", clientId: "cli_1", priceMin: 500, priceMax: 500, status: "sold" });

    const facts = await collectDigestFacts(t, { since: SINCE, until: UNTIL, now: NOW });

    expect(facts.workspaceName).toBe("Northwind");
    expect(facts.monitoredClients).toBe(2); // cli_off excluded
    const one = facts.clients.find((c) => c.clientId === "cli_1")!;
    expect(one.newCount).toBe(2); // manual (5) and out-of-window (9) excluded
    expect(one.resolvedCount).toBe(1);
    expect(one.latestOutcome).toBe("findings");
    expect(one.openCount).toBe(2); // the sold opp is not open
    expect(one.openPriceMin).toBe(2100);
    expect(one.openPriceMax).toBe(4400);
    expect(one.topOpportunity?.id).toBe("o_big"); // highest price_max
    expect(one.averageJobValue).toBe(3000);
    expect(facts.clients.some((c) => c.clientId === "cli_off")).toBe(false);

    // The digest built from these facts lines up only the client that changed.
    const model = buildMonitorDigest(facts);
    expect(model.lines.map((l) => l.clientId)).toEqual(["cli_1"]);
    expect(model.totals.newFindings).toBe(2);
  });

  it("marks a client whose latest scheduled scan could not read the site", async () => {
    await insertClient({ id: "cli_1", workspaceId: "ws" });
    await insertRun({ workspaceId: "ws", clientId: "cli_1", finishedAt: "2026-09-02T13:00:00.000Z", trigger: "scheduled", outcome: "findings", newCount: 1 });
    await insertRun({ workspaceId: "ws", clientId: "cli_1", finishedAt: "2026-09-05T13:00:00.000Z", trigger: "scheduled", outcome: "inconclusive" });

    const facts = await collectDigestFacts(t, { since: SINCE, until: UNTIL, now: NOW });
    expect(facts.clients[0]?.couldNotRead).toBe(true);
    expect(buildMonitorDigest(facts).couldNotRead).toBe(1);
  });
});

describe("digest scheduling (scheduler-facing)", () => {
  it("selects a due workspace with its owner email, and one tick claims it", async () => {
    const due = await listWorkspacesDueForDigest(db, { now: NOW, limit: 10 });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ workspaceId: "ws", ownerEmail: "owner@agency.example", onlyOnChange: true });

    expect(await claimWorkspaceDigest(db, "ws", NOW)).toBe(true);
    // A second, overlapping tick loses the race.
    expect(await claimWorkspaceDigest(db, "ws", NOW)).toBe(false);
  });

  it("finishing advances the next due by a week and records the send time", async () => {
    await claimWorkspaceDigest(db, "ws", NOW);
    await finishWorkspaceDigest(db, "ws", { now: NOW, sent: true });

    // No longer due now; due again a week later.
    expect(await listWorkspacesDueForDigest(db, { now: NOW, limit: 10 })).toEqual([]);
    const later = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000 + 1000);
    expect(await listWorkspacesDueForDigest(db, { now: later, limit: 10 })).toHaveLength(1);
    expect((await listWorkspacesDueForDigest(db, { now: later, limit: 10 }))[0]?.lastSentAt).toBe(
      NOW.toISOString(),
    );
  });

  it("excludes [TEST] workspaces from the digest schedule", async () => {
    await insertUser("u_test", "qa@agency.example");
    await createWorkspaceForOwner(db, { id: "ws_test", name: "[TEST] QA", ownerUserId: "u_test" });
    const due = await listWorkspacesDueForDigest(db, { now: NOW, limit: 10 });
    expect(due.map((w) => w.workspaceId)).toEqual(["ws"]);
  });
});

describe("digest run log", () => {
  it("is idempotent per week and reads back most-recent first", async () => {
    const input = {
      periodStart: SINCE,
      periodEnd: UNTIL,
      sentAt: NOW.toISOString(),
      recipient: "owner@agency.example",
      outcome: "sent" as const,
      newCount: 2,
      resolvedCount: 1,
      clientCount: 1,
    };
    await recordMonitorDigestRun(t, input);
    await recordMonitorDigestRun(t, { ...input, newCount: 99 }); // same week, ignored

    const runs = await listMonitorDigestRuns(t, { limit: 10 });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.newCount).toBe(2);
    expect(runs[0]?.outcome).toBe("sent");
  });
});
