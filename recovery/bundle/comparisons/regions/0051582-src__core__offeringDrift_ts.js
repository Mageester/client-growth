// src/core/offeringDrift.ts
function normalizeOfferingLabel(label) {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}
__name(normalizeOfferingLabel, "normalizeOfferingLabel");
function uniqueOfferingLabels(labels) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const raw of labels) {
    const label = raw.trim().replace(/\s+/g, " ");
    const key = normalizeOfferingLabel(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}
__name(uniqueOfferingLabels, "uniqueOfferingLabels");
function parseOfferingLabels(value) {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return uniqueOfferingLabels(parsed.filter((item) => typeof item === "string"));
  } catch {
    return [];
  }
}
__name(parseOfferingLabels, "parseOfferingLabels");
function detectOfferingDrift(input) {
  if (input.trigger !== "scheduled") return [];
  if (!input.current.crawlExhaustive || !input.previous?.crawlExhaustive) return [];
  const previousKeys = new Set(
    uniqueOfferingLabels(input.previous.labels).map(normalizeOfferingLabel)
  );
  return uniqueOfferingLabels(input.current.labels).filter(
    (label) => !previousKeys.has(normalizeOfferingLabel(label))
  );
}
__name(detectOfferingDrift, "detectOfferingDrift");
