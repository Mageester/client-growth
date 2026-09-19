// src/core/rules/missingImageAlt.ts
async function detectMissingImageAltDiagnostic(ctx) {
  return uniquePages(ctx.evidence.site.pages).filter((page) => {
    if (!isReadablePage(page) || page.images === void 0) return false;
    return page.images.some((image) => image.alt === void 0);
  }).map((page) => {
    const missing = page.images.filter((image) => image.alt === void 0).length;
    return legacyDiagnosticDraft({
      detectorId: "missing-image-alt",
      problemType: "missing_image_text_alternative",
      subject: { kind: "page", key: page.url },
      observation: `The page ${page.url} contains ${missing} image${missing === 1 ? "" : "s"} without an alt attribute; decorative alt="" images are excluded.`,
      // The count is keyed by the page that carries the images. A bare
      // `images-without-alt:<n>` is keyed by VALUE, so aggregating several
      // pages drops one of two pages that carry the same number of unlabelled
      // images and leaves the survivor beside a page it did not come from.
      legacyEvidenceRefs: [`page:${page.url}`, imageAltCountRef(page.url, missing)]
    });
  });
}
__name(detectMissingImageAltDiagnostic, "detectMissingImageAltDiagnostic");
