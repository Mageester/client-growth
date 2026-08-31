import { describe, expect, it } from "vitest";

import { analyzeClient } from "@/pipeline/analyzeClient";
import { FixtureEvidenceProvider } from "@/adapters/evidence/FixtureEvidenceProvider";
import type { OpportunityEvaluator } from "@/ports/OpportunityEvaluator";
import { coverageNone, hvacCatalog, hvacClient, hvacEvidence } from "./helpers/fixtures";

const throwingEvaluator: OpportunityEvaluator = {
  evaluate() {
    return Promise.reject(new Error("provider exploded / malformed output"));
  },
};

describe("pipeline fails closed when the evaluator throws", () => {
  it("surfaces no opportunity and records the error instead of crashing", async () => {
    const { opportunities, suppressed, stats } = await analyzeClient({
      client: hvacClient(),
      catalog: hvacCatalog(),
      coverage: coverageNone(),
      evidenceProvider: new FixtureEvidenceProvider([hvacEvidence()]),
      evaluator: throwingEvaluator,
      now: new Date("2026-08-30T00:00:00.000Z"),
    });

    expect(opportunities).toHaveLength(0);
    expect(suppressed).toHaveLength(0);
    expect(stats.evaluated).toBe(1);
    expect(stats.evaluatorErrors).toBe(1);
    expect(stats.surfaced).toBe(0);
  });
});
