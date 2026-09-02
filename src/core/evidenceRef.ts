/**
 * The vocabulary of `evidenceRefs`.
 *
 * Rules record provenance as tagged strings — `page:https://…`, `status:404`,
 * `element:tel:call us today` — because the tag is what makes a bare value
 * meaningful later. Anything that shows a ref to a human has to read the tag
 * first: rendering the raw string produced dead links like `href="status:404"`
 * in the evidence panel and lines like `- status:404` in a proposal that an
 * agency was expected to send to their client.
 *
 * Parsing lives here so the panel and the proposal cannot drift apart.
 */

export const EVIDENCE_REF_KINDS = [
  /** A page the crawl read. */
  "page",
  /** The broken element's own href — the proof for a malformed value. */
  "element",
  /** Where a conversion element pointed. */
  "target",
  /** The HTTP status observed for that target. */
  "status",
  /** A page fetched specifically to confirm an offering was absent. */
  "verified",
  /** A near-match page that was considered and ruled out. */
  "considered",
  /** A navigation label that was checked. */
  "nav",
] as const;

export type EvidenceRefKind = (typeof EVIDENCE_REF_KINDS)[number] | "unknown";

export interface ParsedEvidenceRef {
  kind: EvidenceRefKind;
  /** The value after the tag, or the whole ref when it was untagged. */
  value: string;
  /** Set only when `value` is a real http(s) URL, so it is safe to link. */
  url: string | null;
}

/** Refs that name a page the analysis actually looked at. */
const PAGE_KINDS = new Set<EvidenceRefKind>(["page", "verified", "considered"]);

/** Refs that describe the defect itself rather than a page. */
const DEFECT_KINDS = new Set<EvidenceRefKind>(["element", "target", "status"]);

export function isPageRef(ref: ParsedEvidenceRef): boolean {
  return PAGE_KINDS.has(ref.kind) || (ref.kind === "unknown" && ref.url !== null);
}

export function isDefectRef(ref: ParsedEvidenceRef): boolean {
  return DEFECT_KINDS.has(ref.kind);
}

function httpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const KNOWN = new Set<string>(EVIDENCE_REF_KINDS);

export function parseEvidenceRef(raw: string): ParsedEvidenceRef {
  const ref = raw.trim();
  const direct = httpUrl(ref);
  if (direct) return { kind: "page", value: ref, url: direct };

  // Only the first colon separates the tag; the value may itself contain one
  // ("element:tel:call us today").
  const split = /^([a-z]+):([\s\S]*)$/.exec(ref);
  if (split && KNOWN.has(split[1]!)) {
    const value = split[2]!;
    return { kind: split[1] as EvidenceRefKind, value, url: httpUrl(value) };
  }
  return { kind: "unknown", value: ref, url: null };
}

/** A plain-English line for one ref, for proposals and any other prose output. */
export function describeEvidenceRef(ref: ParsedEvidenceRef): string {
  switch (ref.kind) {
    case "status":
      return `Server response: HTTP ${ref.value}`;
    case "target":
      return `Link target: ${ref.value}`;
    case "element":
      return `Broken element: ${ref.value}`;
    case "verified":
      return `${ref.value} (fetched to confirm)`;
    case "considered":
      return `${ref.value} (considered and ruled out)`;
    case "nav":
      return `Navigation entry: ${ref.value}`;
    default:
      return ref.value;
  }
}
