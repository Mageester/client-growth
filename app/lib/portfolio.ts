import type { Opportunity } from "@/core/schema";
import type { AnalysisOutcome } from "@/core/analysisOutcome";

/**
 * One shared definition of "what state is this client in" and "what is open".
 *
 * Every surface (feed, client list, client detail, opportunity detail) derives
 * its counts and totals from these helpers. Previously each route re-implemented
 * the open/closed predicate inline, which is exactly how two pages end up
 * disagreeing about the same client.
 */

/** Open = the agency can still sell this, and has not decided otherwise. */
export function isOpen(opp: Opportunity, now: Date | number = new Date()): boolean {
  // `isOpen` is also used directly as an Array.filter predicate, whose second
  // argument is the numeric index rather than an injected clock.
  const clock = now instanceof Date ? now : new Date();
  return (
    opp.billableStatus === "billable" &&
    (opp.status === "new" || opp.status === "proposal_prepared" || isSnoozeExpired(opp, clock))
  );
}

export function isSnoozeExpired(opp: Opportunity, now: Date): boolean {
  return (
    opp.status === "snoozed" && Boolean(opp.snoozeUntil) && opp.snoozeUntil! <= now.toISOString()
  );
}

export type ClientState =
  | "attention" // analyzed, open billable work waiting
  | "clean" // analyzed successfully, nothing to sell right now
  | "inconclusive" // the site could not be read well enough to claim anything
  | "never"; // no analysis has been run

export const CLIENT_STATE_ORDER: Record<ClientState, number> = {
  attention: 0,
  inconclusive: 1,
  never: 2,
  clean: 3,
};

export const CLIENT_STATE_LABEL: Record<ClientState, string> = {
  attention: "Needs attention",
  clean: "Clean",
  inconclusive: "Could not analyze",
  never: "Not analyzed",
};

/**
 * The client's state.
 *
 * Note the ordering: a failed or incomplete run never reads as "clean". If the
 * crawl could not reach the site we say so, because the crawler fails closed and
 * absence of findings there is absence of evidence, not evidence of absence.
 */
export function clientState(input: {
  outcome: AnalysisOutcome | null;
  openCount: number;
}): ClientState {
  if (input.openCount > 0) return "attention";
  if (input.outcome === null) return "never";
  if (input.outcome === "inconclusive") return "inconclusive";
  return "clean";
}

export interface PortfolioTotals {
  open: number;
  closed: number;
  priceMin: number;
  priceMax: number;
}

/** Totals over open work only — closed findings never inflate pipeline value. */
export function totalsFor(opportunities: Opportunity[], now = new Date()): PortfolioTotals {
  let open = 0;
  let closed = 0;
  let priceMin = 0;
  let priceMax = 0;
  for (const opp of opportunities) {
    if (isOpen(opp, now)) {
      open++;
      priceMin += opp.priceMin;
      priceMax += opp.priceMax;
    } else {
      closed++;
    }
  }
  return { open, closed, priceMin, priceMax };
}

export function sumTotals(all: PortfolioTotals[]): PortfolioTotals {
  return all.reduce<PortfolioTotals>(
    (acc, t) => ({
      open: acc.open + t.open,
      closed: acc.closed + t.closed,
      priceMin: acc.priceMin + t.priceMin,
      priceMax: acc.priceMax + t.priceMax,
    }),
    { open: 0, closed: 0, priceMin: 0, priceMax: 0 },
  );
}

/** Highest-value, most-confident first. Stable for equal entries. */
export function byPotentialValue(a: Opportunity, b: Opportunity): number {
  return (
    b.priceMax - a.priceMax ||
    b.confidence - a.confidence ||
    a.title.localeCompare(b.title)
  );
}

export interface StatusBadge {
  label: string;
  tone: "" | "pos" | "warn" | "quiet" | "accent";
}

/** The single status vocabulary shown to the user, everywhere. */
export function statusBadge(opp: Opportunity, now = new Date()): StatusBadge {
  if (opp.billableStatus === "already_covered" || opp.status === "already_covered") {
    return { label: "Already covered", tone: "warn" };
  }
  if (isSnoozeExpired(opp, now)) return { label: "Open", tone: "accent" };
  // Distinct from "Fixed by the client": one is a win, the other is the client
  // doing it themselves. Collapsing them would erase the only outcome the
  // product measures.
  if (opp.status === "sold") return { label: "Sold", tone: "pos" };
  if (opp.status === "resolved") return { label: "Fixed by the client", tone: "pos" };
  if (opp.status === "superseded") return { label: "Superseded", tone: "quiet" };
  if (opp.status === "dismissed") return { label: "Dismissed", tone: "quiet" };
  if (opp.status === "snoozed") return { label: "Snoozed", tone: "quiet" };
  if (opp.status === "proposal_prepared") return { label: "Proposal ready", tone: "pos" };
  return { label: "Open", tone: "accent" };
}

/** What the agency should do next with this finding. */
export function nextAction(opp: Opportunity, now = new Date()): string {
  if (!isOpen(opp, now)) {
    if (opp.status === "resolved") {
      return "No longer on the site — re-analysis confirmed it was fixed";
    }
    if (opp.status === "superseded") {
      return "Superseded by the canonical site-level finding";
    }
    if (opp.status === "dismissed") return "Reopen if this becomes relevant again";
    if (opp.status === "snoozed") return "Returns to the feed when the snooze ends";
    return "Already covered by this client's contract";
  }
  if (opp.status === "proposal_prepared") return "Send the draft to the client";
  return "Review the evidence, then prepare a proposal";
}
