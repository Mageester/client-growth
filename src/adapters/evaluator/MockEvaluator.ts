import type { EvaluatorInput, OpportunityEvaluator } from "@/ports/OpportunityEvaluator";
import type { Evaluation } from "@/core/schema";
import { titleCase } from "@/core/text";

/**
 * Deterministic, offline evaluator. Default for development and the entire
 * default test suite. Makes no network calls and costs nothing.
 */
export class MockEvaluator implements OpportunityEvaluator {
  evaluate({ candidate }: EvaluatorInput): Promise<Evaluation> {
    if (candidate.ruleId === "missing-service-page") {
      const label = titleCase(candidate.subject);
      return Promise.resolve({
        verdict: "surface",
        confidence: Math.min(0.9, Number((candidate.rawConfidence + 0.1).toFixed(2))),
        rationale:
          `"${label}" is a high-intent service the client actively sells, and the ` +
          `site has no dedicated page for it, so people searching for it land on ` +
          `generic pages and convert poorly. A focused landing page with ` +
          `service-specific proof and a single call to action is well-scoped, ` +
          `individually sellable work.`,
        suggestedScope: [
          `Design and build a dedicated "${label}" landing page`,
          `Service-specific copy: benefits, process, pricing guidance, FAQs`,
          `On-page SEO targeting "${candidate.subject}" and local variants`,
          `Primary lead-capture form and call to action`,
          `Internal links from the homepage and main navigation`,
        ],
      });
    }

    if (candidate.ruleId === "broken-conversion-path" && candidate.conversionDefect) {
      const d = candidate.conversionDefect;
      return Promise.resolve({
        verdict: "surface",
        confidence: Math.min(0.9, Number((candidate.rawConfidence + 0.05).toFixed(2))),
        rationale:
          `${d.note} on ${d.pageUrl}. This sits directly on the path a visitor ` +
          `takes to become a lead, so every affected visit is a lost enquiry ` +
          `until it is fixed. The defect is specific and reproducible.`,
        suggestedScope: [
          `Reproduce and confirm the broken element (${d.elementHref || d.target})`,
          `Repair the ${d.kind.replace(/-/g, " ")} and point it at the correct working target`,
          `Test the full conversion path end to end (click → destination → submit → confirmation)`,
          `Check the rest of the site for the same broken element and fix consistently`,
        ],
      });
    }

    return Promise.resolve({
      verdict: "reject",
      confidence: 0,
      rationale: "No mock evaluation is defined for this rule.",
      suggestedScope: [],
    });
  }
}
