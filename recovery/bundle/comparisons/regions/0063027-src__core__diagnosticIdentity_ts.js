// src/core/diagnosticIdentity.ts
var ELEMENT_LOCAL_KEY_PATTERN = /^[a-z][a-z0-9-]*(?::[a-z0-9-]+)+$/i;
function canonicalSubjectLocator(value) {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return crawlKey(parsed).toLowerCase();
    }
  } catch {
  }
  return trimmed.replace(/\s+/g, " ").toLowerCase();
}
__name(canonicalSubjectLocator, "canonicalSubjectLocator");
function elementSubjectParts(key) {
  const hash = key.indexOf("#");
  if (hash <= 0) return null;
  const pageUrl = key.slice(0, hash);
  if (!/^https?:\/\//i.test(pageUrl)) return null;
  const localKey = key.slice(hash + 1);
  if (!ELEMENT_LOCAL_KEY_PATTERN.test(localKey)) return null;
  return { pageUrl, localKey };
}
__name(elementSubjectParts, "elementSubjectParts");
function diagnosticSubjectIdentity(subject) {
  if (subject.kind === "element") {
    const parts = elementSubjectParts(subject.key);
    if (parts) {
      return `${documentIdentity(parts.pageUrl)}|element:${parts.localKey.toLowerCase()}`;
    }
  }
  return canonicalSubjectLocator(subject.key);
}
__name(diagnosticSubjectIdentity, "diagnosticSubjectIdentity");
