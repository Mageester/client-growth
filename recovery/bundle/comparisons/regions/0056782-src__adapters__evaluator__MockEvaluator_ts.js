// src/adapters/evaluator/MockEvaluator.ts
function sentence(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
__name(sentence, "sentence");
var REPAIR_VERB = {
  "dead-conversion-link": "Repair the dead call-to-action link",
  "conversion-page-error": "Restore the page this path leads to",
  "malformed-tel": "Replace the click-to-call link with a dialable number",
  "broken-form-target": "Point the enquiry form at a working submission endpoint"
};
var MockEvaluator = class {
  static {
    __name(this, "MockEvaluator");
  }
  evaluate({ candidate }) {
    if (candidate.ruleId === "missing-service-page") {
      const label = titleCase(candidate.subject);
      return Promise.resolve({
        verdict: "surface",
        confidence: Math.min(0.9, Number((candidate.rawConfidence + 0.1).toFixed(2))),
        rationale: `"${label}" is a high-intent service the client actively sells, and the site has no dedicated page for it, so people searching for it land on generic pages and convert poorly. A focused landing page with service-specific proof and a single call to action is well-scoped, individually sellable work.`,
        subjectType: "distinct_service",
        commerciallyActionable: true,
        suggestedScope: [
          `Design and build a dedicated "${label}" landing page`,
          `Service-specific copy: benefits, process, pricing guidance, FAQs`,
          `On-page SEO targeting "${candidate.subject}" and local variants`,
          `Primary lead-capture form and call to action`,
          `Internal links from the homepage and main navigation`
        ]
      });
    }
    if (candidate.ruleId === "competitor-service-gap") {
      const label = titleCase(candidate.subject);
      return Promise.resolve({
        verdict: "surface",
        confidence: Math.min(0.9, Number((candidate.rawConfidence + 0.1).toFixed(2))),
        rationale: `Competitors of this client sell "${label}" and give it its own page, while this client has neither a page nor a recorded offering for it. That is a gap a visitor comparing local options sees immediately, and a well-scoped page is individually sellable work.`,
        subjectType: "distinct_service",
        commerciallyActionable: true,
        suggestedScope: [
          `Design and build a dedicated "${label}" page`,
          `Positioning against the competitors already ranking for it`,
          `On-page SEO targeting "${candidate.subject}" and local variants`,
          `Primary lead-capture form and call to action`
        ]
      });
    }
    if (candidate.ruleId === "broken-conversion-path" && candidate.conversionDefect) {
      const d = candidate.conversionDefect;
      return Promise.resolve({
        verdict: "surface",
        confidence: Math.min(0.9, Number((candidate.rawConfidence + 0.05).toFixed(2))),
        rationale: `${sentence(d.note)} on ${d.pageUrl}. This sits directly on the path a visitor takes to become a lead, so every affected visit is a lost enquiry until it is fixed. The defect is specific and reproducible.`,
        subjectType: "conversion_defect",
        commerciallyActionable: true,
        suggestedScope: [
          `Reproduce and confirm the broken element (${d.elementHref || d.target})`,
          `${REPAIR_VERB[d.kind]} and re-point it at the correct working target`,
          `Test the full conversion path end to end (click \u2192 destination \u2192 submit \u2192 confirmation)`,
          `Check the rest of the site for the same broken element and fix consistently`
        ]
      });
    }
    return Promise.resolve({
      verdict: "reject",
      confidence: 0,
      rationale: "No mock evaluation is defined for this rule.",
      subjectType: "ambiguous",
      commerciallyActionable: false,
      suggestedScope: []
    });
  }
};
