import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CADENCE_INTERVAL_MS,
  MONITORING_CLAIM_TTL_MS,
  MONITORING_FAILURE_BACKOFF_MS,
} from "@/core/monitoring";
import * as monitoring from "@/db/monitoring";
import * as repo from "@/db/repositories";
import type { TenantScope } from "@/db/tenant";
import { buildPortfolio, setMonitoringDirect, type Portfolio } from "./helpers/portfolio";

const NOW = new Date("2026-09-02T12:00:00.000Z");

let portfolio: Portfolio;
let alpha: TenantScope;
let beta: TenantScope;

beforeEach(async () => {
  portfolio = await buildPortfolio({ workspaces: 2, perWorkspace: 6, now: NOW });
  alpha = portfolio.scopeFor("ws_a");
  beta = portfolio.scopeFor("ws_b");
});

afterEach(() => portfolio.close());

/** Every client in the fixture starts with a deterministic monitoring state. */
const alphaClients = () => portfolio.clients.filter((c) => c.workspaceId === "ws_a");

describe("monitoring state storage", () => {
  it("defaults every client to off, with nothing scheduled", async () => {
    const off = alphaClients().find((c) => c.cadence === "off")!;
    const state = await monitoring.getMonitoring(alpha, off.clientId);
    expect(state).toEqual({
      cadence: "off",
      nextDueAt: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastOutcome: null,
      consecutiveFailures: 0,
      claimedAt: null,
    });
  });

  it("reads an unknown stored cadence as off rather than throwing", async () => {
    // Defence against a row written by a newer deploy or edited by hand: the
    // safe reading of "I do not understand this cadence" is "do not scan".
    const target = alphaClients()[0]!;
    await portfolio.db
      .prepare("UPDATE clients SET monitoring_cadence = 'hourly' WHERE id = ?")
      .bind(target.clientId)
      .run();
    const state = await monitoring.getMonitoring(alpha, target.clientId);
    expect(state?.cadence).toBe("off");
    expect(state?.nextDueAt).toBeNull();
  });

  it("cannot read or change a client in another workspace", async () => {
    const target = alphaClients()[0]!;
    expect(await monitoring.getMonitoring(beta, target.clientId)).toBeNull();
    expect(
      await monitoring.setMonitoringCadence(beta, target.clientId, "weekly", {
        lastAnalyzedAt: null,
        now: NOW,
      }),
    ).toBeNull();
    // ...and the real owner's state is untouched.
    const state = await monitoring.getMonitoring(alpha, target.clientId);
    expect(state?.cadence).toBe(target.cadence);
  });

  it("turning monitoring on schedules it; turning it off unschedules it", async () => {
    const target = alphaClients().find((c) => c.cadence === "off")!;
    const on = await monitoring.setMonitoringCadence(alpha, target.clientId, "weekly", {
      lastAnalyzedAt: null,
      now: NOW,
    });
    expect(on?.nextDueAt).toBe(NOW.toISOString());
    expect((await monitoring.getMonitoring(alpha, target.clientId))?.nextDueAt).toBe(
      NOW.toISOString(),
    );

    const offAgain = await monitoring.setMonitoringCadence(alpha, target.clientId, "off", {
      lastAnalyzedAt: null,
      now: NOW,
    });
    expect(offAgain?.nextDueAt).toBeNull();
    const stored = await monitoring.getMonitoring(alpha, target.clientId);
    expect(stored?.cadence).toBe("off");
    expect(stored?.nextDueAt).toBeNull();
  });
});

describe("selecting clients that are due", () => {
  it("selects only monitored, due, unclaimed clients", async () => {
    const due = await monitoring.listDueClients(portfolio.db, { now: NOW, limit: 100 });
    const expected = portfolio.clients
      .filter((c) => c.cadence !== "off" && (c.dueOffsetMs ?? 0) < 0)
      .map((c) => c.clientId)
      .sort();
    expect(due.map((d) => d.clientId).sort()).toEqual(expected);
    expect(due.length).toBeGreaterThan(0);
  });

  it("never selects a client whose monitoring is off", async () => {
    const due = await monitoring.listDueClients(portfolio.db, { now: NOW, limit: 100 });
    const offIds = new Set(
      portfolio.clients.filter((c) => c.cadence === "off").map((c) => c.clientId),
    );
    expect(due.some((d) => offIds.has(d.clientId))).toBe(false);
  });

  it("carries the owning workspace so nothing downstream has to guess", async () => {
    const due = await monitoring.listDueClients(portfolio.db, { now: NOW, limit: 100 });
    for (const candidate of due) {
      const spec = portfolio.clients.find((c) => c.clientId === candidate.clientId)!;
      expect(candidate.workspaceId).toBe(spec.workspaceId);
    }
  });

  it("respects the batch cap and takes the longest-overdue first", async () => {
    const target = alphaClients().find((c) => c.cadence !== "off")!;
    await setMonitoringDirect(
      portfolio.db,
      { ...target, cadence: "weekly", dueOffsetMs: -30 * 24 * 60 * 60 * 1000 },
      NOW,
    );
    const due = await monitoring.listDueClients(portfolio.db, { now: NOW, limit: 2 });
    expect(due).toHaveLength(2);
    expect(due[0]!.clientId).toBe(target.clientId);
  });

  it("a limit of zero selects nothing", async () => {
    expect(await monitoring.listDueClients(portfolio.db, { now: NOW, limit: 0 })).toEqual([]);
  });

  it("skips a client a live invocation already holds", async () => {
    const target = alphaClients().find((c) => c.cadence !== "off" && c.dueOffsetMs! < 0)!;
    await setMonitoringDirect(
      portfolio.db,
      { ...target, claimedOffsetMs: -60_000 },
      NOW,
    );
    const due = await monitoring.listDueClients(portfolio.db, { now: NOW, limit: 100 });
    expect(due.map((d) => d.clientId)).not.toContain(target.clientId);
  });

  it("reclaims a client whose previous run was interrupted", async () => {
    const target = alphaClients().find((c) => c.cadence !== "off" && c.dueOffsetMs! < 0)!;
    await setMonitoringDirect(
      portfolio.db,
      { ...target, claimedOffsetMs: -(MONITORING_CLAIM_TTL_MS + 60_000) },
      NOW,
    );
    const due = await monitoring.listDueClients(portfolio.db, { now: NOW, limit: 100 });
    expect(due.map((d) => d.clientId)).toContain(target.clientId);
  });
});

describe("claiming a client", () => {
  const dueTarget = () => alphaClients().find((c) => c.cadence !== "off" && c.dueOffsetMs! < 0)!;

  it("exactly one of two overlapping invocations wins the same client", async () => {
    const target = dueTarget();
    const first = await monitoring.claimClient(portfolio.db, target, NOW);
    const second = await monitoring.claimClient(portfolio.db, target, NOW);
    expect([first, second]).toEqual([true, false]);
  });

  it("refuses a client whose monitoring was switched off after selection", async () => {
    const target = dueTarget();
    await monitoring.setMonitoringCadence(alpha, target.clientId, "off", {
      lastAnalyzedAt: null,
      now: NOW,
    });
    expect(await monitoring.claimClient(portfolio.db, target, NOW)).toBe(false);
  });

  it("refuses a client that has been deleted", async () => {
    const target = dueTarget();
    await portfolio.db.prepare("DELETE FROM clients WHERE id = ?").bind(target.clientId).run();
    expect(await monitoring.claimClient(portfolio.db, target, NOW)).toBe(false);
  });

  it("refuses a claim aimed at the wrong workspace", async () => {
    const target = dueTarget();
    expect(
      await monitoring.claimClient(
        portfolio.db,
        { clientId: target.clientId, workspaceId: "ws_b" },
        NOW,
      ),
    ).toBe(false);
  });

  it("records the attempt time when the claim is taken", async () => {
    const target = dueTarget();
    await monitoring.claimClient(portfolio.db, target, NOW);
    const state = await monitoring.getMonitoring(alpha, target.clientId);
    expect(state?.lastAttemptAt).toBe(NOW.toISOString());
    expect(state?.claimedAt).toBe(NOW.toISOString());
  });
});

describe("finishing a run", () => {
  const dueTarget = () => alphaClients().find((c) => c.cadence !== "off" && c.dueOffsetMs! < 0)!;

  it("releases the claim and schedules the next check a full cadence out", async () => {
    const target = dueTarget();
    await monitoring.claimClient(portfolio.db, target, NOW);
    const state = await monitoring.finishMonitoringRun(alpha, target.clientId, {
      outcome: "clean",
      now: NOW,
    });
    expect(state?.claimedAt).toBeNull();
    expect(state?.lastOutcome).toBe("clean");
    expect(state?.nextDueAt).toBe(
      new Date(NOW.getTime() + CADENCE_INTERVAL_MS.weekly).toISOString(),
    );
    expect(state?.consecutiveFailures).toBe(0);
  });

  it("counts consecutive failures and backs off, then resets on the next success", async () => {
    const target = dueTarget();
    await monitoring.finishMonitoringRun(alpha, target.clientId, {
      outcome: "failed",
      now: NOW,
    });
    let state = await monitoring.getMonitoring(alpha, target.clientId);
    expect(state?.consecutiveFailures).toBe(1);
    expect(state?.nextDueAt).toBe(
      new Date(NOW.getTime() + MONITORING_FAILURE_BACKOFF_MS[0]!).toISOString(),
    );
    // A failure must not be mistaken for a successful check.
    expect(state?.lastSuccessAt).toBeNull();

    await monitoring.finishMonitoringRun(alpha, target.clientId, {
      outcome: "failed",
      now: NOW,
    });
    state = await monitoring.getMonitoring(alpha, target.clientId);
    expect(state?.consecutiveFailures).toBe(2);

    await monitoring.finishMonitoringRun(alpha, target.clientId, {
      outcome: "findings",
      now: NOW,
    });
    state = await monitoring.getMonitoring(alpha, target.clientId);
    expect(state?.consecutiveFailures).toBe(0);
    expect(state?.lastSuccessAt).toBe(NOW.toISOString());
  });

  it("does not reschedule a client whose monitoring was turned off mid-run", async () => {
    // The agency's decision is the one that survives. A finished scan writing a
    // next_due_at here would silently switch monitoring back on.
    const target = dueTarget();
    await monitoring.claimClient(portfolio.db, target, NOW);
    await monitoring.setMonitoringCadence(alpha, target.clientId, "off", {
      lastAnalyzedAt: null,
      now: NOW,
    });

    await monitoring.finishMonitoringRun(alpha, target.clientId, {
      outcome: "clean",
      now: NOW,
    });
    const state = await monitoring.getMonitoring(alpha, target.clientId);
    expect(state?.cadence).toBe("off");
    expect(state?.nextDueAt).toBeNull();
    expect(state?.claimedAt).toBeNull();
  });

  it("is a no-op for a client deleted mid-run", async () => {
    const target = dueTarget();
    await monitoring.claimClient(portfolio.db, target, NOW);
    await portfolio.db.prepare("DELETE FROM clients WHERE id = ?").bind(target.clientId).run();
    expect(
      await monitoring.finishMonitoringRun(alpha, target.clientId, {
        outcome: "clean",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("cannot finish another workspace's run", async () => {
    const target = dueTarget();
    await monitoring.claimClient(portfolio.db, target, NOW);
    expect(
      await monitoring.finishMonitoringRun(beta, target.clientId, {
        outcome: "clean",
        now: NOW,
      }),
    ).toBeNull();
    expect((await monitoring.getMonitoring(alpha, target.clientId))?.claimedAt).toBe(
      NOW.toISOString(),
    );
  });
});

describe("portfolio and health summaries", () => {
  it("counts what is monitored, what is due, and what is not healthy", async () => {
    const states = await monitoring.listMonitoringByClient(alpha);
    const summary = monitoring.summarizePortfolio(states.values(), NOW);
    const specs = alphaClients();
    expect(summary.monitored).toBe(specs.filter((c) => c.cadence !== "off").length);
    expect(summary.due).toBe(
      specs.filter((c) => c.cadence !== "off" && (c.dueOffsetMs ?? 0) < 0).length,
    );
    expect(summary.unhealthy).toBe(0);

    const target = specs.find((c) => c.cadence !== "off")!;
    await monitoring.finishMonitoringRun(alpha, target.clientId, {
      outcome: "inconclusive",
      now: NOW,
    });
    const after = monitoring.summarizePortfolio(
      (await monitoring.listMonitoringByClient(alpha)).values(),
      NOW,
    );
    expect(after.unhealthy).toBe(1);
  });

  it("aggregates scheduled-run health and ignores manual runs and other workspaces", async () => {
    const alphaClient = alphaClients()[0]!;
    const betaClient = portfolio.clients.find((c) => c.workspaceId === "ws_b")!;

    const base = {
      startedAt: NOW.toISOString(),
      finishedAt: NOW.toISOString(),
      source: "http",
      summary: "s",
      limitation: null,
      pagesRead: 3,
      pagesFetched: 3,
      blockedEvents: 0,
      inconclusiveEvents: 0,
      stats: {},
    };

    await repo.recordAnalysisRun(alpha, {
      ...base,
      clientId: alphaClient.clientId,
      outcome: "findings",
      surfaced: 2,
      trigger: "scheduled",
      newCount: 2,
      resolvedCount: 1,
      evaluatorCalls: 4,
      evaluatorRejections: 2,
      evaluatorErrors: 1,
    });
    await repo.recordAnalysisRun(alpha, {
      ...base,
      clientId: alphaClient.clientId,
      outcome: "inconclusive",
      surfaced: 0,
      trigger: "scheduled",
      newCount: 0,
      resolvedCount: 0,
      evaluatorCalls: 0,
      evaluatorRejections: 0,
      evaluatorErrors: 0,
    });
    // A manual run must not count toward monitoring health.
    await repo.recordAnalysisRun(alpha, {
      ...base,
      clientId: alphaClient.clientId,
      outcome: "findings",
      surfaced: 9,
      trigger: "manual",
      newCount: 9,
      resolvedCount: 9,
      evaluatorCalls: 9,
      evaluatorRejections: 9,
      evaluatorErrors: 9,
    });
    // Neither must another workspace's.
    await repo.recordAnalysisRun(beta, {
      ...base,
      clientId: betaClient.clientId,
      outcome: "findings",
      surfaced: 5,
      trigger: "scheduled",
      newCount: 5,
      resolvedCount: 5,
      evaluatorCalls: 5,
      evaluatorRejections: 5,
      evaluatorErrors: 5,
    });

    const health = await monitoring.scheduledRunHealth(alpha, {
      since: new Date(NOW.getTime() - 1000).toISOString(),
    });
    expect(health).toEqual({
      runs: 2,
      findings: 1,
      clean: 0,
      inconclusive: 1,
      newFindings: 2,
      resolvedFindings: 1,
      evaluatorCalls: 4,
      evaluatorRejections: 2,
      evaluatorErrors: 1,
    });
  });

  it("reports zeroes rather than nulls for a workspace that has never been scanned", async () => {
    const health = await monitoring.scheduledRunHealth(beta, { since: NOW.toISOString() });
    expect(health.runs).toBe(0);
    expect(health.evaluatorErrors).toBe(0);
    expect(health.newFindings).toBe(0);
  });
});
