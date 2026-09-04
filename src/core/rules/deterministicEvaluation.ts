import type { Candidate, Evaluation } from "@/core/schema";
import { isTechnicalRuleId, type TechnicalRuleId } from "@/core/rules/technical";

/**
 * Findings that have nothing left for a model to judge.
 *
 * The evaluator exists to classify a SUBJECT: is "heat pump installation" a
 * real service line this business sells, or a trust claim like "fully insured"
 * that would otherwise become a priced landing page? That is a genuine
 * judgment, and the rules cannot make it.
 *
 * `no-service-pages` has no such subject. Its subject is the client's domain,
 * and its claim — an exhaustive crawl read the whole site and none of it
 * describes a service — is a fact the rules established before the candidate
 * existed. Handing it to a model asks "is kids-connect.ca a distinct service
 * line?", which is a category error, and it went wrong in both directions:
 * MockEvaluator has no branch for the rule and rejected every one of them, and
 * a live provider would be asked to invent a rationale for a question that
 * makes no sense — text that is copied verbatim into a client-facing proposal
 * draft.
 *
 * So these rules carry their own judgment, deterministically. Returning null
 * means "this candidate does need a model", which remains true for the
 * commercial service-page and conversion-path rules.
 *
 * This is not a way to skip scrutiny. A deterministic evaluation is only
 * correct where the rule has already proven the whole claim; adding one for a
 * rule that infers rather than observes would be removing the check that stops
 * a guess reaching an agency's client.
 */
export function deterministicEvaluationFor(candidate: Candidate): Evaluation | null {
  if (candidate.ruleId === "no-service-pages") {
    return {
      verdict: "surface",
      // The rules' own evidence strength, which is also what the live evaluator
      // uses — the model is never asked for a confidence number.
      confidence: candidate.rawConfidence,
      rationale:
        "The site does not describe any of the services this business sells, so anyone " +
        "searching for one of them arrives on a page that never mentions it. Pages for " +
        "each service line give that traffic somewhere to land and something to act on.",
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
        "Navigation and internal links so the pages can actually be reached",
      ],
    };
  }

  if (!isTechnicalRuleId(candidate.ruleId)) return null;

  return {
    verdict: "surface",
    confidence: candidate.rawConfidence,
    // The detection is already a literal parser/crawl fact. Keeping it as the
    // rationale avoids a model inventing a claimed outcome such as SEO uplift.
    rationale: candidate.detected,
    commerciallyActionable: true,
    suggestedScope: technicalScope(candidate.ruleId),
  };
}

const TECHNICAL_SCOPES: Record<TechnicalRuleId, string[]> = {
  "missing-title": ["Add one non-empty HTML title to the reported page."],
  "duplicate-title": ["Give each reported page a distinct HTML title."],
  "thin-service-page": ["Expand the reported service page with clear, substantive copy."],
  "missing-h1": ["Add one descriptive H1 heading to the reported page."],
  "broken-internal-link": ["Repair or remove the reported same-site link that returns 404/410."],
  "missing-meta-description": ["Add a non-empty meta description to the reported page."],
  "missing-structured-data": ["Add the appropriate LocalBusiness or Service structured-data type to the reported page."],
  "missing-image-alt": ["Add alt attributes to the reported images, leaving decorative alt=\"\" images unchanged."],
};

function technicalScope(ruleId: TechnicalRuleId): string[] {
  return TECHNICAL_SCOPES[ruleId];
}
