import { assessAnalysisReadiness, type AnalysisReadiness } from "@/core/analysisReadiness";
import { assessServiceCoverage } from "@/core/absenceVerification";
import { suggestOfferings } from "@/core/offeringSuggestions";
import type { Client, EvidenceBundle, Service } from "@/core/schema";

/** Builds the route admission state from the current client, catalog, and crawl evidence. */
export function analysisReadinessForClient(input: {
  client: Client;
  catalog: Service[];
  evidence: EvidenceBundle | null;
}): AnalysisReadiness {
  const coverage = input.evidence
    ? assessServiceCoverage({ client: input.client, evidence: input.evidence })
    : null;
  const readablePages = input.evidence
    ? input.evidence.site.pages.filter((page) => page.status >= 200 && page.status < 300 && page.wordCount > 0)
        .length
    : 0;
  const suggestedOfferings = input.evidence
    ? suggestOfferings({ evidence: input.evidence, existingOfferings: input.client.offerings, max: 8 }).length
    : 0;

  return assessAnalysisReadiness({
    catalog: input.catalog,
    offerings: input.client.offerings.length,
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
