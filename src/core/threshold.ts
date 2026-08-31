import type { Candidate, EvidenceBundle } from "@/core/schema";

/**
 * Evidence threshold. A candidate must clear this before it is allowed to reach
 * billability resolution or the evaluator. "Low evidence = no opportunity."
 */
export const EVIDENCE_THRESHOLD = {
  /** The site must actually have been crawled to a meaningful degree. */
  minPages: 3,
  /** Deterministic pre-AI signal strength floor. */
  minRawConfidence: 0.5,
  /** The detection must cite something. */
  minEvidenceRefs: 1,
} as const;

export function passesEvidenceThreshold(
  candidate: Candidate,
  evidence: EvidenceBundle,
): boolean {
  // A concrete, observed defect (broken-conversion-path) is its own evidence —
  // it does not depend on how much of the site was crawled. It must still cite
  // the exact element + target/status.
  if (candidate.conversionDefect) {
    return (
      candidate.rawConfidence >= 0.7 &&
      candidate.evidenceRefs.length >= 2 &&
      Boolean(candidate.conversionDefect.pageUrl)
    );
  }

  return (
    evidence.site.pages.length >= EVIDENCE_THRESHOLD.minPages &&
    candidate.rawConfidence >= EVIDENCE_THRESHOLD.minRawConfidence &&
    candidate.evidenceRefs.length >= EVIDENCE_THRESHOLD.minEvidenceRefs
  );
}
