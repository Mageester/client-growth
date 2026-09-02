import type { EvaluatorInput, OpportunityEvaluator } from "@/ports/OpportunityEvaluator";
import type { Evaluation } from "@/core/schema";
import { DeepSeekEvaluator } from "@/adapters/evaluator/DeepSeekEvaluator";

/**
 * Wraps an evaluator with a hard call ceiling and cost accounting.
 *
 * The benchmark is the only place a real provider is pointed at every case at
 * once, so the ceiling is enforced here rather than trusted to the pipeline's
 * per-run cap: a bug that multiplied calls per candidate would otherwise spend
 * real money before anyone read the scorecard. Exceeding the ceiling throws,
 * and the pipeline fails closed on a throwing evaluator, so an overrun shows up
 * as a visibly incomplete run instead of a silent bill.
 */

/** DeepSeek list pricing (USD per 1M tokens). Override via env for accuracy. */
const INPUT_PER_MTOK = Number(process.env.DEEPSEEK_USD_PER_MTOK_IN ?? "0.27");
const OUTPUT_PER_MTOK = Number(process.env.DEEPSEEK_USD_PER_MTOK_OUT ?? "1.10");

export class BudgetExceededError extends Error {
  constructor(limit: number) {
    super(`Benchmark call budget of ${limit} evaluator calls was exhausted.`);
    this.name = "BudgetExceededError";
  }
}

export interface EvaluatorMeter {
  calls: number;
  failures: number;
  promptTokens: number;
  completionTokens: number;
  /** Estimated spend in USD, from list pricing. Zero for offline evaluators. */
  costUsd: number;
  /** Every verdict returned, in call order, for the mock-vs-real comparison. */
  verdicts: Array<{ subject: string; verdict: Evaluation["verdict"]; confidence: number }>;
}

export function newMeter(): EvaluatorMeter {
  return {
    calls: 0,
    failures: 0,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    verdicts: [],
  };
}

export function metered(
  inner: OpportunityEvaluator,
  meter: EvaluatorMeter,
  limit: number,
): OpportunityEvaluator {
  return {
    async evaluate(input: EvaluatorInput): Promise<Evaluation> {
      if (meter.calls >= limit) throw new BudgetExceededError(limit);
      meter.calls++;
      try {
        const evaluation = await inner.evaluate(input);
        meter.verdicts.push({
          subject: input.candidate.subject,
          verdict: evaluation.verdict,
          confidence: evaluation.confidence,
        });
        if (inner instanceof DeepSeekEvaluator && inner.lastUsage) {
          meter.promptTokens += inner.lastUsage.promptTokens;
          meter.completionTokens += inner.lastUsage.completionTokens;
          meter.costUsd =
            (meter.promptTokens / 1_000_000) * INPUT_PER_MTOK +
            (meter.completionTokens / 1_000_000) * OUTPUT_PER_MTOK;
        }
        return evaluation;
      } catch (err) {
        meter.failures++;
        throw err;
      }
    },
  };
}
