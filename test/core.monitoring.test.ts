import { describe, expect, it } from "vitest";

import {
  CADENCE_INTERVAL_MS,
  MONITORING_FAILURE_BACKOFF_MS,
  MONITORING_MAX_ACCELERATED_RETRIES,
  MONITORING_OFF,
  changeHeadline,
  hasMeaningfulChange,
  isClaimed,
  isDue,
  isMonitoringCadence,
  nextDueAfterRun,
  stateForCadenceChange,
  type MonitoringState,
} from "@/core/monitoring";

const NOW = new Date("2026-09-02T12:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

function state(overrides: Partial<MonitoringState> = {}): MonitoringState {
  return { ...MONITORING_OFF, cadence: "weekly", ...overrides };
}

describe("monitoring cadence", () => {
  it("only accepts the cadences the model defines", () => {
    expect(isMonitoringCadence("weekly")).toBe(true);
    expect(isMonitoringCadence("off")).toBe(true);
    expect(isMonitoringCadence("hourly")).toBe(false);
    expect(isMonitoringCadence(undefined)).toBe(false);
  });

  it("a completed run costs exactly one cadence interval, whatever it concluded", () => {
    for (const outcome of ["findings", "clean", "inconclusive"] as const) {
      expect(
        nextDueAfterRun({ cadence: "weekly", outcome, consecutiveFailures: 0, now: NOW }),
      ).toBe(at(CADENCE_INTERVAL_MS.weekly));
    }
  });

  it("an inconclusive run does not retry sooner than a clean one", () => {
    // The distinction matters: a site the crawl cannot read is usually still
    // unreadable an hour later, and re-reading it costs the same as any scan.
    const inconclusive = nextDueAfterRun({
      cadence: "weekly",
      outcome: "inconclusive",
      consecutiveFailures: 0,
      now: NOW,
    });
    const clean = nextDueAfterRun({
      cadence: "weekly",
      outcome: "clean",
      consecutiveFailures: 0,
      now: NOW,
    });
    expect(inconclusive).toBe(clean);
  });

  it("backs a failed run off on a bounded, increasing schedule", () => {
    const delays = [1, 2, 3].map((failures) =>
      nextDueAfterRun({
        cadence: "weekly",
        outcome: "failed",
        consecutiveFailures: failures,
        now: NOW,
      }),
    );
    expect(delays).toEqual(MONITORING_FAILURE_BACKOFF_MS.map((ms) => at(ms)));

    // Strictly increasing: no tight loop is reachable.
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]! > delays[i - 1]!).toBe(true);
    }
  });

  it("stops accelerating after the retry budget and falls back to the cadence", () => {
    const beyond = nextDueAfterRun({
      cadence: "weekly",
      outcome: "failed",
      consecutiveFailures: MONITORING_MAX_ACCELERATED_RETRIES + 1,
      now: NOW,
    });
    expect(beyond).toBe(at(CADENCE_INTERVAL_MS.weekly));
  });

  it("never schedules a retry further out than the cadence itself", () => {
    // Daily's interval is shorter than the last backoff step, so the backoff has
    // to clamp rather than silently stretching a daily client to two days.
    const daily = nextDueAfterRun({
      cadence: "daily",
      outcome: "failed",
      consecutiveFailures: 3,
      now: NOW,
    });
    expect(daily).toBe(at(CADENCE_INTERVAL_MS.daily));
  });

  it("schedules nothing at all when monitoring is off", () => {
    expect(
      nextDueAfterRun({ cadence: "off", outcome: "clean", consecutiveFailures: 0, now: NOW }),
    ).toBeNull();
  });
});

describe("turning monitoring on and off", () => {
  it("enabling a never-analyzed client makes it due immediately", () => {
    const next = stateForCadenceChange({
      current: MONITORING_OFF,
      cadence: "weekly",
      lastAnalyzedAt: null,
      now: NOW,
    });
    expect(next.cadence).toBe("weekly");
    expect(next.nextDueAt).toBe(NOW.toISOString());
    expect(isDue(next, NOW)).toBe(true);
  });

  it("enabling right after an analysis does not spend another run", () => {
    // Otherwise "analyze, then switch monitoring on" quietly costs two scans.
    const next = stateForCadenceChange({
      current: MONITORING_OFF,
      cadence: "weekly",
      lastAnalyzedAt: at(-60_000),
      now: NOW,
    });
    expect(isDue(next, NOW)).toBe(false);
    expect(next.nextDueAt).toBe(at(CADENCE_INTERVAL_MS.weekly - 60_000));
  });

  it("enabling a long-neglected client is due now, not one interval from now", () => {
    const next = stateForCadenceChange({
      current: MONITORING_OFF,
      cadence: "weekly",
      lastAnalyzedAt: at(-30 * 24 * 60 * 60 * 1000),
      now: NOW,
    });
    expect(next.nextDueAt).toBe(NOW.toISOString());
  });

  it("turning monitoring off clears the schedule and any claim", () => {
    const next = stateForCadenceChange({
      current: state({ nextDueAt: at(-1000), claimedAt: at(-1000) }),
      cadence: "off",
      lastAnalyzedAt: null,
      now: NOW,
    });
    expect(next.nextDueAt).toBeNull();
    expect(next.claimedAt).toBeNull();
    expect(isDue(next, NOW)).toBe(false);
  });

  it("changing cadence clears an inherited failure backoff", () => {
    const next = stateForCadenceChange({
      current: state({ consecutiveFailures: 3, lastOutcome: "failed" }),
      cadence: "weekly",
      lastAnalyzedAt: null,
      now: NOW,
    });
    expect(next.consecutiveFailures).toBe(0);
  });

  it("survives a corrupt stored timestamp instead of scheduling into NaN", () => {
    const next = stateForCadenceChange({
      current: MONITORING_OFF,
      cadence: "weekly",
      lastAnalyzedAt: "not-a-date",
      now: NOW,
    });
    expect(next.nextDueAt).toBe(NOW.toISOString());
  });
});

describe("due and claimed", () => {
  it("is not due before its time, off, or unscheduled", () => {
    expect(isDue(state({ nextDueAt: at(1000) }), NOW)).toBe(false);
    expect(isDue(state({ cadence: "off", nextDueAt: at(-1000) }), NOW)).toBe(false);
    expect(isDue(state({ nextDueAt: null }), NOW)).toBe(false);
  });

  it("a live claim withholds a client that is otherwise due", () => {
    const claimed = state({ nextDueAt: at(-1000), claimedAt: at(-60_000) });
    expect(isClaimed(claimed, NOW)).toBe(true);
    expect(isDue(claimed, NOW)).toBe(false);
  });

  it("an abandoned claim is reclaimable, so an interrupted run cannot strand a client", () => {
    const stranded = state({ nextDueAt: at(-1000), claimedAt: at(-60 * 60 * 1000) });
    expect(isClaimed(stranded, NOW)).toBe(false);
    expect(isDue(stranded, NOW)).toBe(true);
  });
});

describe("change vocabulary", () => {
  it("says nothing is new when nothing is new", () => {
    expect(changeHeadline("clean", { newCount: 0, stillOpenCount: 0, resolvedCount: 0 })).toBe(
      "No new opportunities.",
    );
    expect(changeHeadline("findings", { newCount: 0, stillOpenCount: 3, resolvedCount: 0 })).toBe(
      "No new opportunities — everything open is unchanged.",
    );
  });

  it("reports new and fixed separately", () => {
    expect(changeHeadline("findings", { newCount: 2, stillOpenCount: 1, resolvedCount: 1 })).toBe(
      "2 new since last scan · 1 fixed since last scan",
    );
  });

  it("never reports a run that could not look as a result", () => {
    expect(
      changeHeadline("inconclusive", { newCount: 0, stillOpenCount: 4, resolvedCount: 0 }),
    ).toBe("Monitoring couldn't fully analyze this site.");
    expect(changeHeadline("failed", { newCount: 0, stillOpenCount: 0, resolvedCount: 0 })).toBe(
      "This check could not be completed.",
    );
  });

  it("counts only new and fixed as worth telling someone about", () => {
    expect(hasMeaningfulChange({ newCount: 0, stillOpenCount: 9, resolvedCount: 0 })).toBe(false);
    expect(hasMeaningfulChange({ newCount: 1, stillOpenCount: 0, resolvedCount: 0 })).toBe(true);
    expect(hasMeaningfulChange({ newCount: 0, stillOpenCount: 0, resolvedCount: 1 })).toBe(true);
  });
});
