// src/core/rules/missingTitle.ts
async function detectMissingTitleDiagnostic(ctx) {
  return uniquePages(ctx.evidence.site.pages).filter((page) => isReadablePage(page) && page.title.trim() === "").map(
    (page) => legacyDiagnosticDraft({
      detectorId: "missing-title",
      problemType: "missing_page_title",
      subject: { kind: "page", key: page.url },
      observation: `The page ${page.url} has no non-empty HTML title element.`,
      legacyEvidenceRefs: [`page:${page.url}`, "title:missing"]
    })
  );
}
__name(detectMissingTitleDiagnostic, "detectMissingTitleDiagnostic");
