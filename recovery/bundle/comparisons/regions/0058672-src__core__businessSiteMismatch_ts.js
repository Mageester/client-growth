// src/core/businessSiteMismatch.ts
async function buildExternalMismatchCandidates(input) {
  if (!input.coverage.analyzable) return [];
  const service = serviceForRule(input.catalog, "landing-page");
  if (!service) return [];
  const now2 = input.now ?? /* @__PURE__ */ new Date();
  const current = resolveCurrentExternalClaims(input.claims, now2).filter(
    (claim2) => claim2.semanticState === "accepted" && significantTokens(claim2.normalizedLabel).length > 0
  );
  if (current.length === 0) return [];
  const allOfferings = [
    ...input.client.offerings,
    ...current.map((claim2) => claim2.normalizedLabel)
  ];
  const budget3 = input.budget ?? { remaining: 12 };
  const candidates = [];
  for (const claim2 of current) {
    const verification = await verifyOfferingAbsence({
      offering: claim2.normalizedLabel,
      allOfferings,
      evidence: input.evidence,
      fetchPage: input.fetchPage,
      budget: budget3
    });
    if (verification.conclusion !== "absent") continue;
    const pageCount = input.evidence.site.pages.length;
    const coverageFactor = Math.min(1, pageCount / 8);
    const rawConfidence = Math.min(
      0.8,
      0.45 + coverageFactor * 0.2 + (verification.closeMatches.length === 0 ? 0.1 : 0)
    );
    candidates.push({
      ruleId: "missing-service-page",
      subject: claim2.normalizedLabel,
      detected: `The official business profile lists "${claim2.rawServiceLabel}", but targeted website verification found no dedicated page for it. The profile evidence was retrieved from ${claim2.sourceUrl}. ${verification.reason}`,
      evidenceRefs: [
        `external:${claim2.sourceUrl}`,
        ...input.evidence.site.pages.map((page) => `page:${page.url}`),
        ...verification.inspectedUrls.map((url) => `verified:${url}`),
        ...verification.closeMatches.filter((match) => match.url).map((match) => `considered:${match.url}`)
      ],
      rawConfidence,
      suggestedServiceId: service.id,
      verification
    });
  }
  return candidates;
}
__name(buildExternalMismatchCandidates, "buildExternalMismatchCandidates");
