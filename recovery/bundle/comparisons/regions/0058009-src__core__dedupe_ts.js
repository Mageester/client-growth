// src/core/dedupe.ts
function slug(s) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
__name(slug, "slug");
function fnv1a(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
__name(fnv1a, "fnv1a");
function dedupeKey(clientId2, ruleId, subject) {
  if (TECHNICAL_RULE_IDS2.includes(ruleId)) {
    return technicalDedupeKey(clientId2, ruleId);
  }
  const basis = `${clientId2}::${ruleId}::${slug(subject)}`;
  return `${slug(ruleId)}__${slug(subject)}__${fnv1a(basis)}`;
}
__name(dedupeKey, "dedupeKey");
function technicalDedupeKey(clientId2, ruleId) {
  return `technical::${clientId2}::${ruleId}`;
}
__name(technicalDedupeKey, "technicalDedupeKey");
