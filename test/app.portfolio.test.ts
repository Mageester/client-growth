import { describe, expect, it } from "vitest";

import {
  byPotentialValue,
  clientState,
  isOpen,
  nextAction,
  statusBadge,
  sumTotals,
  totalsFor,
} from "../app/lib/portfolio";
import type { Opportunity } from "@/core/schema";

function opp(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "o1",
    dedupeKey: "k1",
    clientId: "c1",
    ruleId: "missing-service-page",
    title: "No page for X",
    detected: "detected",
    evidenceRefs: [],
    rationale: "why",
    suggestedServiceId: "s1",
    suggestedScope: [],
    priceMin: 900,
    priceMax: 1800,
    confidence: 0.8,
    billableStatus: "billable",
    status: "new",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

describe("open predicate", () => {
  it("counts new and proposal_prepared billable work as open", () => {
    expect(isOpen(opp())).toBe(true);
    expect(isOpen(opp({ status: "proposal_prepared" }))).toBe(true);
  });

  it("excludes every decided or covered state", () => {
    expect(isOpen(opp({ status: "dismissed" }))).toBe(false);
    expect(isOpen(opp({ status: "snoozed" }))).toBe(false);
    expect(isOpen(opp({ status: "already_covered" }))).toBe(false);
    expect(isOpen(opp({ billableStatus: "already_covered" }))).toBe(false);
  });

  it("excludes covered work even while its status still says new", () => {
    expect(isOpen(opp({ billableStatus: "already_covered", status: "new" }))).toBe(false);
  });

  it("returns an expired snooze to the open portfolio", () => {
    const now = new Date("2026-09-01T12:00:00.000Z");
    const expired = opp({
      status: "snoozed",
      snoozeUntil: "2026-09-01T11:59:59.000Z",
    });

    expect(isOpen(expired, now)).toBe(true);
    expect(totalsFor([expired], now)).toEqual({
      open: 1,
      closed: 0,
      priceMin: 900,
      priceMax: 1800,
    });
    expect(statusBadge(expired, now)).toEqual({ label: "Open", tone: "accent" });
    expect(nextAction(expired, now)).toMatch(/review the evidence/i);
  });

  it("remains safe to use as an Array filter predicate", () => {
    const expired = opp({ status: "snoozed", snoozeUntil: "2000-01-01T00:00:00.000Z" });

    expect([expired].filter(isOpen)).toEqual([expired]);
  });
});

describe("portfolio totals", () => {
  it("never includes closed findings in potential value", () => {
    const totals = totalsFor([
      opp({ id: "a", priceMin: 900, priceMax: 1800 }),
      opp({ id: "b", priceMin: 300, priceMax: 900, status: "dismissed" }),
      opp({ id: "c", priceMin: 500, priceMax: 700, status: "snoozed" }),
      opp({ id: "d", priceMin: 100, priceMax: 200, billableStatus: "already_covered" }),
    ]);
    expect(totals.open).toBe(1);
    expect(totals.closed).toBe(3);
    expect(totals.priceMin).toBe(900);
    expect(totals.priceMax).toBe(1800);
  });

  it("sums across clients without double counting", () => {
    const a = totalsFor([opp({ priceMin: 100, priceMax: 200 })]);
    const b = totalsFor([opp({ priceMin: 300, priceMax: 400 }), opp({ status: "dismissed" })]);
    expect(sumTotals([a, b])).toEqual({ open: 2, closed: 1, priceMin: 400, priceMax: 600 });
  });

  it("reports zeros for an empty client rather than NaN", () => {
    expect(totalsFor([])).toEqual({ open: 0, closed: 0, priceMin: 0, priceMax: 0 });
  });
});

describe("client state", () => {
  it("is never analyzed when there is no run", () => {
    expect(clientState({ outcome: null, openCount: 0 })).toBe("never");
  });

  it("distinguishes an unreadable site from a clean one", () => {
    expect(clientState({ outcome: "inconclusive", openCount: 0 })).toBe("inconclusive");
    expect(clientState({ outcome: "clean", openCount: 0 })).toBe("clean");
  });

  it("needs attention whenever open work exists", () => {
    expect(clientState({ outcome: "findings", openCount: 2 })).toBe("attention");
    expect(clientState({ outcome: "clean", openCount: 1 })).toBe("attention");
  });

  it("does not report a client with no findings and a failed crawl as clean", () => {
    expect(clientState({ outcome: "inconclusive", openCount: 0 })).not.toBe("clean");
  });
});

describe("status vocabulary", () => {
  it("prefers coverage over any other status, because coverage is not sellable", () => {
    expect(statusBadge(opp({ billableStatus: "already_covered", status: "proposal_prepared" })).label).toBe(
      "Already covered",
    );
  });

  it("labels each decided state distinctly", () => {
    expect(statusBadge(opp()).label).toBe("Open");
    expect(statusBadge(opp({ status: "proposal_prepared" })).label).toBe("Proposal ready");
    expect(statusBadge(opp({ status: "dismissed" })).label).toBe("Dismissed");
    expect(statusBadge(opp({ status: "snoozed" })).label).toBe("Snoozed");
  });
});

describe("next action", () => {
  it("tells an agency what to do for every state", () => {
    expect(nextAction(opp())).toMatch(/prepare a proposal/i);
    expect(nextAction(opp({ status: "proposal_prepared" }))).toMatch(/send the draft/i);
    expect(nextAction(opp({ status: "dismissed" }))).toMatch(/reopen/i);
    expect(nextAction(opp({ status: "snoozed" }))).toMatch(/snooze ends/i);
    expect(nextAction(opp({ billableStatus: "already_covered" }))).toMatch(/contract/i);
  });
});

describe("ranking", () => {
  it("orders by value, then confidence, then title so the order is stable", () => {
    const rows = [
      opp({ id: "a", title: "B", priceMax: 900, confidence: 0.9 }),
      opp({ id: "b", title: "A", priceMax: 1800, confidence: 0.6 }),
      opp({ id: "c", title: "C", priceMax: 1800, confidence: 0.9 }),
      opp({ id: "d", title: "A", priceMax: 900, confidence: 0.9 }),
    ];
    expect([...rows].sort(byPotentialValue).map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
  });
});
