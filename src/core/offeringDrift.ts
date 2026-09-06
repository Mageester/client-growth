/** A snapshot of what the client's site advertised during one crawl. */
export interface OfferingSnapshot {
  labels: readonly string[];
  crawlExhaustive: boolean;
}

export type OfferingDriftTrigger = "manual" | "scheduled";

/**
 * Normalize only presentation differences. The suggestion engine already owns
 * the harder question of whether a label names a service; drift only asks
 * whether the same label appeared before.
 */
export function normalizeOfferingLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

export function uniqueOfferingLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of labels) {
    const label = raw.trim().replace(/\s+/g, " ");
    const key = normalizeOfferingLabel(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

/** Parse persisted labels defensively at the database boundary. */
export function parseOfferingLabels(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return uniqueOfferingLabels(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return [];
  }
}

/**
 * Return labels that appeared after a trustworthy exhaustive baseline.
 *
 * A first baseline is intentionally silent, manual runs never announce drift,
 * and incomplete crawls neither announce nor establish a baseline. This keeps
 * a changing crawl frontier from turning ordinary sampling variance into news.
 */
export function detectOfferingDrift(input: {
  trigger: OfferingDriftTrigger;
  current: OfferingSnapshot;
  previous: OfferingSnapshot | null;
}): string[] {
  if (input.trigger !== "scheduled") return [];
  if (!input.current.crawlExhaustive || !input.previous?.crawlExhaustive) return [];

  const previousKeys = new Set(
    uniqueOfferingLabels(input.previous.labels).map(normalizeOfferingLabel),
  );
  return uniqueOfferingLabels(input.current.labels).filter(
    (label) => !previousKeys.has(normalizeOfferingLabel(label)),
  );
}
