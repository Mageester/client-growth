import { describe, expect, it } from "vitest";

import { ADVERSARIAL_CASES, categoryCounts } from "./bench/adversarialCases";
import { runBenchmark, runCase } from "./bench/harness";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import type { EvaluatorInput, OpportunityEvaluator } from "@/ports/OpportunityEvaluator";
import type { Evaluation, SubjectType } from "@/core/schema";

/**
 * The adversarial judgment set, run offline.
 *
 * Two different questions are asked here, and neither of them needs a paid
 * provider:
 *
 *   1. What does the DETERMINISTIC engine do on its own? Some subjects never
 *      reach a judgment at all because the rules already refuse to treat them as
 *      offerings — that is free protection, and it is measured, not assumed.
 *   2. Given a CORRECT classification, does the judgment gate actually hold? A
 *      labeled evaluator answers each case with the human label, which proves the
 *      wiring end to end without pretending it proves a model's accuracy.
 *
 * What DeepSeek actually classifies is a separate, measured question, and it
 * belongs to `pnpm bench --deepseek --samples=N`, not to this suite. Making an
 * ordinary test depend on a live provider would trade deterministic reliability
 * for a number that changes with the weather.
 */

const CATEGORY_TO_SUBJECT_TYPE: Record<string, SubjectType> = {
  true_service: "distinct_service",
  trust_signal: "trust_signal",
  promotion: "promotion",
  generic_claim: "generic_claim",
  ambiguous: "ambiguous",
};

/**
 * An evaluator that answers with the human label for the case being run. It is
 * a stand-in for a perfectly accurate judge, so a failure here is a wiring or
 * policy bug, never a model quality result.
 */
function labeledEvaluator(subjectType: SubjectType): OpportunityEvaluator {
  return {
    evaluate: ({ candidate }: EvaluatorInput): Promise<Evaluation> =>
      Promise.resolve({
        verdict: subjectType === "distinct_service" ? "surface" : "reject",
        confidence: candidate.rawConfidence,
        rationale: `Labeled as ${subjectType} by a human.`,
        suggestedScope: subjectType === "distinct_service" ? ["Build the page"] : [],
        subjectType,
        commerciallyActionable: subjectType === "distinct_service",
      }),
  };
}

describe("adversarial judgment set", () => {
  it("covers every category with enough cases to measure a rate", () => {
    const counts = categoryCounts();
    expect(ADVERSARIAL_CASES.length).toBeGreaterThanOrEqual(30);
    expect(counts.true_service).toBeGreaterThanOrEqual(10);
    expect(counts.trust_signal).toBeGreaterThanOrEqual(5);
    expect(counts.promotion).toBeGreaterThanOrEqual(5);
    expect(counts.generic_claim).toBeGreaterThanOrEqual(4);
    expect(counts.ambiguous).toBeGreaterThanOrEqual(4);
  });

  it("hands every true service to the judgment layer rather than losing it in the rules", async () => {
    // If the rules silently dropped these, a later "the evaluator surfaces every
    // real service" result would be measuring nothing.
    for (const c of ADVERSARIAL_CASES.filter((x) => x.category === "true_service")) {
      const r = await runCase(c, new MockEvaluator());
      expect(r.stats.passedEvidenceThreshold, `${c.id} produced no candidate`).toBe(1);
    }
  });

  it("surfaces exactly the real services when the judgment is correct, and nothing else", async () => {
    for (const c of ADVERSARIAL_CASES) {
      const subjectType = CATEGORY_TO_SUBJECT_TYPE[c.category!]!;
      const r = await runCase(c, labeledEvaluator(subjectType));

      expect(r.falsePositives, `${c.id}: ${r.why}`).toEqual([]);
      if (c.category === "true_service") {
        expect(r.stats.surfaced, `${c.id} lost a real service line`).toBe(1);
      } else {
        expect(r.stats.surfaced, `${c.id} priced a non-service`).toBe(0);
      }
    }
  });

  it("costs exactly one evaluator call per candidate, and none for what the rules already dropped", async () => {
    const card = await runBenchmark(new MockEvaluator(), ADVERSARIAL_CASES);
    for (const r of card.results) {
      expect(r.stats.aiCalls).toBe(r.stats.evaluated);
      expect(r.stats.evaluated).toBe(r.stats.passedEvidenceThreshold);
    }
  });

  /**
   * The measured cost of MockEvaluator, pinned so it cannot drift unnoticed.
   *
   * MockEvaluator asserts "distinct service" for every candidate, so on this set
   * it prices trust claims, promotions and filler as $900–$1,800 landing pages.
   * That is the gap a real evaluator has to close, and it is recorded here as a
   * number rather than as a worry.
   */
  it("shows MockEvaluator offering no protection at all on non-services", async () => {
    const card = await runBenchmark(new MockEvaluator(), ADVERSARIAL_CASES);
    const nonServices = card.results.filter(
      (r) => r.category !== "true_service" && r.stats.passedEvidenceThreshold > 0,
    );

    expect(nonServices.length).toBeGreaterThan(15);
    for (const r of nonServices) {
      expect(r.stats.surfaced, `${r.id} was unexpectedly not surfaced by the mock`).toBe(1);
    }
    // Two subjects never become candidates at all: the rules find no
    // distinguishing words in them, which is free, deterministic protection.
    const droppedByRules = card.results.filter((r) => r.stats.candidates === 0);
    expect(droppedByRules.map((r) => r.id).sort()).toEqual([
      "ambiguous-maintenance-plans",
      "generic-claim-affordable-pricing",
    ]);
  });
});
