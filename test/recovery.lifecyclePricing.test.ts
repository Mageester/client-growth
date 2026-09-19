import { describe, expect, it } from "vitest";
import {
  ANALYSIS_FAILURE_CODES,
  ANALYSIS_STAGES,
  canTransitionAnalysisStage,
  classifyTerminalAnalysisStage,
  isTerminalAnalysisStage,
} from "@/core/analysisLifecycle";
import { estimateDeepSeekCost } from "@/core/providerPricing";
import { RULE_IDS, RuleIdSchema } from "@/core/ruleIds";

describe("recovered analysis lifecycle contracts", () => {
  it("preserves the production stage order and terminal behavior", () => {
    expect(ANALYSIS_STAGES).toEqual([
      "queued",
      "preparing",
      "crawling",
      "rendering",
      "analyzing",
      "synthesizing",
      "completed",
      "completed_with_limitations",
      "failed",
      "unavailable",
      "blocked",
    ]);
    expect(ANALYSIS_FAILURE_CODES).toContain("provider");
    expect(canTransitionAnalysisStage("queued", "crawling")).toBe(true);
    expect(canTransitionAnalysisStage("crawling", "preparing")).toBe(false);
    expect(canTransitionAnalysisStage("completed", "queued")).toBe(false);
    expect(isTerminalAnalysisStage("blocked")).toBe(true);
  });

  it("classifies terminal outcomes without inventing completeness", () => {
    expect(
      classifyTerminalAnalysisStage({
        outcome: "findings",
        limitation: false,
        readablePages: 5,
        blockedEvents: 0,
        inconclusiveEvents: 0,
      }),
    ).toBe("completed");
    expect(
      classifyTerminalAnalysisStage({
        outcome: "inconclusive",
        limitation: false,
        readablePages: 1,
        blockedEvents: 0,
        inconclusiveEvents: 1,
      }),
    ).toBe("completed_with_limitations");
    expect(
      classifyTerminalAnalysisStage({
        outcome: "inconclusive",
        limitation: false,
        readablePages: 0,
        blockedEvents: 2,
        inconclusiveEvents: 0,
      }),
    ).toBe("blocked");
  });
});

describe("recovered DeepSeek pricing", () => {
  it("uses flash v4.1 rates after the production effective date", () => {
    const result = estimateDeepSeekCost({
      model: "deepseek-flash",
      at: new Date("2026-09-18T12:00:00.000Z"),
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedInputTokens: 500_000,
      cacheMissInputTokens: 500_000,
    });
    expect(result).toMatchObject({
      basis: "estimated",
      costMicros: 676_500,
      pricingVersion: "deepseek-2026-09-12-v4-1-flash-v1",
      currency: "USD",
      limitation: null,
    });
  });

  it("fails closed when usage cannot be reconciled", () => {
    expect(
      estimateDeepSeekCost({
        model: "deepseek-flash",
        at: new Date("2026-09-18T12:00:00.000Z"),
        inputTokens: 10,
        outputTokens: 10,
        cachedInputTokens: 9,
        cacheMissInputTokens: 0,
      }),
    ).toMatchObject({ basis: "unavailable", costMicros: null });
  });
});

describe("recovered rule identity", () => {
  it("retains the visual opportunity and production rule ordering", () => {
    expect(RULE_IDS[0]).toBe("visual-conversion-opportunity");
    expect(RULE_IDS).toHaveLength(13);
    expect(RuleIdSchema.parse("visual-conversion-opportunity")).toBe(
      "visual-conversion-opportunity",
    );
    expect(() => RuleIdSchema.parse("not-a-production-rule")).toThrow();
  });
});
