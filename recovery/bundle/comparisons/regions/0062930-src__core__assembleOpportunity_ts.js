// src/core/assembleOpportunity.ts
function titleFor(candidate) {
  if (candidate.ruleId === "visual-conversion-opportunity") return candidate.visualTitle ?? "Improve the customer journey";
  const d = candidate.conversionDefect;
  if (d) {
    switch (d.kind) {
      case "malformed-tel":
        return "Broken click-to-call link";
      case "broken-form-target":
        return "Broken form submission path";
      case "conversion-page-error":
        return `${titleCase(d.elementText || "Conversion page")} returns an error`;
      default: {
        const label = d.elementText && d.elementText !== "(unlabelled)" ? `"${d.elementText}"` : "conversion";
        return `Broken ${label} link`;
      }
    }
  }
  if (candidate.ruleId === "no-service-pages") {
    return `${candidate.subject} has no dedicated service pages`;
  }
  const technicalTitle = {
    "missing-title": "Missing page title",
    "duplicate-title": "Duplicate page title",
    "thin-service-page": "Thin service page",
    "missing-h1": "Missing H1 heading",
    "broken-internal-link": "Broken internal link",
    "missing-meta-description": "Missing meta description",
    "missing-structured-data": "Missing LocalBusiness or Service schema",
    "missing-image-alt": "Missing image alt attribute"
  };
  const technical = technicalTitle[candidate.ruleId];
  if (technical) {
    const prefix = candidate.ruleId === "broken-internal-link" ? "target:" : "page:";
    const count5 = new Set(
      candidate.evidenceRefs.filter((ref) => ref.startsWith(prefix)).map((ref) => crawlKey(ref.slice(prefix.length)))
    ).size;
    const noun = prefix === "target:" ? "target" : "page";
    return `${technical} \u2014 ${count5} ${count5 === 1 ? noun : `${noun}s`}`;
  }
  return `${titleCase(candidate.subject)} \u2014 dedicated service page`;
}
__name(titleFor, "titleFor");
function assembleOpportunity(input) {
  const { candidate, evaluation, billableStatus, service, clientId: clientId2, now: now2 } = input;
  const key = dedupeKey(clientId2, candidate.ruleId, candidate.subject);
  return OpportunitySchema.parse({
    id: key,
    dedupeKey: key,
    clientId: clientId2,
    ruleId: candidate.ruleId,
    title: titleFor(candidate),
    detected: candidate.detected,
    evidenceRefs: candidate.evidenceRefs,
    suppressedEvidenceRefs: candidate.suppressedEvidenceRefs ?? [],
    rationale: evaluation.rationale,
    suggestedServiceId: service.id,
    suggestedScope: evaluation.suggestedScope,
    verification: candidate.verification,
    conversionDefect: candidate.conversionDefect,
    priceMin: service.priceMin,
    priceMax: service.priceMax,
    confidence: evaluation.confidence,
    billableStatus,
    status: "new",
    updatedAt: now2.toISOString()
  });
}
__name(assembleOpportunity, "assembleOpportunity");
function assembleCoveredOpportunity(input) {
  const { candidate, service, clientId: clientId2, now: now2, prior } = input;
  const key = dedupeKey(clientId2, candidate.ruleId, candidate.subject);
  return OpportunitySchema.parse({
    id: prior?.id ?? key,
    dedupeKey: prior?.dedupeKey ?? key,
    clientId: clientId2,
    ruleId: candidate.ruleId,
    title: titleFor(candidate),
    detected: candidate.detected,
    evidenceRefs: candidate.evidenceRefs,
    suppressedEvidenceRefs: candidate.suppressedEvidenceRefs ?? prior?.suppressedEvidenceRefs ?? [],
    rationale: "The agency service this maps to is already covered by the client's current contract, so it is not surfaced as a billable upsell.",
    suggestedServiceId: service.id,
    suggestedScope: prior?.suggestedScope ?? [],
    verification: candidate.verification,
    conversionDefect: candidate.conversionDefect,
    priceMin: service.priceMin,
    priceMax: service.priceMax,
    confidence: candidate.rawConfidence,
    billableStatus: "already_covered",
    status: "already_covered",
    proposalMd: prior?.proposalMd,
    updatedAt: now2.toISOString()
  });
}
__name(assembleCoveredOpportunity, "assembleCoveredOpportunity");
