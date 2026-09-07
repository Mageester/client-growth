import { describe, expect, it } from "vitest";

import { byEvidencedValue, computeWinRates, rankingScore } from "@/core/winRates";
import { OpportunitySchema, type Opportunity, type RuleId } from "@/core/schema";

let seq = 0;
function opp(input: {
  ruleId: RuleId;
  status?: Opportunity["status"];
  soldAmount?: number;
  priceMax?: number;
  title?: string;
}): Opportunity {
  seq += 1;
  return OpportunitySchema.parse({
    id: `opp_${seq}`,
    dedupeKey: `key_${seq}`,
    clientId: "cli_1",
    ruleId: input.ruleId,
    title: input.title ?? `finding ${seq}`,
    detected: "2026-09-01T00:00:00.000Z",
    rationale: "because",
    suggestedServiceId: "svc_1",
    priceMin: 100,
    priceMax: input.priceMax ?? 1000,
    confidence: 0.7,
    billableStatus: "billable",
    status: input.status ?? "new",
    ...(input.soldAmount === undefined ? {} : { soldAmount: input.soldAmount }),
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
}

describe("measuring what an agency actually sells", () => {
  it("distinguishes never sold from never tried", () => {
    const rates = computeWinRates([
      opp({ ruleId: "missing-image-alt" }),
      opp({ ruleId: "missing-image-alt" }),
    ]);
    // Two findings, no decision on either: there is nothing to report yet, and
    // reporting 0% would libel a rule nobody has attempted to sell.
    expect(rates.byRule.get("missing-image-alt")).toBeUndefined();
    expect(rates.totalSold).toBe(0);
  });

  it("counts sold against decided client outcomes, ignoring pending work", () => {
    const rates = computeWinRates([
      opp({ ruleId: "missing-service-page", status: "sold", soldAmount: 1800 }),
      opp({ ruleId: "missing-service-page", status: "sold", soldAmount: 1200 }),
      opp({ ruleId: "missing-service-page", status: "lost" }),
      opp({ ruleId: "missing-service-page", status: "new" }),
      opp({ ruleId: "missing-service-page", status: "snoozed" }),
    ]);

    const entry = rates.byRule.get("missing-service-page")!;
    expect(entry.decided).toBe(3);
    expect(entry.sold).toBe(2);
    expect(entry.rate).toBeCloseTo(2 / 3);
    expect(entry.averageSale).toBe(1500);
    expect(rates.totalSoldValue).toBe(3000);
  });

  it("never counts an internal dismissal as a client loss", () => {
    const rates = computeWinRates([
      opp({ ruleId: "missing-service-page", status: "sold", soldAmount: 900 }),
      opp({ ruleId: "missing-service-page", status: "dismissed" }),
      opp({ ruleId: "missing-service-page", status: "dismissed" }),
      opp({ ruleId: "missing-service-page", status: "accepted" }),
      opp({ ruleId: "missing-service-page", status: "pitched" }),
    ]);
    const entry = rates.byRule.get("missing-service-page")!;
    // Close rate = sold / (sold + lost). The agency declining internally is
    // the agency's judgement, not the client's answer, and an accepted or
    // pitched finding the client has not answered is still pending.
    expect(entry.decided).toBe(1);
    expect(entry.sold).toBe(1);
    expect(entry.rate).toBe(1);
  });

  it("averages only over sales that recorded an amount", () => {
    const rates = computeWinRates([
      opp({ ruleId: "broken-conversion-path", status: "sold", soldAmount: 900 }),
      opp({ ruleId: "broken-conversion-path", status: "sold" }),
    ]);
    const entry = rates.byRule.get("broken-conversion-path")!;
    expect(entry.sold).toBe(2);
    expect(entry.valuedSales).toBe(1);
    expect(entry.averageSale).toBe(900);
  });

  it("does not count a resolved or covered finding as a sales decision", () => {
    const rates = computeWinRates([
      opp({ ruleId: "missing-title", status: "resolved" }),
      opp({ ruleId: "missing-title", status: "already_covered" }),
      opp({ ruleId: "missing-title", status: "superseded" }),
    ]);
    expect(rates.byRule.size).toBe(0);
  });

  it("ranks commercial work above site health whatever the win rates say", () => {
    const history = [
      // A freak run on an alt-text finding, and a poor one on real work.
      opp({ ruleId: "missing-image-alt", status: "sold", soldAmount: 200 }),
      opp({ ruleId: "missing-service-page", status: "sold", soldAmount: 1800 }),
      opp({ ruleId: "missing-service-page", status: "lost" }),
      opp({ ruleId: "missing-service-page", status: "lost" }),
    ];
    const rates = computeWinRates(history);
    expect(rates.byRule.get("missing-image-alt")!.rate).toBe(1);
    expect(rates.byRule.get("missing-service-page")!.rate).toBeCloseTo(1 / 3);

    const queue = [
      opp({ ruleId: "missing-image-alt", title: "alt text" }),
      opp({ ruleId: "missing-service-page", title: "heat pumps" }),
    ].sort(byEvidencedValue(rates));

    expect(queue.map((o) => o.title)).toEqual(["heat pumps", "alt text"]);
  });

  it("orders within a tier by what this agency converts, not by price", () => {
    const rates = computeWinRates([
      opp({ ruleId: "broken-conversion-path", status: "sold" }),
      opp({ ruleId: "broken-conversion-path", status: "sold" }),
      opp({ ruleId: "missing-service-page", status: "lost" }),
      opp({ ruleId: "missing-service-page", status: "lost" }),
    ]);

    const queue = [
      // The expensive one nobody buys must not lead the cheap one they do.
      opp({ ruleId: "missing-service-page", title: "expensive", priceMax: 5000 }),
      opp({ ruleId: "broken-conversion-path", title: "converts", priceMax: 400 }),
    ].sort(byEvidencedValue(rates));

    expect(queue.map((o) => o.title)).toEqual(["converts", "expensive"]);
  });

  it("does not bury a rule that has simply never been tried", () => {
    const rates = computeWinRates([
      opp({ ruleId: "missing-service-page", status: "sold" }),
      opp({ ruleId: "missing-service-page", status: "lost" }),
    ]);
    // no-service-pages has no history; it inherits its tier's observed rate
    // rather than sorting as though the agency had rejected it.
    const untried = opp({ ruleId: "no-service-pages" });
    expect(rankingScore(untried, rates)).toBeCloseTo(0.5);
  });

  it("gives every rule the benefit of the doubt when there is no history at all", () => {
    const rates = computeWinRates([]);
    expect(rankingScore(opp({ ruleId: "missing-service-page" }), rates)).toBe(0.5);
  });
});
