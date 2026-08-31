import { describe, expect, it } from "vitest";

import { DeepSeekEvaluator } from "@/adapters/evaluator/DeepSeekEvaluator";
import { runRules } from "@/core/rules";
import {
  hvacCatalog,
  hvacClient,
  hvacEvidence,
} from "../helpers/fixtures";

/**
 * LIVE smoke test. Opt-in only.
 *
 *   AI_PROVIDER=deepseek DEEPSEEK_API_KEY=sk-... pnpm eval:live
 *
 * Skipped entirely unless DEEPSEEK_API_KEY is present, so `pnpm eval:live` with
 * no key is a no-op rather than a failure. Never commit the key — put it in
 * `.dev.vars` (git-ignored) or pass it inline.
 */
const apiKey = process.env.DEEPSEEK_API_KEY;

// DeepSeek list pricing (USD per 1M tokens), approximate — override via env.
const INPUT_PER_MTOK = Number(process.env.DEEPSEEK_USD_PER_MTOK_IN ?? "0.27");
const OUTPUT_PER_MTOK = Number(process.env.DEEPSEEK_USD_PER_MTOK_OUT ?? "1.10");

describe.skipIf(!apiKey)("LIVE DeepSeek evaluation", () => {
  it("judges the HVAC heat-pump candidate and returns a contract-valid Evaluation", async () => {
    const client = hvacClient();
    const candidates = await runRules({
      client,
      catalog: hvacCatalog(),
      evidence: hvacEvidence(),
    });
    expect(candidates).toHaveLength(1);

    const evaluator = new DeepSeekEvaluator({
      apiKey: apiKey as string,
      baseUrl: process.env.DEEPSEEK_BASE_URL,
      model: process.env.DEEPSEEK_MODEL,
    });

    const evaluation = await evaluator.evaluate({
      candidate: candidates[0]!,
      client,
      evidence: hvacEvidence(),
    });

    expect(["surface", "reject"]).toContain(evaluation.verdict);
    expect(evaluation.confidence).toBeGreaterThanOrEqual(0);
    expect(evaluation.confidence).toBeLessThanOrEqual(1);
    expect(evaluation.rationale.length).toBeGreaterThan(0);

    const usage = evaluator.lastUsage;
    const costUsd =
      usage === null
        ? 0
        : (usage.promptTokens / 1_000_000) * INPUT_PER_MTOK +
          (usage.completionTokens / 1_000_000) * OUTPUT_PER_MTOK;

    // eslint-disable-next-line no-console
    console.log(
      `[live] verdict=${evaluation.verdict} confidence=${evaluation.confidence} ` +
        `tokens=${JSON.stringify(usage)} approxCostUSD=${costUsd.toFixed(6)}`,
    );
    // eslint-disable-next-line no-console
    console.log(`[live] rationale: ${evaluation.rationale}`);
    // eslint-disable-next-line no-console
    console.log(`[live] scope: ${JSON.stringify(evaluation.suggestedScope, null, 2)}`);
  }, 30_000);
});
