import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reserveAnalysisStart } from "@/db/analysisLimits";
import * as monitoring from "@/db/monitoring";
import * as repo from "@/db/repositories";
import { runMonitoringTick } from "../app/lib/monitoring.server";
import { buildPortfolio, setMonitoringDirect, type Portfolio } from "./helpers/portfolio";

const NOW = new Date("2026-09-04T12:00:00.000Z");
const ENV = { AI_PROVIDER: "mock", MAX_AI_CALLS_PER_RUN: "10" };

let portfolio: Portfolio;

beforeEach(async () => {
  portfolio = await buildPortfolio({ workspaces: 1, perWorkspace: 3, now: NOW });
});

afterEach(() => portfolio.close());

describe("scheduled analysis admission", () => {
  it("defers a limit-rejected client without recording a failed run", async () => {
    const target = portfolio.clients.find((client) => client.cadence !== "off")!;
    await setMonitoringDirect(
      portfolio.db,
      { ...target, dueOffsetMs: -60 * 60 * 1000 },
      NOW,
    );
    await reserveAnalysisStart(portfolio.scopeFor(target.workspaceId), target.clientId, {
      now: NOW,
      cooldownMs: 5 * 60 * 1000,
    });

    const result = await runMonitoringTick({
      db: portfolio.db,
      env: ENV,
      now: NOW,
      limit: 1,
    });

    expect(result.failed).toBe(0);
    expect(result.scanned).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.clients[0]?.outcome).toBe("skipped");
    expect(
      await repo.getLatestAnalysisRun(portfolio.scopeFor(target.workspaceId), target.clientId),
    ).toBeNull();

    const state = await monitoring.getMonitoring(
      portfolio.scopeFor(target.workspaceId),
      target.clientId,
    );
    expect(state?.claimedAt).toBeNull();
    expect(state?.nextDueAt).toBe("2026-09-04T12:05:00.000Z");
  });
});
