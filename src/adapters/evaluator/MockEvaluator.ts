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

    return Promise.resolve({
      verdict: "reject",
      confidence: 0,
      rationale: "No mock evaluation is defined for this rule.",
      suggestedScope: [],
    });
  }
}
