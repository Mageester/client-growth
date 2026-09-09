import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import { SCHEMA_SQL } from "@/db/schema";
import type { SqlDb } from "@/db/sql";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { listMonitorDigestRuns, listWorkspacesDueForDigest } from "@/db/monitorDigests";
import { runMonitorDigestTick } from "../app/lib/monitorDigest.server";
import type { MonitorDigestEmail } from "../app/lib/resend.server";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const NOW = new Date("2026-09-08T13:00:00.000Z");
const IN_WINDOW = "2026-09-07T13:00:00.000Z";
const BASE = "https://orbit.example";

let handle: NodeSqliteDb;
let db: SqlDb;

async function insertUser(id: string, email: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, email, email, NOW.toISOString(), NOW.toISOString())
    .run();
}

/** A workspace with one monitored client that changed this week (unless clean). */
async function makeWorkspace(input: {
  id: string;
  ownerEmail: string;
  clean?: boolean;
}): Promise<void> {
  const userId = `u_${input.id}`;
  await insertUser(userId, input.ownerEmail);
  await createWorkspaceForOwner(db, { id: input.id, name: `Agency ${input.id}`, ownerUserId: userId });
  const clientId = `cli_${input.id}`;
  await db
    .prepare(
      `INSERT INTO clients (id, workspace_id, name, domain, updated_at, monitoring_cadence)
       VALUES (?, ?, ?, ?, ?, 'weekly')`,
    )
    .bind(clientId, input.id, `Client ${input.id}`, `${input.id}.example`, NOW.toISOString())
    .run();
  await db
    .prepare(
      `INSERT INTO analysis_runs
         (workspace_id, client_id, started_at, finished_at, source, outcome, summary, trigger, new_count)
       VALUES (?, ?, ?, ?, 'http', ?, '', 'scheduled', ?)`,
    )
    .bind(input.id, clientId, IN_WINDOW, IN_WINDOW, input.clean ? "clean" : "findings", input.clean ? 0 : 2)
    .run();
  if (!input.clean) {
    await db
      .prepare(
        `INSERT INTO opportunities
           (id, workspace_id, dedupe_key, client_id, rule_id, title, detected, rationale,
            suggested_service_id, price_min, price_max, confidence, billable_status, status, updated_at)
         VALUES (?, ?, ?, ?, 'missing-service-page', 'Water heater page', ?, '', 'svc', 900, 1800, 0.8, 'billable', 'new', ?)`,
      )
      .bind(`opp_${input.id}`, input.id, `opp_${input.id}`, clientId, NOW.toISOString(), NOW.toISOString())
      .run();
  }
}

function collectingSender() {
  const sent: MonitorDigestEmail[] = [];
  const send = async (message: MonitorDigestEmail) => {
    sent.push(message);
  };
  return { sent, send };
}

beforeEach(async () => {
  handle = nodeSqliteDb(":memory:");
  await handle.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  await handle.exec(SCHEMA_SQL);
  db = handle;
});

afterEach(() => handle.close());

describe("runMonitorDigestTick", () => {
  it("emails an entitled workspace that changed, records it, and reschedules a week out", async () => {
    await makeWorkspace({ id: "ws_a", ownerEmail: "owner@agency.example" });
    const { sent, send } = collectingSender();

    const result = await runMonitorDigestTick({
      db,
      env: { MONITOR_ENTITLEMENT_MODE: "open" },
      now: NOW,
      send,
      baseUrl: BASE,
    });

    expect(result.considered).toBe(1);
    expect(result.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("owner@agency.example");
    expect(sent[0]?.subject).toContain("new");

    const runs = await listMonitorDigestRuns({ db, workspaceId: "ws_a" }, { limit: 5 });
    expect(runs[0]?.outcome).toBe("sent");
    expect(runs[0]?.newCount).toBe(2);

    // No longer due; a second tick right now does nothing.
    expect(await listWorkspacesDueForDigest(db, { now: NOW, limit: 10 })).toEqual([]);
    const second = await runMonitorDigestTick({
      db,
      env: { MONITOR_ENTITLEMENT_MODE: "open" },
      now: NOW,
      send,
      baseUrl: BASE,
    });
    expect(second.considered).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("is inert when MONITOR is entirely off", async () => {
    await makeWorkspace({ id: "ws_a", ownerEmail: "owner@agency.example" });
    const { sent, send } = collectingSender();

    const result = await runMonitorDigestTick({
      db,
      env: {}, // MONITOR off by default — nobody is entitled
      now: NOW,
      send,
      baseUrl: BASE,
    });

    expect(result.considered).toBe(0);
    expect(sent).toEqual([]);
    // No churn: not even a skip row is written for an off tier.
    expect(await listMonitorDigestRuns({ db, workspaceId: "ws_a" }, {})).toEqual([]);
  });

  it("records, but does not email, a workspace dropped from the allowlist", async () => {
    await makeWorkspace({ id: "ws_in", ownerEmail: "in@agency.example" });
    await makeWorkspace({ id: "ws_out", ownerEmail: "out@agency.example" });
    const { sent, send } = collectingSender();

    const result = await runMonitorDigestTick({
      db,
      env: { MONITOR_ENTITLEMENT_MODE: "allowlist", MONITOR_ALLOWLIST: "in@agency.example" },
      now: NOW,
      send,
      baseUrl: BASE,
    });

    expect(sent.map((m) => m.to)).toEqual(["in@agency.example"]);
    expect((await listMonitorDigestRuns({ db, workspaceId: "ws_out" }, {}))[0]?.outcome).toBe(
      "skipped_not_entitled",
    );
    expect((await listMonitorDigestRuns({ db, workspaceId: "ws_in" }, {}))[0]?.outcome).toBe("sent");
    expect(result.sent).toBe(1);
  });

  it("stays silent on a quiet week when only-on-change is on", async () => {
    await makeWorkspace({ id: "ws_a", ownerEmail: "owner@agency.example", clean: true });
    const { sent, send } = collectingSender();

    const result = await runMonitorDigestTick({
      db,
      env: { MONITOR_ENTITLEMENT_MODE: "open" },
      now: NOW,
      send,
      baseUrl: BASE,
    });

    expect(sent).toEqual([]);
    expect(result.sent).toBe(0);
    const runs = await listMonitorDigestRuns({ db, workspaceId: "ws_a" }, { limit: 5 });
    expect(runs[0]?.outcome).toBe("skipped_no_change");
  });

  it("one workspace's send failure does not stop the others", async () => {
    await makeWorkspace({ id: "ws_a", ownerEmail: "fail@agency.example" });
    await makeWorkspace({ id: "ws_b", ownerEmail: "ok@agency.example" });
    const sent: MonitorDigestEmail[] = [];
    const send = async (message: MonitorDigestEmail) => {
      if (message.to === "fail@agency.example") throw new Error("provider timeout");
      sent.push(message);
    };

    const result = await runMonitorDigestTick({
      db,
      env: { MONITOR_ENTITLEMENT_MODE: "open" },
      now: NOW,
      send,
      baseUrl: BASE,
    });

    expect(result.considered).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(sent.map((m) => m.to)).toEqual(["ok@agency.example"]);
    expect((await listMonitorDigestRuns({ db, workspaceId: "ws_a" }, {}))[0]?.outcome).toBe("failed");
    expect((await listMonitorDigestRuns({ db, workspaceId: "ws_b" }, {}))[0]?.outcome).toBe("sent");
  });

  it("does nothing when no email transport is configured", async () => {
    await makeWorkspace({ id: "ws_a", ownerEmail: "owner@agency.example" });
    // No injected sender and no RESEND/EMAIL_TRANSPORT in env => cannot deliver.
    const result = await runMonitorDigestTick({
      db,
      env: { MONITOR_ENTITLEMENT_MODE: "open" },
      now: NOW,
      baseUrl: BASE,
    });
    expect(result.considered).toBe(0);
    expect(result.sent).toBe(0);
  });

  it("bounds how many workspaces one tick emails", async () => {
    await makeWorkspace({ id: "ws_a", ownerEmail: "a@agency.example" });
    await makeWorkspace({ id: "ws_b", ownerEmail: "b@agency.example" });
    await makeWorkspace({ id: "ws_c", ownerEmail: "c@agency.example" });
    const { sent, send } = collectingSender();

    const result = await runMonitorDigestTick({
      db,
      env: { MONITOR_ENTITLEMENT_MODE: "open" },
      now: NOW,
      limit: 2,
      send,
      baseUrl: BASE,
    });

    expect(result.considered).toBe(2);
    expect(sent).toHaveLength(2);
    // The third is still due for the next tick.
    expect(await listWorkspacesDueForDigest(db, { now: NOW, limit: 10 })).toHaveLength(1);
  });
});
