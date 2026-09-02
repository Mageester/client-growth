/**
 * Recurring monitoring policy — pure, clock-injected, no I/O.
 *
 * Monitoring is the product's only source of *unattended* spend, so every rule
 * that decides "does this client get scanned, and when is it scanned again"
 * lives here where it can be tested exhaustively without a network, a database
 * or a scheduler.
 *
 * Two deliberate constraints shape this module:
 *
 *   1. Monitoring is opt-in. `off` is the default for every client, existing and
 *      new, and nothing in the scheduler can enable it. Only a person can.
 *   2. A monitored client costs at most one scan per cadence, plus a bounded
 *      number of accelerated retries after an infrastructure failure. There is
 *      no path through this file that produces an unbounded retry loop.
 */

// ---------------------------------------------------------------------------
// cadence
// ---------------------------------------------------------------------------

/**
 * V1 cadences. `daily` exists in the model and the scheduler because it costs
 * nothing to support, but the product only offers Off and Weekly — a cadence
 * editor is not what makes recurring monitoring valuable.
 */
export const MONITORING_CADENCES = ["off", "daily", "weekly"] as const;
export type MonitoringCadence = (typeof MONITORING_CADENCES)[number];

export function isMonitoringCadence(value: unknown): value is MonitoringCadence {
  return (MONITORING_CADENCES as readonly unknown[]).includes(value);
}

/** The cadences a person can actually pick in the product. */
export const SELECTABLE_CADENCES = ["off", "weekly"] as const;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const CADENCE_INTERVAL_MS: Record<MonitoringCadence, number> = {
  off: 0,
  daily: DAY,
  weekly: 7 * DAY,
};

export const CADENCE_LABEL: Record<MonitoringCadence, string> = {
  off: "Off",
  daily: "Daily",
  weekly: "Weekly",
};

// ---------------------------------------------------------------------------
// cost controls
// ---------------------------------------------------------------------------

/**
 * Ceiling on clients analyzed by ONE scheduled invocation. The scheduler runs
 * hourly, so this is also the portfolio's scanning throughput: 5 clients/hour =
 * 120/day, comfortably above what a weekly cadence needs for a few hundred
 * clients while capping the cost of any single bad tick.
 *
 * `MAX_AI_CALLS_PER_RUN` still applies inside each client's analysis, so the
 * absolute evaluator ceiling for one invocation is this times that.
 */
export const MONITORING_MAX_CLIENTS_PER_RUN = 5;

/**
 * Wall-clock budget for one invocation. Checked between clients — never mid
 * client — so a scan is either completed and recorded, or never started.
 * Remaining due clients are picked up by the next tick.
 */
export const MONITORING_INVOCATION_BUDGET_MS = 5 * 60 * 1000;

/**
 * How long a claim on a client is honoured. A Worker evicted mid-scan leaves
 * its claim behind; after this the client is reclaimable, so an interrupted run
 * cannot strand a client forever. Comfortably longer than the invocation budget
 * so a live scan is never stolen.
 */
export const MONITORING_CLAIM_TTL_MS = 30 * 60 * 1000;

/**
 * Accelerated retries after an infrastructure failure (the scan threw: crawl
 * error, database write failure). Bounded on purpose — after this many
 * consecutive failures the client falls back to its normal cadence, so a
 * permanently broken site costs one scan per cadence like any other.
 */
export const MONITORING_FAILURE_BACKOFF_MS = [HOUR, 6 * HOUR, DAY] as const;
export const MONITORING_MAX_ACCELERATED_RETRIES = MONITORING_FAILURE_BACKOFF_MS.length;

// ---------------------------------------------------------------------------
// per-client monitoring state
// ---------------------------------------------------------------------------

/**
 * Outcomes monitoring records. The first three mirror an analysis run's own
 * classification; `failed` means the run did not complete at all, which is a
 * different fact from "it completed and could not conclude".
 */
export const MONITORING_OUTCOMES = ["findings", "clean", "inconclusive", "failed"] as const;
export type MonitoringOutcome = (typeof MONITORING_OUTCOMES)[number];

export function isMonitoringOutcome(value: unknown): value is MonitoringOutcome {
  return (MONITORING_OUTCOMES as readonly unknown[]).includes(value);
}

export interface MonitoringState {
  cadence: MonitoringCadence;
  /** When the next scheduled scan becomes eligible. Null whenever cadence is off. */
  nextDueAt: string | null;
  /** Start of the most recent scheduled attempt, successful or not. */
  lastAttemptAt: string | null;
  /** Completion of the most recent scheduled scan that reached a verdict. */
  lastSuccessAt: string | null;
  lastOutcome: MonitoringOutcome | null;
  /** Reset to 0 by any completed scan. Only `failed` increments it. */
  consecutiveFailures: number;
  /** Set while a scheduled scan holds this client. Null otherwise. */
  claimedAt: string | null;
}

export const MONITORING_OFF: MonitoringState = {
  cadence: "off",
  nextDueAt: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastOutcome: null,
  consecutiveFailures: 0,
  claimedAt: null,
};

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * When the next scan is due after a completed attempt.
 *
 * A completed scan — whatever it concluded — costs the client one full cadence
 * interval. Only a `failed` scan retries sooner, for a bounded number of
 * attempts, and never further out than the cadence itself.
 */
export function nextDueAfterRun(input: {
  cadence: MonitoringCadence;
  outcome: MonitoringOutcome;
  /** Consecutive failures INCLUDING this run. */
  consecutiveFailures: number;
  now: Date;
}): string | null {
  if (input.cadence === "off") return null;
  const interval = CADENCE_INTERVAL_MS[input.cadence];

  if (
    input.outcome !== "failed" ||
    input.consecutiveFailures > MONITORING_MAX_ACCELERATED_RETRIES
  ) {
    return iso(input.now.getTime() + interval);
  }

  const step = Math.max(1, input.consecutiveFailures) - 1;
  const backoff = MONITORING_FAILURE_BACKOFF_MS[step] ?? interval;
  // A retry is never scheduled further out than the cadence the agency chose.
  return iso(input.now.getTime() + Math.min(backoff, interval));
}

/**
 * The state produced by turning monitoring on or off, or changing cadence.
 *
 * Enabling does not force an immediate re-scan of a client analyzed moments
 * ago: the first scheduled scan lands one full interval after the last
 * successful analysis, or right away if that is already in the past. This keeps
 * "enable monitoring" from being a hidden way to spend a run.
 */
export function stateForCadenceChange(input: {
  current: MonitoringState;
  cadence: MonitoringCadence;
  /** Most recent completed analysis of this client, scheduled or manual. */
  lastAnalyzedAt: string | null;
  now: Date;
}): MonitoringState {
  if (input.cadence === "off") {
    return { ...input.current, cadence: "off", nextDueAt: null, claimedAt: null };
  }

  const interval = CADENCE_INTERVAL_MS[input.cadence];
  const earliest = input.lastAnalyzedAt
    ? Date.parse(input.lastAnalyzedAt) + interval
    : input.now.getTime();
  const due = Number.isFinite(earliest)
    ? Math.max(input.now.getTime(), earliest)
    : input.now.getTime();

  return {
    ...input.current,
    cadence: input.cadence,
    nextDueAt: iso(due),
    // A cadence change is a fresh start: it must not inherit a backoff.
    consecutiveFailures: 0,
    claimedAt: null,
  };
}

/** Is another invocation currently holding this client? */
export function isClaimed(state: MonitoringState, now: Date): boolean {
  if (!state.claimedAt) return false;
  const claimed = Date.parse(state.claimedAt);
  if (!Number.isFinite(claimed)) return false;
  return claimed > now.getTime() - MONITORING_CLAIM_TTL_MS;
}

/** Is this client eligible for a scheduled scan right now? */
export function isDue(state: MonitoringState, now: Date): boolean {
  if (state.cadence === "off") return false;
  if (!state.nextDueAt) return false;
  if (state.nextDueAt > now.toISOString()) return false;
  return !isClaimed(state, now);
}

// ---------------------------------------------------------------------------
// change detection vocabulary
// ---------------------------------------------------------------------------

export interface MonitoringChange {
  /** Findings this run surfaced that were not already open for the client. */
  newCount: number;
  /** Findings that were already open and are still there. */
  stillOpenCount: number;
  /** Previously open findings this run confirmed are gone. */
  resolvedCount: number;
}

export const NO_CHANGE: MonitoringChange = {
  newCount: 0,
  stillOpenCount: 0,
  resolvedCount: 0,
};

export function hasMeaningfulChange(change: MonitoringChange): boolean {
  return change.newCount > 0 || change.resolvedCount > 0;
}

/**
 * One plain sentence describing what a scan changed, in the agency's language.
 * Never mentions a provider, a rule id or a crawl mechanism.
 */
export function changeHeadline(outcome: MonitoringOutcome, change: MonitoringChange): string {
  if (outcome === "failed") return "This check could not be completed.";
  if (outcome === "inconclusive") return "Monitoring couldn't fully analyze this site.";

  const parts: string[] = [];
  if (change.newCount > 0) parts.push(`${change.newCount} new since last scan`);
  if (change.resolvedCount > 0) parts.push(`${change.resolvedCount} fixed since last scan`);
  if (parts.length > 0) return parts.join(" · ");

  return change.stillOpenCount > 0
    ? "No new opportunities — everything open is unchanged."
    : "No new opportunities.";
}
