import type { Client } from "@/core/schema";

export const OPPORTUNITY_FAMILIES = {
  "service-visibility": {
    key: "service-visibility",
    label: "Service visibility",
    description: "Pages that help customers find and understand what this business sells.",
  },
  conversion: {
    key: "conversion",
    label: "Conversion",
    description: "Ways to turn a visit into a call, form submission, or enquiry.",
  },
  "site-health": {
    key: "site-health",
    label: "Site health",
    description: "Supporting website fixes that improve clarity, accessibility, and discoverability.",
  },
} as const;

export type OpportunityFamilyKey = keyof typeof OPPORTUNITY_FAMILIES;
export type OpportunityFamily = (typeof OPPORTUNITY_FAMILIES)[OpportunityFamilyKey];

export interface OpportunityFamilyGroup<T> {
  /** Derived display key only; it is not a persisted opportunity identifier. */
  key: string;
  family: OpportunityFamily;
  client: Pick<Client, "id" | "name">;
  entries: T[];
}

type GroupableEntry = {
  opportunity: { ruleId: string };
  client: Pick<Client, "id" | "name">;
};

const SERVICE_VISIBILITY_RULES = new Set([
  "missing-service-page",
  "no-service-pages",
  "competitor-service-gap",
]);

function familyForRule(ruleId: string): OpportunityFamily {
  if (SERVICE_VISIBILITY_RULES.has(ruleId)) return OPPORTUNITY_FAMILIES["service-visibility"];
  if (ruleId === "broken-conversion-path") return OPPORTUNITY_FAMILIES.conversion;
  return OPPORTUNITY_FAMILIES["site-health"];
}

/**
 * Group existing opportunity rows for display without creating package rows.
 * The original entry objects are retained so IDs, prices, statuses, links,
 * and funnel actions remain attached to the same opportunity.
 */
export function groupOpportunitiesByFamily<T extends GroupableEntry>(
  entries: T[],
): OpportunityFamilyGroup<T>[] {
  const groups = new Map<string, OpportunityFamilyGroup<T>>();
  for (const entry of entries) {
    const family = familyForRule(entry.opportunity.ruleId);
    const key = `${entry.client.id}:${family.key}`;
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(key, {
        key,
        family,
        client: entry.client,
        entries: [entry],
      });
    }
  }
  return [...groups.values()];
}
