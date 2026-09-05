import {
  OpportunitySchema,
  type BillabilityStatus,
  type Candidate,
  type Evaluation,
  type Opportunity,
  type Service,
} from "@/core/schema";
import { dedupeKey } from "@/core/dedupe";
import { titleCase } from "@/core/text";
import { crawlKey } from "@/adapters/evidence/urlPolicy";

/** Opportunity title, per rule. */
function titleFor(candidate: Candidate): string {
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
        const label =
          d.elementText && d.elementText !== "(unlabelled)"
            ? `"${d.elementText}"`
            : "conversion";
        return `Broken ${label} link`;
      }
    }
  }
  // A whole-site finding, whose subject is the domain rather than one service.
  // The default below would title it "Kids-Connect.Ca — dedicated service page",
  // which is both wrong and the headline an agency puts in front of a client.
  if (candidate.ruleId === "no-service-pages") {
    return `${candidate.subject} describes none of its services`;
  }

  const technicalTitle: Partial<Record<Candidate["ruleId"], string>> = {
    "missing-title": "Missing page title",
    "duplicate-title": "Duplicate page title",
    "thin-service-page": "Thin service page",
    "missing-h1": "Missing H1 heading",
    "broken-internal-link": "Broken internal link",
    "missing-meta-description": "Missing meta description",
    "missing-structured-data": "Missing LocalBusiness or Service schema",
    "missing-image-alt": "Missing image alt attribute",
  };
  const technical = technicalTitle[candidate.ruleId];
  if (technical) {
    const prefix = candidate.ruleId === "broken-internal-link" ? "target:" : "page:";
    const count = new Set(
      candidate.evidenceRefs
        .filter((ref) => ref.startsWith(prefix))
        .map((ref) => crawlKey(ref.slice(prefix.length))),
    ).size;
    const noun = prefix === "target:" ? "target" : "page";
    return `${technical} — ${count} ${count === 1 ? noun : `${noun}s`}`;
  }

  return `${titleCase(candidate.subject)} — dedicated service page`;
}

export interface AssembleInput {
  candidate: Candidate;
  evaluation: Evaluation;
  billableStatus: BillabilityStatus;
  service: Service;
  clientId: string;
  now: Date;
}

/** Build a surfaced opportunity from a candidate + its evaluator judgement. */
export function assembleOpportunity(input: AssembleInput): Opportunity {
  const { candidate, evaluation, billableStatus, service, clientId, now } = input;
  const key = dedupeKey(clientId, candidate.ruleId, candidate.subject);

  return OpportunitySchema.parse({
    id: key,
    dedupeKey: key,
    clientId,
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
    updatedAt: now.toISOString(),
  });
}

export interface AssembleCoveredInput {
  candidate: Candidate;
  service: Service;
  clientId: string;
  now: Date;
  prior?: Opportunity;
}

/**
 * Covered work: assembled WITHOUT an evaluator call. We already know it cannot be
 * sold, so we do not spend an AI call judging it. Kept for the "already covered"
 * view, never surfaced as a billable upsell.
 */
export function assembleCoveredOpportunity(input: AssembleCoveredInput): Opportunity {
  const { candidate, service, clientId, now, prior } = input;
  const key = dedupeKey(clientId, candidate.ruleId, candidate.subject);

  return OpportunitySchema.parse({
    id: prior?.id ?? key,
    dedupeKey: key,
    clientId,
    ruleId: candidate.ruleId,
    title: titleFor(candidate),
    detected: candidate.detected,
    evidenceRefs: candidate.evidenceRefs,
    suppressedEvidenceRefs: candidate.suppressedEvidenceRefs ?? prior?.suppressedEvidenceRefs ?? [],
    rationale:
      "The agency service this maps to is already covered by the client's " +
      "current contract, so it is not surfaced as a billable upsell.",
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
    updatedAt: now.toISOString(),
  });
}
