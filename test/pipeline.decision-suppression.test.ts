import { describe, expect, it } from "vitest";

import { analyzeClient } from "@/pipeline/analyzeClient";
import { FixtureEvidenceProvider } from "@/adapters/evidence/FixtureEvidenceProvider";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import type { Opportunity } from "@/core/schema";
import { coverageNone, hvacCatalog, hvacClient, hvacEvidence } from "./helpers/fixtures";

const NOW = new Date("2026-08-30T00:00:00.000Z");

function analyze(existing: Opportunity[] = []) {
  return analyzeClient({
    client: hvacClient(),
    catalog: hvacCatalog(),
    coverage: coverageNone(),
    evidenceProvider: new FixtureEvidenceProvider([hvacEvidence()]),
    evaluator: new MockEvaluator(),
    existing,
    now: NOW,
  });
}

describe("persisted decisions suppress re-surfacing", () => {
  it("a dismissed opportunity does not come back on re-run and costs no AI call", async () => {
    const first = await analyze();
    const opp = first.opportunities[0];
    expect(opp).toBeDefined();

    const dismissed: Opportunity = { ...(opp as Opportunity), status: "dismissed" };
    const second = await analyze([dismissed]);

    expect(second.opportunities).toHaveLength(0);
    expect(second.suppressed.map((o) => o.dedupeKey)).toContain(dismissed.dedupeKey);
    expect(second.stats.aiCalls).toBe(0);
    expect(second.stats.suppressedByPriorDecision).toBe(1);
  });

  it("an expired snooze allows the opportunity to surface again", async () => {
    const first = await analyze();
    const opp = first.opportunities[0] as Opportunity;

    const snoozedPast: Opportunity = {
      ...opp,
      status: "snoozed",
      snoozeUntil: "2026-08-01T00:00:00.000Z", // before NOW
    };
    const result = await analyze([snoozedPast]);
    expect(result.opportunities).toHaveLength(1);
    expect(result.stats.aiCalls).toBe(1);
  });

  it("an active snooze keeps the opportunity suppressed", async () => {
    const first = await analyze();
    const opp = first.opportunities[0] as Opportunity;

    const snoozedFuture: Opportunity = {
      ...opp,
      status: "snoozed",
      snoozeUntil: "2027-01-01T00:00:00.000Z", // after NOW
    };
    const result = await analyze([snoozedFuture]);
    expect(result.opportunities).toHaveLength(0);
    expect(result.stats.suppressedByPriorDecision).toBe(1);
    expect(result.stats.aiCalls).toBe(0);
  });
});
