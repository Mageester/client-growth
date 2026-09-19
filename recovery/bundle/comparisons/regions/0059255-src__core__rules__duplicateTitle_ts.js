// src/core/rules/duplicateTitle.ts
async function detectDuplicateTitleDiagnostic(ctx) {
  const groups = /* @__PURE__ */ new Map();
  for (const page of uniquePages(ctx.evidence.site.pages)) {
    if (!isReadablePage(page)) continue;
    const title2 = page.title.trim();
    const key = normalizedTitle(title2);
    if (!key) continue;
    const pages = groups.get(key) ?? [];
    pages.push({ url: page.url, title: title2 });
    groups.set(key, pages);
  }
  return [...groups.entries()].filter(([, pages]) => pages.length > 1).map(([key, pages]) => {
    const first = pages[0];
    const urls = pages.map((page) => page.url);
    return legacyDiagnosticDraft({
      detectorId: "duplicate-title",
      problemType: "duplicate_page_title",
      subject: { kind: "element", key },
      observation: `The title "${first.title}" is repeated on ${pages.length} readable pages: ${urls.join(", ")}.`,
      legacyEvidenceRefs: [
        ...urls.map((url) => `page:${url}`),
        `title:${first.title}`
      ]
    });
  });
}
__name(detectDuplicateTitleDiagnostic, "detectDuplicateTitleDiagnostic");
