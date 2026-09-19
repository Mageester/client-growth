// src/core/text.ts
var STOPWORDS = /* @__PURE__ */ new Set([
  "the",
  "and",
  "for",
  "with",
  "your",
  "our",
  "you",
  "are",
  "from",
  "that",
  "this",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "or"
]);
var MODIFIERS = /* @__PURE__ */ new Set([
  "installation",
  "install",
  "installs",
  "installing",
  "repair",
  "repairs",
  "repairing",
  "replacement",
  "replace",
  "replacing",
  "service",
  "services",
  "servicing",
  "maintenance",
  "maintain",
  "upgrade",
  "upgrades",
  "system",
  "systems",
  "solution",
  "solutions",
  "company",
  "near",
  "me",
  "cost",
  "costs",
  "pricing",
  "price",
  "prices",
  "quote",
  "quotes",
  "estimate",
  "estimates",
  "professional",
  "professionals",
  "expert",
  "experts",
  "local",
  "residential",
  "commercial",
  "emergency",
  "best",
  "top",
  "indoor",
  "outdoor",
  "new",
  "used",
  "affordable",
  // domain "service word" modifiers: they say a page is a service page, not
  // which service it is for.
  "treatment",
  "treatments",
  "control",
  "removal",
  "cleaning",
  "care",
  "protection",
  "inspection",
  "inspections",
  "cleanup",
  "restoration",
  "remediation",
  "plan",
  "plans",
  "package",
  "packages"
]);
function coreTokens(phrase) {
  return phrase.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}
__name(coreTokens, "coreTokens");
function singularize(token3) {
  if (token3.length <= 3) return token3;
  if (token3.endsWith("ies")) return `${token3.slice(0, -3)}y`;
  if (token3.endsWith("ses") || token3.endsWith("xes") || token3.endsWith("zes") || token3.endsWith("ches") || token3.endsWith("shes")) {
    return token3.slice(0, -2);
  }
  if (token3.endsWith("s") && !token3.endsWith("ss")) return token3.slice(0, -1);
  return token3;
}
__name(singularize, "singularize");
function significantTokens(phrase) {
  const out = [];
  for (const raw of coreTokens(phrase)) {
    const t = singularize(raw);
    if (t.length >= 2 && !MODIFIERS.has(raw) && !MODIFIERS.has(t)) out.push(t);
  }
  return out;
}
__name(significantTokens, "significantTokens");
function slugTokens(input) {
  let s = input;
  try {
    const u = new URL(input, "https://x.example");
    s = `${u.pathname} ${decodeURIComponent(u.search)}`;
  } catch {
  }
  return s.toLowerCase().replace(/\.(html?|php|aspx?)$/i, " ").split(/[^a-z0-9]+/).filter(Boolean).map(singularize).filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}
__name(slugTokens, "slugTokens");
function titleCase(s) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
__name(titleCase, "titleCase");
function preservedValuesClause(count5) {
  if (count5 <= 1) return "The value is preserved; no winner is inferred.";
  if (count5 === 2) return "Both values are preserved; no winner is inferred.";
  return `All ${count5} values are preserved; no winner is inferred.`;
}
__name(preservedValuesClause, "preservedValuesClause");
