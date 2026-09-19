// src/core/threshold.ts
var EVIDENCE_THRESHOLD = {
  /** The site must actually have been crawled to a meaningful degree. */
  minPages: 3,
  /** Deterministic pre-AI signal strength floor. */
  minRawConfidence: 0.5,
  /** The detection must cite something. */
  minEvidenceRefs: 1
};
function passesEvidenceThreshold(candidate, evidence) {
  if (candidate.ruleId === "visual-conversion-opportunity") {
    const review = evidence.visualReview;
    return Boolean(review && review.status !== "unavailable" && candidate.evidenceRefs.some((ref) => ref.startsWith("visual:") && review.screenshots.some((s) => `visual:${s.id}` === ref)));
  }
  if (candidate.conversionDefect) {
    return candidate.rawConfidence >= 0.7 && candidate.evidenceRefs.length >= 2 && Boolean(candidate.conversionDefect.pageUrl);
  }
  if (isTechnicalRuleId2(candidate.ruleId)) {
    const hasReadablePage = evidence.site.pages.some(
      (page) => page.status >= 200 && page.status < 300 && page.wordCount > 0
    );
    return hasReadablePage && candidate.rawConfidence >= 0.7 && candidate.evidenceRefs.length >= 2;
  }
  return evidence.site.pages.length >= EVIDENCE_THRESHOLD.minPages && candidate.rawConfidence >= EVIDENCE_THRESHOLD.minRawConfidence && candidate.evidenceRefs.length >= EVIDENCE_THRESHOLD.minEvidenceRefs;
}
__name(passesEvidenceThreshold, "passesEvidenceThreshold");
