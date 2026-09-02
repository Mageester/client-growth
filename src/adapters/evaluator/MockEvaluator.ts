import type { EvaluatorInput, OpportunityEvaluator } from "@/ports/OpportunityEvaluator";
import type { Candidate, Evaluation } from "@/core/schema";
import { titleCase } from "@/core/text";

/** Defect notes are stored as fragments; a rationale is read as a sentence. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * What the repair actually is, per defect kind. The schema key ("malformed-tel")
 * is an internal identifier and must never reach a proposal scope line.
 */
const REPAIR_VERB: Record<NonNullable<Candidate["conversionDefect"]>["kind"], string> = {
  "dead-conversion-link": "Repair the dead call-to-action link",
  "conversion-page-error": "Restore the page this path leads to",
  "malformed-tel": "Replace the click-to-call link with a dialable number",
  "broken-form-target": "Point the enquiry form at a working submission endpoint",
};

/**
 * Deterministic, offline evaluator. Default for development and the entire
 * default test suite. Makes no network calls and costs nothing.
 *
 * It applies NO commercial judgment and must not be mistaken for it. It ASSERTS
 * `subjectType: "distinct_service"` for every missing-service-page candidate
 * rather than deciding it, which is exactly why it will happily price a landing
 * page for "fully insured" (see the judgment cases in the benchmark). Its value
 * is that it is deterministic and free, so the rest of the suite can test the
 * pipeline without a provider; its judgment layer is a stub, and the benchmark
 * records what that stub costs.
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
        subjectType: "distinct_service",
        commerciallyActionable: true,
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
          `${sentence(d.note)} on ${d.pageUrl}. This sits directly on the path a visitor ` +
          `takes to become a lead, so every affected visit is a lost enquiry ` +
          `until it is fixed. The defect is specific and reproducible.`,
        subjectType: "conversion_defect",
        commerciallyActionable: true,
        suggestedScope: [
          `Reproduce and confirm the broken element (${d.elementHref || d.target})`,
          `${REPAIR_VERB[d.kind]} and re-point it at the correct working target`,
          `Test the full conversion path end to end (click → destination → submit → confirmation)`,
          `Check the rest of the site for the same broken element and fix consistently`,
        ],
      });
    }

    return Promise.resolve({
      verdict: "reject",
      confidence: 0,
      rationale: "No mock evaluation is defined for this rule.",
      subjectType: "ambiguous",
      commerciallyActionable: false,
      suggestedScope: [],
    });
  }
}
