// app/lib/provider-usage.server.ts
function token(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}
__name(token, "token");
function requestModel(init2, fallback) {
  if (typeof init2?.body !== "string") return fallback;
  try {
    const parsed = JSON.parse(init2.body);
    return typeof parsed.model === "string" && parsed.model.trim() ? parsed.model : fallback;
  } catch {
    return fallback;
  }
}
__name(requestModel, "requestModel");
async function responseUsage(response) {
  try {
    const payload = await response.clone().json();
    return payload.usage && typeof payload.usage === "object" ? payload.usage : null;
  } catch {
    return null;
  }
}
__name(responseUsage, "responseUsage");
function createMeteredDeepSeekFetch(t, options) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now2 = options.now ?? (() => /* @__PURE__ */ new Date());
  return (async (input, init2) => {
    const started = now2();
    const startedAt = started.toISOString();
    const model = requestModel(init2, options.model);
    const usageId = await beginProviderUsage(t, {
      clientId: options.clientId,
      userId: options.userId,
      jobId: options.jobId,
      provider: "deepseek",
      model,
      feature: options.feature,
      startedAt
    });
    options.onProviderRequest?.();
    let response;
    try {
      response = await fetchImpl(input, init2);
    } catch (error3) {
      const finished2 = now2();
      try {
        await finishProviderUsage(t, usageId, {
          finishedAt: finished2.toISOString(),
          durationMs: finished2.getTime() - started.getTime(),
          requestStatus: "failed",
          inputTokens: null,
          outputTokens: null,
          cachedInputTokens: null,
          cacheMissInputTokens: null,
          costBasis: "unavailable",
          costMicros: null,
          currency: "USD",
          pricingVersion: null,
          limitation: "The provider did not return usage for this failed request."
        });
      } catch {
        console.error("[provider-usage] could not finalize a failed request");
      }
      throw error3;
    }
    const usage2 = await responseUsage(response);
    const finished = now2();
    const inputTokens = token(usage2?.prompt_tokens);
    const outputTokens = token(usage2?.completion_tokens);
    const cachedInputTokens = token(usage2?.prompt_cache_hit_tokens);
    const cacheMissInputTokens = token(usage2?.prompt_cache_miss_tokens);
    const estimate = estimateDeepSeekCost({
      model,
      at: started,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheMissInputTokens
    });
    const requestStatus = response.ok ? "succeeded" : "failed";
    try {
      await finishProviderUsage(t, usageId, {
        finishedAt: finished.toISOString(),
        durationMs: finished.getTime() - started.getTime(),
        requestStatus,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        cacheMissInputTokens,
        costBasis: estimate.basis,
        costMicros: estimate.costMicros,
        currency: estimate.currency,
        pricingVersion: estimate.pricingVersion,
        limitation: estimate.limitation
      });
    } catch {
      console.error("[provider-usage] could not finalize a provider request");
    }
    return response;
  });
}
__name(createMeteredDeepSeekFetch, "createMeteredDeepSeekFetch");
