import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as monitoring from "@/db/monitoring";
import * as repo from "@/db/repositories";
import { isOpen } from "../app/lib/portfolio";
import { runMonitoringTick } from "../app/lib/monitoring.server";
import {
  buildPortfolio,
  portfolioFetch,
  setMonitoringDirect,
  type FixtureClient,
  type Portfolio,
} from "./helpers/portfolio";

/**
 * Recurring monitoring against a realistic portfolio, end to end.
 *
 * Unlike monitoring.scheduler.test.ts, nothing is injected here: this drives the
 * real scheduler into the real analysis pipeline, real rules, real dedupe and
 * resolution, and real persistence. The only substitution is `fetch`, which
 * serves deterministic sites from the fixture — so the suite stays offline and
 * free while still proving that a scheduled scan behaves like a manual one.
 *
 * 3 workspaces x 12 clients = 36 clients, with a deterministic mix of monitoring
 * off / due / not-yet-due and of clean / opportunity / unreachable sites.
 */

const NOW = new Date("2026-09-02T12:00:00.000Z");
const ENV = { AI_PROVIDER: "mock", MAX_AI_CALLS_PER_RUN: "10" };
const BATCH = 5;

let portfolio: Portfolio;

beforeEach(async () => {
  portfolio = await buildPortfolio({ workspaces: 3, perWorkspace: 12, now: NOW });
  vi.stubGlobal("fetch", portfolioFetch(portfolio.clients));
});

afterEach(() => {
  portfolio.close();
  vi.unstubAllGlobals();
});

const monitored = () => portfolio.clients.filter((c) => c.cadence !== "off");
const due = () => monitored().filter((c) => (c.dueOffsetMs ?? 0) < 0);
const notDue = () => monitored().filter((c) => (c.dueOffsetMs ?? 0) > 0);
const unmonitored = () => portfolio.clients.filter((c) => c.cadence === "off");

/** Run ticks until the queue drains, the way an hourly cron eventually would. */
async function drain(limit = BATCH) {
  const ticks = [];
  for (let i = 0; i < 20; i++) {
    const tick = await runMonitoringTick({ db: portfolio.db, env: ENV, now: NOW, limit });
    ticks.push(tick);
    if (tick.considered === 0) break;
  }
  return ticks;
}

const stateOf = (client: FixtureClient) =>
  monitoring.getMonitoring(portfolio.scopeFor(client.workspaceId), client.clientId);
const runsOf = (client: FixtureClient) =>
  repo.listAnalysisRuns(portfolio.scopeFor(client.workspaceId), client.clientId, 20);
const oppsOf = (client: FixtureClient) =>
  repo.listOpportunities(portfolio.scopeFor(client.workspaceId), client.clientId);

describe("a realistic portfolio under recurring monitoring", () => {
  it("has a portfolio worth calling a scale test", () => {
    expect(portfolio.clients).toHaveLength(36);
    expect(portfolio.scopes.size).toBe(3);
    expect(due().length).toBeGreaterThan(8);
    expect(notDue().length).toBeGreaterThan(0);
    expect(unmonitored().length).toBeGreaterThan(0);
    expect(new Set(portfolio.clients.map((c) => c.site)).size).toBe(3);
  });

  it("scans every due monitored client, and nothing else, in bounded batches", async () => {
    const ticks = await drain();

    for (const tick of ticks) expect(tick.considered).toBeLessThanOrEqual(BATCH);
    expect(ticks.length).toBeGreaterThan(1); // it genuinely took several ticks

    for (const client of due()) {
      expect((await runsOf(client)).length, client.clientId).toBe(1);
    }
    for (const client of [...notDue(), ...unmonitored()]) {
      expect((await runsOf(client)).length, client.clientId).toBe(0);
    }
  });

  it("records every scheduled scan as scheduled, so history is trustworthy", async () => {
    await drain();
    for (const client of due()) {
      const runs = await runsOf(client);
      expect(runs[0]!.trigger).toBe("scheduled");
    }
  });

  it("tells clean, findings and unreachable sites apart instead of guessing", async () => {
    await drain();

    for (const client of due()) {
      const run = (await runsOf(client))[0]!;
      const state = await stateOf(client);
      if (client.site === "unreachable") {
        // The core honesty guarantee, under automation: a site that could not be
        // read is never reported as clean.
        expect(run.outcome, client.clientId).toBe("inconclusive");
        expect(run.pagesRead).toBe(0);
        expect(run.summary).not.toMatch(/no unmet billable work/i);
        expect(await oppsOf(client)).toHaveLength(0);
      } else if (client.site === "gap") {
        expect(run.outcome, client.clientId).toBe("findings");
        expect(run.newCount).toBeGreaterThan(0);
        expect((await oppsOf(client)).length).toBeGreaterThan(0);
      } else {
        expect(run.outcome, client.clientId).toBe("clean");
        expect(run.newCount).toBe(0);
      }
      expect(state?.lastOutcome).toBe(run.outcome);
    }
  });

  it("never lets one workspace's monitoring touch another's data", async () => {
    await drain();

    for (const [workspaceId, scope] of portfolio.scopes) {
      const ownIds = new Set(
        portfolio.clients.filter((c) => c.workspaceId === workspaceId).map((c) => c.clientId),
      );
      const opps = await repo.listOpportunitiesByClient(scope);
      for (const clientId of opps.keys()) expect(ownIds.has(clientId)).toBe(true);

      const runs = await repo.latestAnalysisRunByClient(scope);
      for (const clientId of runs.keys()) expect(ownIds.has(clientId)).toBe(true);

      // And a foreign client id resolves to nothing at all through this scope.
      const foreign = portfolio.clients.find((c) => c.workspaceId !== workspaceId)!;
      expect(await repo.getLatestAnalysisRun(scope, foreign.clientId)).toBeNull();
      expect(await monitoring.getMonitoring(scope, foreign.clientId)).toBeNull();
    }
  });

  it("advances the schedule for scanned clients and leaves everyone else alone", async () => {
    await drain();

    for (const client of due()) {
      const state = await stateOf(client);
      expect(state!.nextDueAt! > NOW.toISOString(), client.clientId).toBe(true);
      expect(state!.claimedAt).toBeNull();
    }
    for (const client of notDue()) {
      const state = await stateOf(client);
      expect(state!.lastOutcome, client.clientId).toBeNull();
      expect(state!.nextDueAt).toBe(
        new Date(NOW.getTime() + client.dueOffsetMs!).toISOString(),
      );
    }
    for (const client of unmonitored()) {
      const state = await stateOf(client);
      expect(state!.cadence).toBe("off");
      expect(state!.nextDueAt).toBeNull();
      expect(state!.lastAttemptAt).toBeNull();
    }
  });

  it("spends no evaluator call on a client that is not due", async () => {
    const ticks = await drain();
    const totalCalls = ticks.reduce((sum, tick) => sum + tick.evaluatorCalls, 0);
    // Only the gap sites reach the evaluator at all; clean and unreachable ones
    // never get that far, which is the pipeline's cost-control order at work.
    expect(totalCalls).toBeGreaterThan(0);
    expect(totalCalls).toBeLessThanOrEqual(due().length * 10);

    for (const client of [...notDue(), ...unmonitored()]) {
      expect(await oppsOf(client)).toHaveLength(0);
    }
  });
});

describe("change detection across repeated scans", () => {
  /** A due client whose site has a real, findable gap. */
  const gapClient = () => due().find((c) => c.site === "gap")!;

  /**
   * Make one client due again without touching anything else. Stamped against
   * the test clock, which is the clock `drain()` selects with.
   */
  async function makeDue(client: FixtureClient) {
    await setMonitoringDirect(
      portfolio.db,
      { ...client, cadence: "weekly", dueOffsetMs: -60_000 },
      NOW,
    );
  }

  it("does not re-announce a finding the agency already has open", async () => {
    const client = gapClient();
    await drain();
    const first = (await runsOf(client))[0]!;
    expect(first.newCount).toBeGreaterThan(0);
    const afterFirst = await oppsOf(client);

    await makeDue(client);
    await drain();

    const second = (await runsOf(client))[0]!;
    expect(second.newCount).toBe(0);
    expect(second.resolvedCount).toBe(0);
    expect(second.surfaced).toBe(first.surfaced);

    // Same findings, same rows — a re-scan is not a way to duplicate work.
    const afterSecond = await oppsOf(client);
    expect(afterSecond.map((o) => o.id).sort()).toEqual(afterFirst.map((o) => o.id).sort());
    expect(new Set(afterSecond.map((o) => o.dedupeKey)).size).toBe(afterSecond.length);
  });

  it("resolves a finding once the client has actually fixed it", async () => {
    const client = gapClient();
    await drain();
    expect((await oppsOf(client)).filter((o) => isOpen(o)).length).toBeGreaterThan(0);

    client.site = "clean"; // the client built the missing page
    await makeDue(client);
    await drain();

    const run = (await runsOf(client))[0]!;
    expect(run.resolvedCount).toBeGreaterThan(0);
    expect(run.newCount).toBe(0);

    const opps = await oppsOf(client);
    expect(opps.every((o) => o.status === "resolved")).toBe(true);
    expect(opps.filter((o) => isOpen(o))).toHaveLength(0);
  });

  it("makes a genuinely recurring problem actionable again without forking its history", async () => {
    const client = gapClient();
    await drain();
    const original = await oppsOf(client);

    client.site = "clean";
    await makeDue(client);
    await drain();
    expect((await oppsOf(client)).every((o) => o.status === "resolved")).toBe(true);

    client.site = "gap"; // the page came down again
    await makeDue(client);
    await drain();

    const run = (await runsOf(client))[0]!;
    expect(run.newCount).toBeGreaterThan(0);

    const reopened = await oppsOf(client);
    // Same rows, back to open. Not a second copy with a parallel history.
    expect(reopened).toHaveLength(original.length);
    expect(reopened.map((o) => o.id).sort()).toEqual(original.map((o) => o.id).sort());
    expect(reopened.every((o) => isOpen(o))).toBe(true);
  });

  it("never resolves anything on a scan that could not read the site", async () => {
    // The dangerous failure mode: an outage quietly marking the whole portfolio
    // fixed and the agency's pipeline evaporating.
    const client = gapClient();
    await drain();
    const openBefore = (await oppsOf(client)).filter((o) => isOpen(o));
    expect(openBefore.length).toBeGreaterThan(0);

    client.site = "unreachable";
    await makeDue(client);
    await drain();

    const run = (await runsOf(client))[0]!;
    expect(run.outcome).toBe("inconclusive");
    expect(run.resolvedCount).toBe(0);

    const openAfter = (await oppsOf(client)).filter((o) => isOpen(o));
    expect(openAfter.map((o) => o.id).sort()).toEqual(openBefore.map((o) => o.id).sort());
  });

  it("keeps a per-client history of what each check concluded", async () => {
    const client = gapClient();
    await drain();
    await makeDue(client);
    await drain();

    const runs = await runsOf(client);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.finishedAt >= runs[1]!.finishedAt).toBe(true);
    expect(runs.every((r) => r.trigger === "scheduled")).toBe(true);
  });

  it("reports workspace health from scheduled runs only", async () => {
    await drain();
    const scope = portfolio.scopeFor("ws_a");
    const health = await monitoring.scheduledRunHealth(scope, {
      since: new Date(NOW.getTime() - 60_000).toISOString(),
    });

    const dueHere = due().filter((c) => c.workspaceId === "ws_a");
    expect(health.runs).toBe(dueHere.length);
    expect(health.findings).toBe(dueHere.filter((c) => c.site === "gap").length);
    expect(health.clean).toBe(dueHere.filter((c) => c.site === "clean").length);
    expect(health.inconclusive).toBe(dueHere.filter((c) => c.site === "unreachable").length);
    expect(health.newFindings).toBeGreaterThan(0);
    // The evaluator ran and nothing errored: the two numbers an operator checks.
    expect(health.evaluatorCalls).toBeGreaterThan(0);
    expect(health.evaluatorErrors).toBe(0);
  });
});
