import type { OpportunityEvaluator } from "@/ports/OpportunityEvaluator";
import type { Env } from "@/config/env";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import { DeepSeekEvaluator } from "@/adapters/evaluator/DeepSeekEvaluator";

export interface CreateEvaluatorDeps {
  fetchImpl?: typeof fetch;
}

/**
 * The only place an evaluator is chosen. Returns MockEvaluator unless the
 * environment explicitly selects "deepseek" (in which case a real API key is
 * required or construction throws).
 */
export function createEvaluator(env: Env, deps: CreateEvaluatorDeps = {}): OpportunityEvaluator {
  if (env.AI_PROVIDER === "deepseek") {
    return new DeepSeekEvaluator({
      apiKey: env.DEEPSEEK_API_KEY ?? "",
      baseUrl: env.DEEPSEEK_BASE_URL,
      model: env.DEEPSEEK_MODEL,
      fetchImpl: deps.fetchImpl,
    });
  }
  return new MockEvaluator();
}
