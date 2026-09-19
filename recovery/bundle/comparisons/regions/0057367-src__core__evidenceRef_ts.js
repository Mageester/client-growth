// src/core/evidenceRef.ts
var EVIDENCE_REF_KINDS = [
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
  /** An owner-authorized external business-profile source. */
  "external",
  "visual",
  /** Typed-ledger aliases for observed link/form/probe records. */
  "link",
  "form",
  "probe"
];
function httpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
__name(httpUrl, "httpUrl");
var KNOWN = new Set(EVIDENCE_REF_KINDS);
function parseEvidenceRef(raw) {
  const ref = raw.trim();
  const direct = httpUrl(ref);
  if (direct) return { kind: "page", value: ref, url: direct };
  const split = /^([a-z]+):([\s\S]*)$/.exec(ref);
  if (split && KNOWN.has(split[1])) {
    const value = split[2];
    return { kind: split[1], value, url: httpUrl(value) };
  }
  return { kind: "unknown", value: ref, url: null };
}
__name(parseEvidenceRef, "parseEvidenceRef");
function wordCountRef(pageUrl, wordCount) {
  return `word-count:${pageUrl}=${wordCount}`;
}
__name(wordCountRef, "wordCountRef");
function parseWordCountRef(ref) {
  const match = /^word-count:(.+)=(\d+)$/i.exec(ref.trim());
  if (!match) return null;
  return { pageUrl: match[1], wordCount: Number.parseInt(match[2], 10) };
}
__name(parseWordCountRef, "parseWordCountRef");
function imageAltCountRef(pageUrl, count5) {
  return `images-without-alt:${pageUrl}=${count5}`;
}
__name(imageAltCountRef, "imageAltCountRef");
function parseImageAltCountRef(ref) {
  const match = /^images-without-alt:(.+)=(\d+)$/i.exec(ref.trim());
  if (!match) return null;
  return { pageUrl: match[1], count: Number.parseInt(match[2], 10) };
}
__name(parseImageAltCountRef, "parseImageAltCountRef");
