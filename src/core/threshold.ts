import type { Candidate, EvidenceBundle } from "@/core/schema";
import { isTechnicalRuleId } from "@/core/rules/technical";

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

  // The expanded technical rules carry exact parser/probe references just as
  // conversion defects do. They still need a readable page, two references,
  // and a strong deterministic signal, but a one-page site should not lose a
  // directly observed missing title or alt ATTRIBUTE solely to the broad
  // crawl-depth floor used by inferred service findings.
  if (isTechnicalRuleId(candidate.ruleId)) {
    const hasReadablePage = evidence.site.pages.some(
      (page) => page.status >= 200 && page.status < 300 && page.wordCount > 0,
    );
    return (
      hasReadablePage &&
      candidate.rawConfidence >= 0.7 &&
      candidate.evidenceRefs.length >= 2
    );
  }

  return (
    evidence.site.pages.length >= EVIDENCE_THRESHOLD.minPages &&
    candidate.rawConfidence >= EVIDENCE_THRESHOLD.minRawConfidence &&
    candidate.evidenceRefs.length >= EVIDENCE_THRESHOLD.minEvidenceRefs
  );
}
