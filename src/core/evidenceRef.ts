/**
 * Evidence refs are tagged by the rule that produced them ("page:", "target:",
 * "status:", "element:", "verified:", "considered:", "nav:") or are a bare URL.
 * Anything that renders them — the opportunity page, the proposal draft — needs
 * the same reading of that tag, so it lives here rather than in either.
 */
const REF_LABELS: Record<string, string> = {
  page: "Page",
  target: "Link target",
  status: "HTTP status",
  element: "Element",
  verified: "Fetched to verify",
  considered: "Near-match considered",
};

export interface DescribedRef {
  /** Human label for the tag, or null when the ref was untagged. */
  label: string | null;
  /** The ref with its tag removed. */
  value: string;
  /** The value when it is a real, linkable URL. */
  href: string | null;
}

export function describeEvidenceRef(ref: string): DescribedRef {
  const match = /^([a-z]+):(.*)$/.exec(ref);
  const tag = match?.[1];
  const known = tag !== undefined && REF_LABELS[tag] !== undefined;
  const value = known ? match![2]! : ref;
  return {
    label: known ? REF_LABELS[tag!]! : null,
    value,
    href: /^https?:\/\//i.test(value) ? value : null,
  };
}

/** One line for a plain-text / Markdown list. */
export function formatEvidenceRef(ref: string): string {
  const { label, value } = describeEvidenceRef(ref);
  return label ? `${label}: ${value}` : value;
}
