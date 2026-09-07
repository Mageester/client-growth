import { describe, expect, it } from "vitest";

import {
  acceptedOrLater,
  closeRate,
  funnelMetrics,
  pitchedOrLater,
} from "@/core/salesFunnel";
import { OpportunitySchema, type Opportunity, type RuleId } from "@/core/schema";

/**
 * Funnel measurement semantics.
 *
 * The one number this module must never get wrong: a close rate counts what
 * the CLIENT decided. A dismissal is the agency declining to sell — it is not
 * a client loss and must never appear in a close-rate denominator. Legacy rows
 * whose intermediate milestones were never recorded stay unknown; unknown is
 * never read as happened.
 */

let seq = 0;
function opp(input: {
  ruleId?: RuleId;
  status: Opportunity["status"];
  acceptedAt?: string;
  proposalPreparedAt?: string;
  pitchedAt?: string;
  lostAt?: string;
  soldAmount?: number;
}): Opportunity {
  seq += 1;
  return OpportunitySchema.parse({
    id: `opp_${seq}`,
    dedupeKey: `key_${seq}`,
    clientId: "cli_1",
    ruleId: input.ruleId ?? "missing-service-page",
    title: `finding ${seq}`,
    detected: "d",
    rationale: "r",
    suggestedServiceId: "svc_1",
    priceMin: 100,
    priceMax: 1000,
    confidence: 0.7,
    billableStatus: "billable",
    status: input.status,
    ...(input.acceptedAt === undefined ? {} : { acceptedAt: input.acceptedAt }),
    ...(input.proposalPreparedAt === undefined ? {} : { proposalPreparedAt: input.proposalPreparedAt }),
    ...(input.pitchedAt === undefined ? {} : { pitchedAt: input.pitchedAt }),
    ...(input.lostAt === undefined ? {} : { lostAt: input.lostAt }),
    ...(input.soldAmount === undefined ? {} : { soldAmount: input.soldAmount }),
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
}

describe("funnel stage classification", () => {
  it("treats milestone presence as the stage evidence, not just status", () => {
    // A legacy sold row with no pitchedAt is known-sold but unknown-pitched:
    // it counts as sold without claiming the intermediate milestone happened.
    expect(acceptedOrLater(opp({ status: "sold" }))).toBe(true);
    expect(pitchedOrLater(opp({ status: "sold" }))).toBe(false);
    expect(pitchedOrLater(opp({ status: "sold", pitchedAt: "2026-09-01T00:00:00.000Z" }))).toBe(
      true,
    );
  });

  it("counts every accepted-or-later stage once", () => {
    for (const status of [
      "accepted",
      "proposal_prepared",
      "pitched",
      "sold",
      "lost",
    ] as const) {
      expect(acceptedOrLater(opp({ status }))).toBe(true);
    }
    for (const status of ["new", "dismissed", "snoozed", "resolved", "superseded", "already_covered"] as const) {
      expect(acceptedOrLater(opp({ status }))).toBe(false);
    }
  });

  it("counts pitched, sold and lost as pitched-or-later", () => {
    for (const status of ["pitched", "sold", "lost"] as const) {
      expect(pitchedOrLater(opp({ status, pitchedAt: "2026-09-01T00:00:00.000Z" }))).toBe(true);
    }
    // status alone without the milestone is a legacy unknown, not a claim.
    expect(pitchedOrLater(opp({ status: "pitched" }))).toBe(true);
  });
});

describe("close rate", () => {
  it("is sold / (sold + lost) and never includes dismissed", () => {
    const rows = [
      opp({ status: "sold", pitchedAt: "2026-09-01T00:00:00.000Z" }),
      opp({ status: "sold", pitchedAt: "2026-09-01T00:00:00.000Z" }),
      opp({ status: "lost", pitchedAt: "2026-09-01T00:00:00.000Z" }),
      // Two internal rejections: irrelevant to the close rate.
      opp({ status: "dismissed" }),
      opp({ status: "dismissed" }),
      // Still in the pipeline: not decided by the client yet.
      opp({ status: "new" }),
      opp({ status: "accepted" }),
    ];
    expect(closeRate(rows)).toBeCloseTo(2 / 3);
  });

  it("returns null when the client has decided nothing, never zero", () => {
    expect(closeRate([opp({ status: "dismissed" }), opp({ status: "new" })])).toBeNull();
    expect(closeRate([])).toBeNull();
  });

  it("does not fabricate a denominator from legacy rows with unknown stages", () => {
    // A legacy lost row without pitchedAt still counts as a client loss for
    // the rate — status is trustworthy even when the intermediate milestone
    // was never recorded. But nothing is *invented* to widen the denominator.
    const rows = [
      opp({ status: "lost" }),
      opp({ status: "sold", soldAmount: 900 }),
    ];
    expect(closeRate(rows)).toBeCloseTo(1 / 2);
  });
});

describe("funnelMetrics", () => {
  it("reports the three funnel rates without pretending legacy history", () => {
    const rows = [
      opp({ status: "new" }),
      opp({ status: "accepted", acceptedAt: "2026-09-01T00:00:00.000Z" }),
      opp({ status: "proposal_prepared", acceptedAt: "2026-09-01T00:00:00.000Z" }),
      opp({ status: "pitched", acceptedAt: "2026-09-01T00:00:00.000Z", pitchedAt: "2026-09-02T00:00:00.000Z" }),
      opp({ status: "sold", acceptedAt: "2026-09-01T00:00:00.000Z", pitchedAt: "2026-09-02T00:00:00.000Z", soldAmount: 1800 }),
      opp({ status: "lost", acceptedAt: "2026-09-01T00:00:00.000Z", pitchedAt: "2026-09-02T00:00:00.000Z", lostAt: "2026-09-03T00:00:00.000Z" }),
      opp({ status: "dismissed" }),
      // Legacy pre-funnel row: sold, milestones unknown.
      opp({ status: "sold" }),
    ];
    const metrics = funnelMetrics(rows);

    // surfaced = everything except pre-funnel operational noise is NOT the
    // denominator; acceptance is measured against tracked opportunities
    // (dismissed + accepted-or-later + new = all surfaced rows).
    expect(metrics.acceptanceRate).toBeCloseTo(6 / 8);
    // pitched-or-later over accepted-or-later: the legacy sold row is counted
    // as accepted-or-later but NOT as pitched (its milestone is unknown), so
    // it must not inflate the pitch numerator.
    expect(metrics.pitchRate).toBeCloseTo(3 / 6);
    expect(metrics.closeRate).toBeCloseTo(2 / 3);
  });
});
