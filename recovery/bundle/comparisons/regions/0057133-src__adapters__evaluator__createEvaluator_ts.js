// src/adapters/evaluator/createEvaluator.ts
function createEvaluator(env2, deps = {}) {
  if (env2.AI_PROVIDER === "deepseek") {
    return new DeepSeekEvaluator({
      apiKey: env2.DEEPSEEK_API_KEY ?? "",
      baseUrl: env2.DEEPSEEK_BASE_URL,
      model: env2.DEEPSEEK_MODEL,
      fetchImpl: deps.fetchImpl
    });
  }
  return new MockEvaluator();
}
__name(createEvaluator, "createEvaluator");
