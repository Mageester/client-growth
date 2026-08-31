import { describe, expect, it, vi } from "vitest";

import { parseEnv } from "@/config/env";
import { createEvaluator } from "@/adapters/evaluator/createEvaluator";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import { DeepSeekEvaluator } from "@/adapters/evaluator/DeepSeekEvaluator";
import { analyzeClient } from "@/pipeline/analyzeClient";
import { FixtureEvidenceProvider } from "@/adapters/evidence/FixtureEvidenceProvider";
import { coverageNone, hvacCatalog, hvacClient, hvacEvidence } from "./helpers/fixtures";

describe("cost-control guards", () => {
  it("defaults to the mock provider when nothing is configured", () => {
    const env = parseEnv({});
    expect(env.AI_PROVIDER).toBe("mock");
    expect(createEvaluator(env)).toBeInstanceOf(MockEvaluator);
  });

  it("refuses to construct the DeepSeek provider without an API key", () => {
    const env = parseEnv({ AI_PROVIDER: "deepseek" });
    expect(() => createEvaluator(env)).toThrow(/apiKey/i);
    expect(() => new DeepSeekEvaluator({ apiKey: "" })).toThrow();
    expect(() => new DeepSeekEvaluator({ apiKey: "   " })).toThrow();
  });

  it("constructing DeepSeek with a key does not make any network call", () => {
    const fetchImpl = vi.fn();
    new DeepSeekEvaluator({ apiKey: "sk-test", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a full mock-provider analysis never touches fetch", async () => {
    const fetchImpl = vi.fn();
    const env = parseEnv({}); // mock
    const evaluator = createEvaluator(env, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const { opportunities } = await analyzeClient({
      client: hvacClient(),
      catalog: hvacCatalog(),
      coverage: coverageNone(),
      evidenceProvider: new FixtureEvidenceProvider([hvacEvidence()]),
      evaluator,
      now: new Date("2026-08-30T00:00:00.000Z"),
    });

    expect(opportunities).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
