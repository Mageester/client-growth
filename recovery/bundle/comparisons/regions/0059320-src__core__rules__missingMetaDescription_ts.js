// src/core/rules/missingMetaDescription.ts
async function detectMissingMetaDescriptionDiagnostic(ctx) {
  return uniquePages(ctx.evidence.site.pages).filter(
    (page) => isReadablePage(page) && page.metaDescription !== void 0 && page.metaDescription.trim() === ""
  ).map(
    (page) => legacyDiagnosticDraft({
      detectorId: "missing-meta-description",
      problemType: "missing_meta_description",
      subject: { kind: "page", key: page.url },
      observation: `The page ${page.url} has no non-empty meta description.`,
      legacyEvidenceRefs: [`page:${page.url}`, "meta-description:missing"]
    })
  );
}
__name(detectMissingMetaDescriptionDiagnostic, "detectMissingMetaDescriptionDiagnostic");
