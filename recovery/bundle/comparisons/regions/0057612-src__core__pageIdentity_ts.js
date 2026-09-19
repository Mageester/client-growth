// src/core/pageIdentity.ts
function documentIdentity(pageUrl) {
  try {
    const parsed = new URL(pageUrl.trim());
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${path}`.toLowerCase();
  } catch {
    return pageUrl.trim().replace(/\s+/g, " ").toLowerCase();
  }
}
__name(documentIdentity, "documentIdentity");
function distinctDocumentCount(pageUrls) {
  return new Set(pageUrls.map(documentIdentity)).size;
}
__name(distinctDocumentCount, "distinctDocumentCount");
var THIN_SERVICE_PAGE_WORD_LIMIT = 120;
