export function documentIdentity(pageUrl: string): string {
  try {
    const parsed = new URL(pageUrl.trim());
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${path}`.toLowerCase();
  } catch {
    return pageUrl.trim().replace(/\s+/g, " ").toLowerCase();
  }
}

export function distinctDocumentCount(pageUrls: readonly string[]): number {
  return new Set(pageUrls.map(documentIdentity)).size;
}

export const THIN_SERVICE_PAGE_WORD_LIMIT = 120;
