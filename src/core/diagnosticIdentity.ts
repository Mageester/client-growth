import { crawlKey } from "@/adapters/evidence/urlPolicy";
import { documentIdentity } from "@/core/pageIdentity";

const ELEMENT_LOCAL_KEY_PATTERN = /^[a-z][a-z0-9-]*(?::[a-z0-9-]+)+$/i;

export function canonicalSubjectLocator(value: string): string {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return crawlKey(parsed).toLowerCase();
  } catch {
    // Keep bounded non-URL subject keys as supplied.
  }
  return trimmed.replace(/\s+/g, " ").toLowerCase();
}

export function elementSubjectParts(key: string): { pageUrl: string; localKey: string } | null {
  const hash = key.indexOf("#");
  if (hash <= 0) return null;
  const pageUrl = key.slice(0, hash);
  const localKey = key.slice(hash + 1);
  if (!/^https?:\/\//i.test(pageUrl) || !ELEMENT_LOCAL_KEY_PATTERN.test(localKey)) return null;
  return { pageUrl, localKey };
}

export function diagnosticSubjectIdentity(subject: { kind: string; key: string }): string {
  if (subject.kind === "element") {
    const parts = elementSubjectParts(subject.key);
    if (parts) return `${documentIdentity(parts.pageUrl)}|element:${parts.localKey.toLowerCase()}`;
  }
  return canonicalSubjectLocator(subject.key);
}
