import type { EvidenceProvider } from "@/ports/EvidenceProvider";
import type { OpportunityEvaluator } from "@/ports/OpportunityEvaluator";
import type {
  BillabilityStatus,
  Candidate,
  Client,
  Coverage,
  Opportunity,
  Service,
} from "@/core/schema";
import { runRules } from "@/core/rules";
import { passesEvidenceThreshold } from "@/core/threshold";
import { resolveBillability } from "@/core/billability";
import { dedupeKey } from "@/core/dedupe";
import {
  assembleCoveredOpportunity,
  assembleOpportunity,
} from "@/core/assembleOpportunity";

/**
 * Pipeline order (deliberate — cost control is structural):
 *
 *   1. deterministic rules
 *   2. evidence threshold            -> drop thin candidates before any spend
 *   3. resolve billability           -> is the mapped service already covered?
 *   4. suppress                      -> prior decision (dismiss/cover/snooze)
 *                                       OR already-covered work
 *   5. ONLY THEN call the evaluator  -> never judge work we cannot sell
 */

export interface AnalyzeClientInput {
  client: Client;
  catalog: Service[];
  coverage: Coverage[];
  evidenceProvider: EvidenceProvider;
  evaluator: OpportunityEvaluator;
  /** Persisted opportunities/decisions for this client (injected, not a DB handle). */
  existing?: Opportunity[];
  now?: Date;
  maxAiCalls?: number;
}

export interface AnalyzeClientStats {
  candidates: number;
  passedEvidenceThreshold: number;
  suppressedByPriorDecision: number;
  suppressedByCoverage: number;
  evaluated: number;
  rejectedByEvaluator: number;
  surfaced: number;
  aiCalls: number;
}

export interface AnalyzeClientResult {
  /** Billable, surfaced opportunities (status new / proposal_prepared). */
  opportunities: Opportunity[];
  /** Kept but not resurfaced: covered, dismissed, or actively snoozed. */
  suppressed: Opportunity[];
  stats: AnalyzeClientStats;
}

const CONFIDENCE_FLOOR = 0.5;

function isSuppressed(opp: Opportunity, now: Date): boolean {
  if (opp.status === "dismissed" || opp.status === "already_covered") return true;
  if (opp.status === "snoozed") {
    return !opp.snoozeUntil || opp.snoozeUntil > now.toISOString();
  }
  return false;
}

function reconcile(prior: Opportunity | undefined, fresh: Opportunity): Opportunity {
  if (!prior) return fresh;
  if (prior.status === "proposal_prepared") {
    return { ...fresh, id: prior.id, status: "proposal_prepared", proposalMd: prior.proposalMd };
  }
  return { ...fresh, id: prior.id };
}

export async function analyzeClient(
  input: AnalyzeClientInput,
): Promise<AnalyzeClientResult> {
  const now = input.now ?? new Date();
  const maxAiCalls = input.maxAiCalls ?? 10;
  const existingByKey = new Map((input.existing ?? []).map((o) => [o.dedupeKey, o]));

  const stats: AnalyzeClientStats = {
    candidates: 0,
    passedEvidenceThreshold: 0,
    suppressedByPriorDecision: 0,
    suppressedByCoverage: 0,
    evaluated: 0,
    rejectedByEvaluator: 0,
    surfaced: 0,
    aiCalls: 0,
  };

  // 1. deterministic rules
  const evidence = await input.evidenceProvider.getEvidence(input.client);
  const candidates = runRules({
    client: input.client,
    catalog: input.catalog,
    evidence,
  });
  stats.candidates = candidates.length;

  // 2. evidence threshold
  const strong = candidates.filter((c) => passesEvidenceThreshold(c, evidence));
  stats.passedEvidenceThreshold = strong.length;

  const suppressed: Opportunity[] = [];
  const pending: Array<{
    candidate: Candidate;
    billableStatus: BillabilityStatus;
    prior: Opportunity | undefined;
  }> = [];

  for (const candidate of strong) {
    const key = dedupeKey(input.client.id, candidate.ruleId, candidate.subject);
    const prior = existingByKey.get(key);

    // 4a. prior agency decision wins — no evaluator call
    if (prior && isSuppressed(prior, now)) {
      suppressed.push(prior);
      stats.suppressedByPriorDecision++;
      continue;
    }

    // 3. resolve billability / existing coverage
    const billableStatus = resolveBillability(candidate.suggestedServiceId, input.coverage);

    // 4b. already-covered work is recorded but never judged by the evaluator
    if (billableStatus === "already_covered") {
      const service = input.catalog.find((s) => s.id === candidate.suggestedServiceId);
      if (service) {
        suppressed.push(
          assembleCoveredOpportunity({
            candidate,
            service,
            clientId: input.client.id,
            now,
            prior,
          }),
        );
      }
      stats.suppressedByCoverage++;
      continue;
    }

    pending.push({ candidate, billableStatus, prior });
  }

  // 5. evaluator runs only for remaining billable candidates, capped
  const opportunities: Opportunity[] = [];
  for (const { candidate, billableStatus, prior } of pending) {
    if (stats.aiCalls >= maxAiCalls) break;
    stats.aiCalls++;
    stats.evaluated++;

    const evaluation = await input.evaluator.evaluate({
      candidate,
      client: input.client,
      evidence,
    });

    if (evaluation.verdict === "reject" || evaluation.confidence < CONFIDENCE_FLOOR) {
      stats.rejectedByEvaluator++;
      continue;
    }

    const service = input.catalog.find((s) => s.id === candidate.suggestedServiceId);
    if (!service) continue;

    const fresh = assembleOpportunity({
      candidate,
      evaluation,
      billableStatus,
      service,
      clientId: input.client.id,
      now,
    });
    opportunities.push(reconcile(prior, fresh));
  }
  stats.surfaced = opportunities.length;

  return { opportunities, suppressed, stats };
}
