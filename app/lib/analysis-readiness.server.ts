import { assessServiceCoverage } from "@/core/absenceVerification";
import { assessAnalysisReadiness, type AnalysisReadiness } from "@/core/analysisReadiness";
import { suggestOfferings } from "@/core/offeringSuggestions";
import type { Client, EvidenceBundle, Service } from "@/core/schema";

/**
 * One place that turns stored evidence into a readiness answer.
 *
 * Before this existed, the client page, the client action, onboarding's loader
 * and onboarding's action each derived their own version of "can this run?" —
 * and they disagreed. The client page asked per-rule readiness what to SAY and
 * then asked service coverage what to DO, so a site that had been read from end
 * to end was described as unreadable and refused a run that three of its rules
 * were ready for.
 *
 * Coverage is still assessed; it is just demoted to what it always was — the
 * evidence one rule needs, passed in as an input rather than consulted as a
 * verdict. Everything downstream reads `AnalysisReadiness` and nothing else.
 */
export function analysisReadinessForClient(input: {
  client: Client;
  catalog: Service[];
  evidence: EvidenceBundle | null;
}): AnalysisReadiness {
  const coverage = input.evidence
    ? assessServiceCoverage({ client: input.client, evidence: input.evidence })
    : null;
  const readablePages = input.evidence
    ? input.evidence.site.pages.filter(
        (page) => page.status >= 200 && page.status < 300 && page.wordCount > 0,
      ).length
    : 0;
  const suggestedOfferings = input.evidence
    ? suggestOfferings({
        evidence: input.evidence,
        existingOfferings: input.client.offerings,
        max: 8,
      }).length
    : 0;

  return assessAnalysisReadiness({
    catalog: input.catalog,
    offerings: input.client.offerings.length,
    // Absent, not false: a client that has never been crawled has an unknown
    // site, and an unknown site must not be reported as a limited one.
    lastCrawl: input.evidence
      ? {
          analyzable: coverage?.analyzable ?? false,
          readablePages,
          suggestedOfferings,
          limitation: coverage?.limitation ?? null,
        }
      : undefined,
  });
}
