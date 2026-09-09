import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CADENCE_INTERVAL_MS, MONITORING_FAILURE_BACKOFF_MS } from "@/core/monitoring";
import * as monitoring from "@/db/monitoring";
import * as repo from "@/db/repositories";
import type { TenantScope } from "@/db/tenant";
import {
  runMonitoringTick,
  type AnalyzeForMonitoring,
} from "../app/lib/monitoring.server";
import type { RunAnalysisResult } from "../app/lib/analysis.server";
import { buildPortfolio, setMonitoringDirect, type Portfolio } from "./helpers/portfolio";

const NOW = new Date("2026-09-02T12:00:00.000Z");
const ENV = { AI_PROVIDER: "mock", MAX_AI_CALLS_PER_RUN: "10", MONITOR_ENTITLEMENT_MODE: "open" };

let portfolio: Portfolio;

beforeEach(async () => {
  portfolio = await buildPortfolio({ workspaces: 3, perWorkspace: 8, now: NOW });
});

afterEach(() => {
  portfolio.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * A stand-in for the analysis itself. The scheduler's contract with the analysis
 * is small — a verdict, a change summary and an evaluator call count — so the
 * scheduling tests drive that seam directly and the pipeline is exercised for
 * real in monitoring.scale.test.ts.
 */
function fakeRun(input: {
  outcome: "findings" | "clean" | "inconclusive";
  newCount?: number;
  resolvedCount?: number;
  aiCalls?: number;
}): RunAnalysisResult {
  return {
    verdict: { outcome: input.outcome, summary: "", limitation: null, reach: {} },
    change: {
      newCount: input.newCount ?? 0,
      stillOpenCount: 0,
      resolvedCount: input.resolvedCount ?? 0,
    },
    stats: { aiCalls: input.aiCalls ?? 0 },
  } as unknown as RunAnalysisResult;
}

/** Records which (workspace, client) pairs the scheduler handed to the analysis. */
function recordingAnalyze(
  behaviour: (clientId: string) => RunAnalysisResult | Promise<RunAnalysisResult> = () =>
    fakeRun({ outcome: "clean" }),
) {
  const seen: Array<{ clientId: string; workspaceId: string }> = [];
  const analyze: AnalyzeForMonitoring = async (t: TenantScope, _env, clientId) => {
    seen.push({ clientId, workspaceId: t.workspaceId });
    return behaviour(clientId);
  };
  return { analyze, seen };
}

const dueSpecs = () =>
  portfolio.clients.filter((c) => c.cadence !== "off" && (c.dueOffsetMs ?? 0) < 0);

describe("selecting work", () => {
  it("analyzes only monitored clients that are actually due", async () => {
    const { analyze, seen } = recordingAnalyze();
    await runMonitoringTick({ db: portfolio.db, env: ENV, now: NOW, limit: 100, analyze });

    expect(seen.map((s) => s.clientId).sort()).toEqual(
      dueSpecs().map((c) => c.clientId).sort(),
    );
  });

  it("never analyzes a client whose monitoring is off, however stale it is", async () => {
    const { analyze, seen } = recordingAnalyze();
    await runMonitoringTick({ db: portfolio.db, env: ENV, now: NOW, limit: 100, analyze });

    const offIds = new Set(
      portfolio.clients.filter((c) => c.cadence === "off").map((c) => c.clientId),
    );
    expect(seen.some((s) => offIds.has(s.clientId))).toBe(false);
  });

  it("does nothing at all when a whole portfolio is unmonitored", async () => {
    // The canary guarantee, stated as a test: deploying the scheduler against a
    // portfolio where nobody has opted in must cost nothing.
    for (const client of portfolio.clients) {
      await setMonitoringDirect(portfolio.db, { ...client, cadence: "off", dueOffsetMs: null }, NOW);
    }
    const { analyze, seen } = recordingAnalyze();
    const result = await runMonitoringTick({
      db: portfolio.db,
      env: ENV,
      now: NOW,
      limit: 100,
      analyze,
    });

    expect(seen).toEqual([]);
    expect(result.considered).toBe(0);
    expect(result.evaluatorCalls).toBe(0);
  });

  it("caps how many clients one invocation analyzes", async () => {
    const { analyze, seen } = recordingAnalyze();
    const result = await runMonitoringTick({
      db: portfolio.db,
      env: ENV,
      now: NOW,
      limit: 3,
      analyze,
    });

    expect(dueSpecs().length).toBeGreaterThan(3);
    expect(seen).toHaveLength(3);
    expect(result.scanned).toBe(3);
  });

  it("leaves the clients it did not reach due for the next tick", async () => {
    const first = recordingAnalyze();
    await runMonitoringTick({
      db: portfolio.db,
      env: ENV,
      now: NOW,
      limit: 2,
      analyze: first.analyze,
    });
    const second = recordingAnalyze();
    await runMonitoringTick({
      db: portfolio.db,
      env: ENV,
      now: NOW,
      limit: 100,
      analyze: second.analyze,
    });

    const firstIds = first.seen.map((s) => s.clientId);
    const secondIds = second.seen.map((s) => s.clientId);
    // Nothing repeats, and between them the two ticks cover everything due.
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
    expect([...firstIds, ...secondIds].sort()).toEqual(dueSpecs().map((c) => c.clientId).sort());
  });

  it("stops when the wall-clock budget is spent and says so", async () => {
    const { analyze, seen } = recordingAnalyze(async () => {
      await new Promise((resolve) => setTimeout(resolve, 12));
      return fakeRun({ outcome: "clean" });
    });
    const result = await runMonitoringTick({
      db: portfolio.db,
      env: ENV,
      now: NOW,
      limit: 100,
      budgetMs: 10,
      analyze,
    });

    expect(result.budgetExhausted).toBe(true);
    expect(seen.length).toBeLessThan(dueSpecs().length);
    // Whatever it did start, it finished and recorded — no half-run clients.
    for (const scanned of seen) {
      const state = await monitoring.getMonitoring(
        portfolio.scopeFor(scanned.workspaceId),
        scanned.clientId,
      );
      expect(state?.claimedAt).toBeNull();
      expect(state?.lastOutcome).toBe("clean");
    }
  });
});

describe("tenant ownership", () => {
  it("analyzes every client under its own workspace, never another's", async () => {
    const { analyze, seen } = recordingAnalyze();
    await runMonitoringTick({ db: portfolio.db, env: ENV, now: NOW, limit: 100, analyze });

    expect(seen.length).toBeGreaterThan(0);
    for (const entry of seen) {
      const spec = portfolio.clients.find((c) => c.clientId === entry.clientId)!;
      expect(entry.workspaceId).toBe(spec.workspaceId);
    }
  });

  it("one workspace's failure leaves every other workspace's scan intact", async () => {
    const poisoned = dueSpecs().filter((c) => c.workspaceId === "ws_a");
    const { analyze, seen } = recordingAnalyze((clientId) => {
      if (poisoned.some((c) => c.clientId === clientId)) {
        throw new Error("crawl exploded");
      }
      return fakeRun({ outcome: "findings", newCount: 1 });
    });

    const result = await runMonitoringTick({
      db: portfolio.db,
      env: ENV,
      now: NOW,
      limit: 100,
      analyze,
    });

    expect(result.failed).toBe(poisoned.length);
    expect(result.scanned).toBe(dueSpecs().length - poisoned.length);
    // Everything due was still attempted.
    expect(seen).toHaveLength(dueSpecs().length);

    for (const other of dueSpecs().filter((c) => c.workspaceId !== "ws_a")) {
      const state = await monitoring.getMonitoring(portfolio.scopeFor(other.workspaceId), other.clientId);
      expect(state?.lastOutcome).toBe("findings");
    }
  });
});

describe("duplicate and interrupted invocations", () => {
  it("two overlapping ticks never analyze the same client twice", async () => {
    // Both ticks are genuinely in flight: the first suspends inside its first
    // analysis, which is exactly when the second one starts claiming.
    const seen: string[] = [];
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstCall = true;

    const analyze: AnalyzeForMonitoring = async (_t, _env, clientId) => {
      seen.push(clientId);
      if (firstCall) {
        firstCall = false;
        await gate;
      }
      return fakeRun({ outcome: "clean" });
    };

    const a = runMonitoringTick({ db: portfolio.db, env: ENV, now: NOW, limit: 100, analyze });
    const b = runMonitoringTick({ db: portfolio.db, env: ENV, now: NOW, limit: 100, analyze });
    release!();
    const [first, second] = await Promise.all([a, b]);

    expect(new Set(seen).size).toBe(seen.length);
    expect(first.scanned + second.scanned).toBe(dueSpecs().length);
    expect(second.skipped + first.skipped).toBeGreaterThan(0);
  });

  it("a second tick immediately after the first finds nothing left to do", async () => {
    const first = recordingAnalyze();
    await runMonitoringTick({
      db: portfolio.db,
      env: ENV,
      now: NOW,
      limit: 100,
      analyze: first.analyze,
    });
    const second = recordingAnalyze();
    const result = await runMonitoringTick({
      db: portfolio.db,
      env: ENV,
      now: NOW,
      limit: 100,
      analyze: second.analyze,
    });

    expect(second.seen).toEqual([]);
    expect(result.considered).toBe(0);
  });

  it("picks up a client abandoned by an interrupted run", async () => {
    const target = dueSpecs()[0]!;
    await setMonitoringDirect(
      portfolio.db,
      { ...target, claimedOffsetMs: -(2 * 60 * 60 * 1000) },
      NOW,
    );
    const { analyze, seen } = recordingAnalyze();
    await runMonitoringTick({ db: portfolio.db, env: ENV, now: NOW, limit: 100, analyze });
    expect(seen.map((s) => s.clientId)).toContain(target.clientId);
  });

  it("skips a client whose monitoring is switched off between selection and claim", async () => {
    const target = dueSpecs()[0]!;
    const scope = portfolio.scopeFor(target.workspaceId);
    const original = monitoring.claimClient;
    // Simulate the person turning monitoring off at the worst possible moment.
    vi.spyOn(monitoring, "claimClient").mockImplementation(async (db, candidate, now) => {
      if (candidate.clientId === target.clientId) {
        await monitoring.setMonitoringCadence(scope, target.clientId, "off", {
          lastAnalyzedAt: null,
          now,
        });
      }
      return original(db, candidate, now);
    });

    const { analyze, seen } = recordingAnalyze();
    const result = await runMonitoringTick({
      db: portfolio.db,
      env: ENV,
      now: NOW,
      limit: 100,
      analyze,
    });

    expect(seen.map((s) => s.clientId)).not.toContain(target.clientId);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    const state = await monitoring.getMonitoring(scope, target.clientId);
    expect(state?.cadence).toBe("off");
    expect(state?.nextDueAt).toBeNull();
  });
});

describe("recording what happened", () => {
  it("advances the next check only for the clients it actually processed", async () => {
    // The next check is measured from when the scan FINISHED, not from when the
    // tick started, so the clock is frozen to make that exact.
    vi.useFakeTimers({ now: NOW });
    const { analyze } = recordingAnalyze();
    await runMonitoringTick({ db: portfolio.db, env: ENV, now: NOW, limit: 2, analyze });

    const processed = new Set(
      (await Promise.all(
        dueSpecs().map(async (spec) => {
          const state = await monitoring.getMonitoring(
            portfolio.scopeFor(spec.workspaceId),
            spec.clientId,
          );
          return state?.lastOutcome ? spec.clientId : null;
        }),
      )).filter(Boolean),
    );
    expect(processed.size).toBe(2);

    for (const spec of dueSpecs()) {
      const state = await monitoring.getMonitoring(
        portfolio.scopeFor(spec.workspaceId),
        spec.clientId,
      );
      if (processed.has(spec.clientId)) {
        expect(state!.nextDueAt).toBe(
          new Date(NOW.getTime() + CADENCE_INTERVAL_MS.weekly).toISOString(),
        );
      } else {
        // Untouched clients keep their original overdue schedule.
        expect(state!.nextDueAt! <= NOW.toISOString()).toBe(true);
      }
    }
    vi.useRealTimers();
  });

  it("records a failed scan as a visible, inconclusive run and backs it off", async () => {
    vi.useFakeTimers({ now: NOW });
    const target = dueSpecs()[0]!;
    const scope = portfolio.scopeFor(target.workspaceId);
    const { analyze } = recordingAnalyze((clientId) => {
      if (clientId === target.clientId) throw new Error("provider unreachable");
      return fakeRun({ outcome: "clean" });
    });

    await runMonitoringTick({ db: portfolio.db, env: ENV, now: NOW, limit: 100, analyze });

    const run = await repo.getLatestAnalysisRun(scope, target.clientId);
    expect(run?.outcome).toBe("inconclusive");
    expect(run?.trigger).toBe("scheduled");
    expect(run?.surfaced).toBe(0);
    expect(run?.summary).toMatch(/could not be completed/i);
    // A failure never reads as a clean bill of health.
    expect(run?.summary).not.toMatch(/no unmet billable work/i);

    const state = await monitoring.getMonitoring(scope, target.clientId);
    expect(state?.lastOutcome).toBe("failed");
    expect(state?.consecutiveFailures).toBe(1);
    expect(state?.claimedAt).toBeNull();
    expect(state?.nextDueAt! > NOW.toISOString()).toBe(true);
    expect(state?.nextDueAt).toBe(
      new Date(NOW.getTime() + MONITORING_FAILURE_BACKOFF_MS[0]!).toISOString(),
    );
    vi.useRealTimers();
  });

  it("keeps going, and still releases the claim, when recording state throws", async () => {
    const target = dueSpecs()[0]!;
    vi.spyOn(monitoring, "finishMonitoringRun").mockImplementationOnce(() => {
      throw new Error("D1 write failed");
    });
    const { analyze, seen } = recordingAnalyze();
    const result = await runMonitoringTick({
      db: portfolio.db,
      env: ENV,
      now: NOW,
      limit: 100,
      analyze,
    });

    expect(seen.length).toBe(dueSpecs().length);
    expect(result.scanned).toBe(dueSpecs().length);
    // The client whose bookkeeping failed keeps its claim until the TTL expires,
    // which is the safe direction: it is not scanned twice in the meantime.
    const state = await monitoring.getMonitoring(
      portfolio.scopeFor(target.workspaceId),
      target.clientId,
    );
    expect(state?.claimedAt).not.toBeNull();
  });

  it("totals the change across the whole tick", async () => {
    const { analyze } = recordingAnalyze(() =>
      fakeRun({ outcome: "findings", newCount: 2, resolvedCount: 1, aiCalls: 3 }),
    );
    const result = await runMonitoringTick({
      db: portfolio.db,
      env: ENV,
      now: NOW,
      limit: 4,
      analyze,
    });

    expect(result.scanned).toBe(4);
    expect(result.newFindings).toBe(8);
    expect(result.resolvedFindings).toBe(4);
    expect(result.evaluatorCalls).toBe(12);
  });
});
