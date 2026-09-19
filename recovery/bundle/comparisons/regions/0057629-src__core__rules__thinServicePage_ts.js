// src/core/rules/thinServicePage.ts
async function detectThinServicePageDiagnostic(ctx) {
  return uniquePages(ctx.evidence.site.pages).filter(
    (page) => isReadablePage(page) && isServiceShapedPage(page.url) && page.wordCount < THIN_SERVICE_PAGE_WORD_LIMIT
  ).map(
    (page) => legacyDiagnosticDraft({
      detectorId: "thin-service-page",
      problemType: "thin_service_content",
      subject: { kind: "page", key: page.url },
      observation: `The service page ${page.url} contains ${page.wordCount} words, below the ${THIN_SERVICE_PAGE_WORD_LIMIT}-word observation threshold.`,
      legacyEvidenceRefs: [`page:${page.url}`, wordCountRef(page.url, page.wordCount)]
    })
  );
}
__name(detectThinServicePageDiagnostic, "detectThinServicePageDiagnostic");
