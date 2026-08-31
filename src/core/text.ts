/** Small, dependency-free text helpers shared by rules and verification. */

const STOPWORDS = new Set([
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
  "or",
]);

/**
 * Generic "service modifier" words. They carry no discriminating meaning about
 * WHICH service a page is for ("furnace installation" vs "furnace repair" both
 * describe the furnace page), so they are dropped when deciding whether an
 * offering is already represented on the site.
 */
const MODIFIERS = new Set([
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
  "packages",
]);

/**
 * Significant lowercase tokens from a phrase: alphanumeric, length >= 2, minus a
 * tiny stopword set. Used to test whether a page/nav entry targets an offering.
 */
export function coreTokens(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** Naive English singularization: mosquitoes -> mosquito, pumps -> pump, batteries -> battery. */
export function singularize(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ses") || token.endsWith("xes") || token.endsWith("zes") || token.endsWith("ches") || token.endsWith("shes")) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/**
 * Tokens that carry the meaning of a phrase: core tokens, singularized, with
 * generic service modifiers removed. "heat pump installation" -> ["heat","pump"].
 */
export function significantTokens(phrase: string): string[] {
  const out: string[] = [];
  for (const raw of coreTokens(phrase)) {
    const t = singularize(raw);
    if (t.length >= 2 && !MODIFIERS.has(raw) && !MODIFIERS.has(t)) out.push(t);
  }
  return out;
}

/** Break a URL or slug into significant tokens: "/pest-control/ants/" -> ["pest","control","ant"]. */
export function slugTokens(input: string): string[] {
  let s = input;
  try {
    const u = new URL(input, "https://x.example");
    s = `${u.pathname} ${decodeURIComponent(u.search)}`;
  } catch {
    // not a URL, treat as a raw slug
  }
  return s
    .toLowerCase()
    .replace(/\.(html?|php|aspx?)$/i, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singularize)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** "heat pump installation" -> "Heat Pump Installation" */
export function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
