import { RULE_SERVICE_LINKS } from "@/core/rules/registry";

export type ServiceTagSuggestion = {
  tag: string;
  label: string;
  reason: string;
  confidence: "high" | "medium";
};

type Matcher = {
  patterns: readonly RegExp[];
  reason: string;
  confidence: ServiceTagSuggestion["confidence"];
};

/**
 * Small, deliberately conservative vocabulary for the service catalog.
 *
 * These are suggestions shown to a person while they edit a service; they are
 * never used by the evaluator and never written without the catalog form being
 * submitted. Broad words such as "SEO", "marketing", and "website" are left
 * out because they do not identify one of the gaps the rules can price.
 */
const MATCHERS: Record<string, Matcher> = {
  "landing-page": {
    patterns: [
      /\blanding\s+page\b/,
      /\bservice\s+page\b(?!\s+(?:build|creation|design|development))/,
      /\bpage\s+for\s+(?:a|one)\s+service\b/,
    ],
    reason: "Mentions a focused page for one service line.",
    confidence: "high",
  },
  "service-pages-build": {
    patterns: [
      /\bservice\s+pages?\s+(?:build|creation|design|development)\b/,
      /\bmultiple\s+service\s+pages?\b/,
      /\bno\s+service\s+pages?\b/,
    ],
    reason: "Mentions building a set of service pages.",
    confidence: "high",
  },
  "conversion-fix": {
    patterns: [
      /\bconversion(?:\s+(?:path|rate|optimization|optimisation))?\b/,
      /\bcall[\s-]+to[\s-]+action\b/,
      /\bcta\b/,
      /\bcontact\s+form\b/,
      /\bphone\s+link\b/,
      /\blead\s+capture\b/,
      /\b(?:form|contact)\s+(?:repair|fix)\b/,
      /\bbroken\s+(?:contact\s+)?form\b/,
    ],
    reason: "Mentions a form, phone link, or call to action in a conversion path.",
    confidence: "high",
  },
  "missing-title": {
    patterns: [
      /\b(?:page|html|meta|seo)\s+titles?\b/,
      /\btitle\s+tags?\b/,
    ],
    reason: "Mentions page titles or title tags.",
    confidence: "high",
  },
  "duplicate-title": {
    patterns: [
      /\bduplicate\s+(?:page\s+)?titles?\b/,
      /\btitles?\s+(?:are|were)\s+duplicat(?:e|ed)\b/,
    ],
    reason: "Mentions duplicate page titles.",
    confidence: "high",
  },
  "thin-service-page": {
    patterns: [
      /\bthin\s+(?:service\s+)?pages?\b/,
      /\bthin\s+service\b/,
      /\blow[-\s]content\s+(?:service\s+)?pages?\b/,
    ],
    reason: "Mentions expanding a thin service page.",
    confidence: "high",
  },
  "missing-h1": {
    patterns: [/\bh1\b/, /\bmain\s+heading\b/, /\bheading\s+hierarchy\b/],
    reason: "Mentions the page's main H1 heading.",
    confidence: "high",
  },
  "broken-internal-link": {
    patterns: [
      /\bbroken\s+(?:internal\s+)?links?\b/,
      /\bdead\s+internal\s+links?\b/,
      /\b404\s+(?:internal\s+)?links?\b/,
      /\binternal\s+link\s+(?:repair|fix)\b/,
    ],
    reason: "Mentions repairing a broken same-site link.",
    confidence: "high",
  },
  "missing-meta-description": {
    patterns: [
      /\bmeta\s+descriptions?\b/,
      /\bseo\s+descriptions?\b/,
    ],
    reason: "Mentions page meta descriptions.",
    confidence: "high",
  },
  "missing-structured-data": {
    patterns: [
      /\bstructured\s+data\b/,
      /\bschema\s+markup\b/,
      /\bjson[\s-]?ld\b/,
      /\blocalbusiness\s+schema\b/,
      /\bservice\s+schema\b/,
    ],
    reason: "Mentions LocalBusiness or Service structured data.",
    confidence: "high",
  },
  "missing-image-alt": {
    patterns: [
      /\bimage\s+alt(?:\s+attributes?)?\b/,
      /\balt\s+text\b/,
      /\bimage\s+accessibility\b/,
    ],
    reason: "Mentions image alt text or attributes.",
    confidence: "high",
  },
};

function hasMatch(matcher: Matcher | undefined, text: string): boolean {
  return Boolean(matcher?.patterns.some((pattern) => pattern.test(text)));
}

/**
 * Suggest the rule links that a service name or description clearly names.
 * Results follow the registry order so the screen remains stable as text is
 * edited. Empty and broad descriptions intentionally return an empty list.
 */
export function suggestServiceTags(input: { name: string; description: string }): ServiceTagSuggestion[] {
  const text = `${input.name ?? ""}\n${input.description ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return [];

  const duplicateMention = hasMatch(MATCHERS["duplicate-title"], text);
  const missingTitleMention =
    hasMatch(MATCHERS["missing-title"], text) &&
    /\b(?:missing|repair|fix|write|optimi[sz]e|title\s+tag)\b/.test(text);

  return RULE_SERVICE_LINKS.flatMap((link) => {
    const matcher = MATCHERS[link.tag];
    if (!matcher || !hasMatch(matcher, text)) return [];

    // "Duplicate page titles" is a distinct catalog gap. Avoid presenting a
    // missing-title suggestion for that phrase unless the copy also clearly
    // asks to repair a missing title.
    if (link.tag === "missing-title" && duplicateMention && !missingTitleMention) return [];

    return [
      {
        tag: link.tag,
        label: link.label,
        reason: matcher.reason,
        confidence: matcher.confidence,
      },
    ];
  });
}

/**
 * Apply one checkbox change without losing the still-proposed matches. The
 * first manual change starts from the visible proposal; later changes start
 * from the person's current selection.
 */
export function updateServiceTagSelection(input: {
  selectedTags: string[];
  proposedTags: string[];
  manual: boolean;
  tag: string;
  checked: boolean;
}): string[] {
  const next = new Set(input.manual ? input.selectedTags : input.proposedTags);
  if (input.checked) next.add(input.tag);
  else next.delete(input.tag);
  return [...next];
}
