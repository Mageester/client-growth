import { describe, expect, it } from "vitest";

import { analyzeClient } from "@/pipeline/analyzeClient";
import { FixtureEvidenceProvider } from "@/adapters/evidence/FixtureEvidenceProvider";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import type { Opportunity } from "@/core/schema";
import {
  coverageNone,
  hvacCatalog,
  hvacClient,
  hvacEvidence,
} from "./helpers/fixtures";

const NOW = new Date("2026-08-30T00:00:00.000Z");

function run(existing: Opportunity[] = []) {
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

describe("ACCEPTANCE: HVAC heat-pump service page", () => {
  it("surfaces exactly one billable opportunity", async () => {
    const { opportunities, suppressed } = await run();
    expect(opportunities).toHaveLength(1);
    expect(suppressed).toHaveLength(0);
  });

  it("maps to the agency's Service Landing Page at the configured price range", async () => {
    const [opp] = (await run()).opportunities;
    expect(opp?.suggestedServiceId).toBe("svc-landing-page");
    expect(opp?.priceMin).toBe(900);
    expect(opp?.priceMax).toBe(1500);
    expect(opp?.billableStatus).toBe("billable");
  });

  it("preserves the supporting evidence and produces a rationale + scope", async () => {
    const [opp] = (await run()).opportunities;
    expect(opp?.detected).toMatch(/heat pump installation/i);
    expect(opp?.evidenceRefs).toContain("https://coolbreezehvac.example/");
    expect(opp?.evidenceRefs.length).toBeGreaterThan(0);
    expect(opp?.rationale.length).toBeGreaterThan(0);
    expect(opp?.suggestedScope.length).toBeGreaterThan(0);
    expect(opp?.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("spent exactly one evaluator call (only on the surviving candidate)", async () => {
    const { stats } = await run();
    expect(stats.candidates).toBe(1);
    expect(stats.passedEvidenceThreshold).toBe(1);
    expect(stats.aiCalls).toBe(1);
    expect(stats.surfaced).toBe(1);
  });
});
