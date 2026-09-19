// src/core/providerPricing.ts
var LEGACY_VERSION = "deepseek-2026-08-16-peak-offpeak-v1";
var LEGACY_EFFECTIVE_AT = Date.parse("2026-08-16T16:00:00.000Z");
var FLASH_V41_VERSION = "deepseek-2026-09-12-v4-1-flash-v1";
var FLASH_V41_EFFECTIVE_AT = Date.parse("2026-09-12T00:00:00.000Z");
var FLASH_V41_RATES = {
  offPeak: { cacheHit: 3e-3, cacheMiss: 0.15, output: 0.6 },
  peak: { cacheHit: 6e-3, cacheMiss: 0.3, output: 1.2 }
};
var LEGACY_FLASH_RATES = {
  offPeak: { cacheHit: 7e-3, cacheMiss: 0.22, output: 0.66 },
  peak: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 }
};
var PRO_RATES = {
  offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
  peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 }
};
function pricingFor(model, atMs) {
  if (model === "deepseek-flash") {
    return atMs >= FLASH_V41_EFFECTIVE_AT ? { rates: FLASH_V41_RATES, version: FLASH_V41_VERSION } : null;
  }
  if (model === "deepseek-v4-flash" || model === "deepseek-v4-flash-vision-exp") {
    if (atMs >= FLASH_V41_EFFECTIVE_AT) {
      return { rates: FLASH_V41_RATES, version: FLASH_V41_VERSION };
    }
    return atMs >= LEGACY_EFFECTIVE_AT ? { rates: LEGACY_FLASH_RATES, version: LEGACY_VERSION } : null;
  }
  if (model === "deepseek-v4-pro" && atMs >= LEGACY_EFFECTIVE_AT) {
    return { rates: PRO_RATES, version: LEGACY_VERSION };
  }
  return null;
}
__name(pricingFor, "pricingFor");
function unavailable(limitation3) {
  return {
    basis: "unavailable",
    costMicros: null,
    currency: "USD",
    pricingVersion: null,
    limitation: limitation3
  };
}
__name(unavailable, "unavailable");
function validTokens(value) {
  return value !== null && Number.isFinite(value) && value >= 0;
}
__name(validTokens, "validTokens");
function isPeak(at) {
  const day = at.getUTCDay();
  const hour = at.getUTCHours();
  return day >= 1 && day <= 5 && (hour >= 1 && hour < 4 || hour >= 6 && hour < 10);
}
__name(isPeak, "isPeak");
function estimateDeepSeekCost(input) {
  const atMs = input.at.getTime();
  if (!Number.isFinite(atMs)) return unavailable("The request timestamp was invalid.");
  const pricing = pricingFor(input.model, atMs);
  if (!pricing) {
    return unavailable(`No maintained pricing is available for model ${input.model}.`);
  }
  if (!validTokens(input.inputTokens) || !validTokens(input.outputTokens)) {
    return unavailable("The provider did not return enough token usage to estimate cost.");
  }
  let cached3 = input.cachedInputTokens;
  let miss = input.cacheMissInputTokens;
  let limitation3 = null;
  const hasCached = validTokens(cached3);
  const hasMiss = validTokens(miss);
  if (!hasCached && !hasMiss) {
    cached3 = 0;
    miss = input.inputTokens;
    limitation3 = "The provider omitted the cache token split, so this estimate conservatively assumes all input was a cache miss.";
  } else {
    if (validTokens(cached3) && !validTokens(miss)) miss = input.inputTokens - cached3;
    if (!validTokens(cached3) && validTokens(miss)) cached3 = input.inputTokens - miss;
    if (!validTokens(cached3) || !validTokens(miss) || cached3 + miss !== input.inputTokens) {
      return unavailable(
        "The provider's cache token split does not reconcile to its reported input tokens."
      );
    }
  }
  if (!validTokens(cached3) || !validTokens(miss)) {
    return unavailable("The provider's cache token split was unavailable.");
  }
  const selected = isPeak(input.at) ? pricing.rates.peak : pricing.rates.offPeak;
  const dollars = cached3 / 1e6 * selected.cacheHit + miss / 1e6 * selected.cacheMiss + input.outputTokens / 1e6 * selected.output;
  return {
    basis: "estimated",
    costMicros: Math.round(dollars * 1e6),
    currency: "USD",
    pricingVersion: pricing.version,
    limitation: limitation3
  };
}
__name(estimateDeepSeekCost, "estimateDeepSeekCost");
