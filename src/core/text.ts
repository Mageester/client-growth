/** Small, dependency-free text helpers shared by rules and assembly. */

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
]);

/**
 * Significant lowercase tokens from a phrase: alphanumeric, length >= 3, minus a
 * tiny stopword set. Used to test whether a page/nav entry targets an offering.
 */
export function coreTokens(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** "heat pump installation" -> "Heat Pump Installation" */
export function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
