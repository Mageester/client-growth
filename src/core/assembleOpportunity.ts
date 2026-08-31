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
    title: `${titleCase(candidate.subject)} — dedicated service page`,
    detected: candidate.detected,
    evidenceRefs: candidate.evidenceRefs,
    rationale: evaluation.rationale,
    suggestedServiceId: service.id,
    suggestedScope: evaluation.suggestedScope,
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
    title: `${titleCase(candidate.subject)} — dedicated service page`,
    detected: candidate.detected,
    evidenceRefs: candidate.evidenceRefs,
    rationale:
      "The agency service this maps to is already covered by the client's " +
      "current contract, so it is not surfaced as a billable upsell.",
    suggestedServiceId: service.id,
    suggestedScope: prior?.suggestedScope ?? [],
    priceMin: service.priceMin,
    priceMax: service.priceMax,
    confidence: candidate.rawConfidence,
    billableStatus: "already_covered",
    status: "already_covered",
    proposalMd: prior?.proposalMd,
    updatedAt: now.toISOString(),
  });
}
