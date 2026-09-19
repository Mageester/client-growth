// src/core/rules/deterministicEvaluation.ts
function deterministicEvaluationFor(candidate) {
  if (candidate.ruleId === "no-service-pages") {
    return {
      verdict: "surface",
      // The rules' own evidence strength, which is also what the live evaluator
      // uses — the model is never asked for a confidence number.
      confidence: candidate.rawConfidence,
      rationale: "The exhaustive crawl found no dedicated page for any confirmed service line. A visitor searching for one specific offering therefore has no focused page to land on, compare and act from. Dedicated service pages would provide that path.",
      // The closest the taxonomy has: this is real, sellable work rather than a
      // claim about the business. The subject is the site rather than one service,
      // which is why the finding is raised once and not once per offering.
      subjectType: "distinct_service",
      commerciallyActionable: true,
      suggestedScope: [
        "One page per service line the business sells",
        "Service-specific copy for each: what it covers, who it is for, what it costs",
        "On-page SEO per page, targeting the service and its local variants",
        "A lead-capture call to action on every page",
        "Navigation and internal links so the pages can actually be reached"
      ]
    };
  }
  if (!isTechnicalRuleId2(candidate.ruleId)) return null;
  return {
    verdict: "surface",
    confidence: candidate.rawConfidence,
    // The detection is already a literal parser/crawl fact. The explanation is
    // deliberately separate so the client-facing proposal does not repeat the
    // same URL-heavy sentence under both headings.
    rationale: technicalRationaleFor(candidate.ruleId),
    commerciallyActionable: true,
    suggestedScope: technicalScope(candidate.ruleId)
  };
}
__name(deterministicEvaluationFor, "deterministicEvaluationFor");
var TECHNICAL_SCOPES = {
  "missing-title": ["Add one non-empty HTML title to the reported page."],
  "duplicate-title": ["Give each reported page a distinct HTML title."],
  "thin-service-page": ["Expand the reported service page with clear, substantive copy."],
  "missing-h1": ["Add one descriptive H1 heading to the reported page."],
  "broken-internal-link": ["Repair or remove the reported same-site link that returns 404/410."],
  "missing-meta-description": ["Add a non-empty meta description to the reported page."],
  "missing-structured-data": ["Add the appropriate LocalBusiness or Service structured-data type to the reported page."],
  "missing-image-alt": ['Add alt attributes to the reported images, leaving decorative alt="" images unchanged.']
};
var TECHNICAL_RATIONALES = {
  "missing-title": "A page without a title gives search engines and prospective clients no clear label for the page in results or browser tabs.",
  "duplicate-title": "When multiple pages share one title, search engines and visitors get less context about which page matches their intent.",
  "thin-service-page": "A service page with very little substantive copy gives a prospective client little evidence that the business handles the job.",
  "missing-h1": "A descriptive H1 gives visitors and assistive technology a clear name for the page's main subject.",
  "broken-internal-link": "A link that returns 404 or 410 sends a visitor to a dead end instead of the page the site promised.",
  "missing-meta-description": "Without a meta description, the site has no controlled summary to present for the page in search results.",
  "missing-structured-data": "The appropriate structured-data type gives search engines machine-readable context about the business or service described on the page.",
  "missing-image-alt": "Images without alt text leave people using screen readers without the information those images may communicate."
};
function technicalRationaleFor(ruleId) {
  return TECHNICAL_RATIONALES[ruleId];
}
__name(technicalRationaleFor, "technicalRationaleFor");
function technicalScope(ruleId) {
  return TECHNICAL_SCOPES[ruleId];
}
__name(technicalScope, "technicalScope");
