import {
  assessAnalysisReadiness,
  type AnalysisReadiness,
  type RuleReadiness,
} from "@/core/analysisReadiness";
import { assessServiceCoverage } from "@/core/absenceVerification";
import { suggestOfferings } from "@/core/offeringSuggestions";
import type { Client, EvidenceBundle, RuleId, Service } from "@/core/schema";

type AnalysisAdmissionReadiness = Pick<AnalysisReadiness, "rules"> & {
  catalog: {
    matched: number;
    rules: Array<{ ruleId: RuleId; serviceId: string | null }>;
  };
};

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

/** The first blocker among rules this catalog can actually run. */
export function analysisAdmissionBlocker(
  readiness: AnalysisAdmissionReadiness,
): RuleReadiness | undefined {
  const matchedRuleIds = new Set(
    readiness.catalog.rules.filter((rule) => rule.serviceId !== null).map((rule) => rule.ruleId),
  );
  return (
    readiness.rules.find(
      (rule) => matchedRuleIds.has(rule.ruleId) && rule.state !== "ready",
    ) ?? readiness.rules.find((rule) => rule.state !== "ready")
  );
}

export function analysisAdmissionReason(readiness: AnalysisAdmissionReadiness): string {
  return analysisAdmissionBlocker(readiness)?.reason ?? "No ready analysis rule is available for this client yet.";
}
