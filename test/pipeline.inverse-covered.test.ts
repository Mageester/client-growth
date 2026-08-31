import { describe, expect, it, vi } from "vitest";

import { analyzeClient } from "@/pipeline/analyzeClient";
import { FixtureEvidenceProvider } from "@/adapters/evidence/FixtureEvidenceProvider";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import {
  coverageLandingPages,
  hvacCatalog,
  hvacClient,
  hvacEvidence,
} from "./helpers/fixtures";

const NOW = new Date("2026-08-30T00:00:00.000Z");

describe("INVERSE: landing-page work is already covered by the contract", () => {
  it("does not surface it as a billable upsell", async () => {
    const { opportunities } = await analyzeClient({
      client: hvacClient(),
      catalog: hvacCatalog(),
      coverage: coverageLandingPages(),
      evidenceProvider: new FixtureEvidenceProvider([hvacEvidence()]),
      evaluator: new MockEvaluator(),
      now: NOW,
    });
    expect(opportunities).toHaveLength(0);
  });

  it("records the detection as already-covered instead", async () => {
    const { suppressed } = await analyzeClient({
      client: hvacClient(),
      catalog: hvacCatalog(),
      coverage: coverageLandingPages(),
      evidenceProvider: new FixtureEvidenceProvider([hvacEvidence()]),
      evaluator: new MockEvaluator(),
      now: NOW,
    });
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]?.billableStatus).toBe("already_covered");
    expect(suppressed[0]?.status).toBe("already_covered");
    expect(suppressed[0]?.title).toMatch(/heat pump/i);
  });

  it("spends ZERO evaluator calls on covered work", async () => {
    const evaluate = vi.spyOn(MockEvaluator.prototype, "evaluate");
    const { stats } = await analyzeClient({
      client: hvacClient(),
      catalog: hvacCatalog(),
      coverage: coverageLandingPages(),
      evidenceProvider: new FixtureEvidenceProvider([hvacEvidence()]),
      evaluator: new MockEvaluator(),
      now: NOW,
    });
    expect(stats.aiCalls).toBe(0);
    expect(stats.suppressedByCoverage).toBe(1);
    expect(evaluate).not.toHaveBeenCalled();
    evaluate.mockRestore();
  });
});
