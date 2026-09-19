import { estimateDeepSeekCost } from "@/core/providerPricing";
import { beginProviderUsage, finishProviderUsage } from "@/db/providerUsage";
import type { TenantScope } from "@/db/tenant";

function token(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function requestModel(init: RequestInit | undefined, fallback: string): string {
  if (typeof init?.body !== "string") return fallback;
  try {
    const parsed = JSON.parse(init.body) as { model?: unknown };
    return typeof parsed.model === "string" && parsed.model.trim() ? parsed.model : fallback;
  } catch {
    return fallback;
  }
}

async function responseUsage(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const payload = await response.clone().json() as { usage?: unknown };
    return payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export interface MeteredDeepSeekFetchOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  clientId: string | null;
  userId: string | null;
  jobId: string | null;
  feature: string;
  model: string;
  onProviderRequest?: () => void;
}

export function createMeteredDeepSeekFetch(t: TenantScope, options: MeteredDeepSeekFetchOptions): typeof fetch {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => new Date());
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const started = now();
    const startedAt = started.toISOString();
    const model = requestModel(init, options.model);
    const usageId = await beginProviderUsage(t, { clientId: options.clientId, userId: options.userId, jobId: options.jobId, provider: "deepseek", model, feature: options.feature, startedAt });
    options.onProviderRequest?.();
    let response: Response;
    try {
      response = await fetchImpl(input, init);
    } catch (error) {
      const finished = now();
      try {
        await finishProviderUsage(t, usageId, { finishedAt: finished.toISOString(), durationMs: finished.getTime() - started.getTime(), requestStatus: "failed", inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheMissInputTokens: null, costBasis: "unavailable", costMicros: null, currency: "USD", pricingVersion: null, limitation: "The provider did not return usage for this failed request." });
      } catch { console.error("[provider-usage] could not finalize a failed request"); }
      throw error;
    }
    const usage = await responseUsage(response);
    const finished = now();
    const inputTokens = token(usage?.prompt_tokens);
    const outputTokens = token(usage?.completion_tokens);
    const cachedInputTokens = token(usage?.prompt_cache_hit_tokens);
    const cacheMissInputTokens = token(usage?.prompt_cache_miss_tokens);
    const estimate = estimateDeepSeekCost({ model, at: started, inputTokens, outputTokens, cachedInputTokens, cacheMissInputTokens });
    const requestStatus = response.ok ? "succeeded" : "failed";
    try {
      await finishProviderUsage(t, usageId, { finishedAt: finished.toISOString(), durationMs: finished.getTime() - started.getTime(), requestStatus, inputTokens, outputTokens, cachedInputTokens, cacheMissInputTokens, costBasis: estimate.basis, costMicros: estimate.costMicros, currency: estimate.currency, pricingVersion: estimate.pricingVersion, limitation: estimate.limitation });
    } catch { console.error("[provider-usage] could not finalize a provider request"); }
    return response;
  }) as typeof fetch;
}
