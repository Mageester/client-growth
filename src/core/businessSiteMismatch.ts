import type { PageFetcher } from "@/core/absenceVerification";
import {
  resolveCurrentExternalClaims,
  type ExternalBusinessClaim,
} from "@/core/externalBusinessEvidence";
import { verifyOfferingAbsence, type CoverageAssessment } from "@/core/absenceVerification";
import type { Candidate, Client, EvidenceBundle, Service } from "@/core/schema";
import { significantTokens } from "@/core/text";
import { serviceForRule } from "@/core/rules/registry";

export interface ExternalMismatchInput {
  client: Client;
  catalog: Service[];
  evidence: EvidenceBundle;
  coverage: CoverageAssessment;
  claims: ExternalBusinessClaim[];
  now?: Date;
  fetchPage?: PageFetcher;
  budget?: { remaining: number };
}

/**
 * Compare current authoritative profile claims with the readable website.
 *
 * This is intentionally a candidate builder, not a second findings system. It
 * emits the existing `missing-service-page` candidate, so the normal evidence
 * threshold, billability, evaluator, pricing, dedupe and funnel reconciliation
 * remain authoritative.
 */
export async function buildExternalMismatchCandidates(
  input: ExternalMismatchInput,
): Promise<Candidate[]> {
  if (!input.coverage.analyzable) return [];
  const service = serviceForRule(input.catalog, "landing-page");
  if (!service) return [];

  const now = input.now ?? new Date();
  const current = resolveCurrentExternalClaims(input.claims, now).filter(
    (claim) => claim.semanticState === "accepted" && significantTokens(claim.normalizedLabel).length > 0,
  );
  if (current.length === 0) return [];

  const allOfferings = [
    ...input.client.offerings,
    ...current.map((claim) => claim.normalizedLabel),
  ];
  const budget = input.budget ?? { remaining: 12 };
  const candidates: Candidate[] = [];
  for (const claim of current) {
    const verification = await verifyOfferingAbsence({
      offering: claim.normalizedLabel,
      allOfferings,
      evidence: input.evidence,
      fetchPage: input.fetchPage,
      budget,
    });
    if (verification.conclusion !== "absent") continue;

    const pageCount = input.evidence.site.pages.length;
    const coverageFactor = Math.min(1, pageCount / 8);
    const rawConfidence = Math.min(
      0.8,
      0.45 + coverageFactor * 0.2 + (verification.closeMatches.length === 0 ? 0.1 : 0),
    );
    candidates.push({
      ruleId: "missing-service-page",
      subject: claim.normalizedLabel,
      detected:
        `The official business profile lists "${claim.rawServiceLabel}", but targeted website verification found no dedicated page for it. ` +
        `The profile evidence was retrieved from ${claim.sourceUrl}. ${verification.reason}`,
      evidenceRefs: [
        `external:${claim.sourceUrl}`,
        ...input.evidence.site.pages.map((page) => `page:${page.url}`),
        ...verification.inspectedUrls.map((url) => `verified:${url}`),
        ...verification.closeMatches.filter((match) => match.url).map((match) => `considered:${match.url}`),
      ],
      rawConfidence,
      suggestedServiceId: service.id,
      verification,
    });
  }
  return candidates;
}
