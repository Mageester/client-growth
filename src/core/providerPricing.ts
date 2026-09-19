const LEGACY_VERSION = "deepseek-2026-08-16-peak-offpeak-v1";
const LEGACY_EFFECTIVE_AT = Date.parse("2026-08-16T16:00:00.000Z");
const FLASH_V41_VERSION = "deepseek-2026-09-12-v4-1-flash-v1";
const FLASH_V41_EFFECTIVE_AT = Date.parse("2026-09-12T00:00:00.000Z");

const FLASH_V41_RATES = {
  offPeak: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
  peak: { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
} as const;
const LEGACY_FLASH_RATES = {
  offPeak: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
  peak: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
} as const;
const PRO_RATES = {
  offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
  peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
} as const;

type Rates = { cacheHit: number; cacheMiss: number; output: number };

function pricingFor(model: string, atMs: number): { rates: { offPeak: Rates; peak: Rates }; version: string } | null {
  if (model === "deepseek-flash") {
    return atMs >= FLASH_V41_EFFECTIVE_AT
      ? { rates: FLASH_V41_RATES, version: FLASH_V41_VERSION }
      : null;
  }
  if (model === "deepseek-v4-flash" || model === "deepseek-v4-flash-vision-exp") {
    if (atMs >= FLASH_V41_EFFECTIVE_AT) {
      return { rates: FLASH_V41_RATES, version: FLASH_V41_VERSION };
    }
    return atMs >= LEGACY_EFFECTIVE_AT
      ? { rates: LEGACY_FLASH_RATES, version: LEGACY_VERSION }
      : null;
  }
  if (model === "deepseek-v4-pro" && atMs >= LEGACY_EFFECTIVE_AT) {
    return { rates: PRO_RATES, version: LEGACY_VERSION };
  }
  return null;
}

function unavailable(limitation: string): DeepSeekCostEstimate {
  return {
    basis: "unavailable",
    costMicros: null,
    currency: "USD",
    pricingVersion: null,
    limitation,
  };
}

function validTokens(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0;
}

function isPeak(at: Date): boolean {
  const day = at.getUTCDay();
  const hour = at.getUTCHours();
  return day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
}

export interface DeepSeekCostInput {
  model: string;
  at: Date;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens?: number | null;
  cacheMissInputTokens?: number | null;
}

export interface DeepSeekCostEstimate {
  basis: "estimated" | "unavailable";
  costMicros: number | null;
  currency: "USD";
  pricingVersion: string | null;
  limitation: string | null;
}

export function estimateDeepSeekCost(input: DeepSeekCostInput): DeepSeekCostEstimate {
  const atMs = input.at.getTime();
  if (!Number.isFinite(atMs)) return unavailable("The request timestamp was invalid.");
  const pricing = pricingFor(input.model, atMs);
  if (!pricing) return unavailable(`No maintained pricing is available for model ${input.model}.`);
  if (!validTokens(input.inputTokens) || !validTokens(input.outputTokens)) {
    return unavailable("The provider did not return enough token usage to estimate cost.");
  }

  let cached = input.cachedInputTokens;
  let miss = input.cacheMissInputTokens;
  let limitation: string | null = null;
  const hasCached = validTokens(cached);
  const hasMiss = validTokens(miss);
  if (!hasCached && !hasMiss) {
    cached = 0;
    miss = input.inputTokens;
    limitation = "The provider omitted the cache token split, so this estimate conservatively assumes all input was a cache miss.";
  } else {
    if (validTokens(cached) && !validTokens(miss)) miss = input.inputTokens - cached;
    if (!validTokens(cached) && validTokens(miss)) cached = input.inputTokens - miss;
    if (!validTokens(cached) || !validTokens(miss) || cached + miss !== input.inputTokens) {
      return unavailable("The provider's cache token split does not reconcile to its reported input tokens.");
    }
  }
  if (!validTokens(cached) || !validTokens(miss)) {
    return unavailable("The provider's cache token split was unavailable.");
  }
  const selected = isPeak(input.at) ? pricing.rates.peak : pricing.rates.offPeak;
  const dollars =
    (cached / 1e6) * selected.cacheHit +
    (miss / 1e6) * selected.cacheMiss +
    (input.outputTokens / 1e6) * selected.output;
  return {
    basis: "estimated",
    costMicros: Math.round(dollars * 1e6),
    currency: "USD",
    pricingVersion: pricing.version,
    limitation,
  };
}
