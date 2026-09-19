// src/core/clientValue.ts
function isUsableJobValue(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
__name(isUsableJobValue, "isUsableJobValue");
function jobsToPayback(input) {
  if (!isUsableJobValue(input.averageJobValue)) return null;
  const { priceMin, priceMax, averageJobValue } = input;
  if (!Number.isFinite(priceMin) || !Number.isFinite(priceMax)) return null;
  if (priceMin < 0 || priceMax < 0) return null;
  if (priceMax === 0 && priceMin === 0) return null;
  return {
    min: Math.max(1, Math.ceil(Math.min(priceMin, priceMax) / averageJobValue)),
    max: Math.max(1, Math.ceil(Math.max(priceMin, priceMax) / averageJobValue))
  };
}
__name(jobsToPayback, "jobsToPayback");
function paybackSentence(range) {
  if (!range) return null;
  if (range.max === 1) return "Pays for itself with one job.";
  if (range.min === range.max) return `Pays for itself with ${range.min} jobs.`;
  return `Pays for itself with ${range.min}\u2013${range.max} jobs.`;
}
__name(paybackSentence, "paybackSentence");
