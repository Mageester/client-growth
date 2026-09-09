import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TenantScope } from "@/db/tenant";
import {
  runMonitoringTick,
  type AnalyzeForMonitoring,
} from "../app/lib/monitoring.server";
import type { RunAnalysisResult } from "../app/lib/analysis.server";
import { buildPortfolio, type Portfolio } from "./helpers/portfolio";

/**
 * MONITOR is a paid feature and the recurring scan is its engine, so a workspace
 * that is not entitled must never be scanned — no unattended provider spend for
 * a tenant nobody is paying for. This is the spend half of the gate; the enable
 * half lives on the client page (a workspace can only turn monitoring on while
 * entitled), and together they mean an unentitled workspace is never in the
 * scheduler.
 */

const NOW = new Date("2026-09-02T12:00:00.000Z");

let portfolio: Portfolio;

beforeEach(async () => {
  portfolio = await buildPortfolio({ workspaces: 2, perWorkspace: 3, now: NOW });
});

afterEach(() => portfolio.close());

function fakeRun(): RunAnalysisResult {
  return {
    verdict: { outcome: "clean", summary: "", limitation: null, reach: {} },
    change: { newCount: 0, stillOpenCount: 0, resolvedCount: 0 },
    stats: { aiCalls: 0 },
  } as unknown as RunAnalysisResult;
}

function recordingAnalyze() {
  const seen: Array<{ clientId: string; workspaceId: string }> = [];
  const analyze: AnalyzeForMonitoring = async (t: TenantScope, _env, clientId) => {
    seen.push({ clientId, workspaceId: t.workspaceId });
    return fakeRun();
  };
  return { analyze, seen };
}

/** The one due, monitored client per workspace the fixture schedules. */
const dueSpecs = () =>
  portfolio.clients.filter((c) => c.cadence !== "off" && (c.dueOffsetMs ?? 0) < 0);

async function insertOwner(userId: string, email: string): Promise<void> {
  await portfolio.db
    .prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(userId, email, email, NOW.toISOString(), NOW.toISOString())
    .run();
}

describe("scan-tick entitlement guard", () => {
  it("scans nothing when MONITOR is off, however due a client is", async () => {
    const { analyze, seen } = recordingAnalyze();
    const result = await runMonitoringTick({
      db: portfolio.db,
      env: {}, // no MONITOR_ENTITLEMENT_MODE => off by default
      now: NOW,
      limit: 100,
      analyze,
    });

    expect(seen).toEqual([]);
    expect(result.considered).toBe(dueSpecs().length);
    expect(result.scanned).toBe(0);
    expect(result.skipped).toBe(result.considered);
    expect(result.evaluatorCalls).toBe(0);
    expect(result.clients.every((c) => c.outcome === "skipped")).toBe(true);
  });

  it("scans only workspaces whose owner is on the allowlist", async () => {
    await insertOwner("u_ws_a", "owner@agency.example");
    await insertOwner("u_ws_b", "owner@other.example");

    const { analyze, seen } = recordingAnalyze();
    const result = await runMonitoringTick({
      db: portfolio.db,
      env: {
        MONITOR_ENTITLEMENT_MODE: "allowlist",
        MONITOR_ALLOWLIST: "owner@agency.example",
      },
      now: NOW,
      limit: 100,
      analyze,
    });

    const scannedWorkspaces = new Set(seen.map((s) => s.workspaceId));
    expect(scannedWorkspaces).toEqual(new Set(["ws_a"]));
    expect(result.scanned).toBe(1);
    expect(result.skipped).toBe(dueSpecs().length - 1);
    // The unentitled workspace's client is skipped, not merely left unclaimed.
    expect(
      result.clients.find((c) => c.workspaceId === "ws_b")?.outcome,
    ).toBe("skipped");
  });

  it("scans every due client when MONITOR is open", async () => {
    const { analyze, seen } = recordingAnalyze();
    const result = await runMonitoringTick({
      db: portfolio.db,
      env: { MONITOR_ENTITLEMENT_MODE: "open" },
      now: NOW,
      limit: 100,
      analyze,
    });

    expect(seen.map((s) => s.clientId).sort()).toEqual(
      dueSpecs().map((c) => c.clientId).sort(),
    );
    expect(result.scanned).toBe(dueSpecs().length);
  });
});
