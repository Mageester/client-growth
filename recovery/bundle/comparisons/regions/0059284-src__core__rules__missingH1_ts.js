// src/core/rules/missingH1.ts
async function detectMissingH1Diagnostic(ctx) {
  return uniquePages(ctx.evidence.site.pages).filter((page) => isReadablePage(page) && page.h1s.length === 0).map(
    (page) => legacyDiagnosticDraft({
      detectorId: "missing-h1",
      problemType: "missing_primary_heading",
      subject: { kind: "page", key: page.url },
      observation: `The page ${page.url} has no non-empty H1 heading.`,
      legacyEvidenceRefs: [`page:${page.url}`, "h1:missing"]
    })
  );
}
__name(detectMissingH1Diagnostic, "detectMissingH1Diagnostic");
