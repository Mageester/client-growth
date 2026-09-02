import type { EvidenceProvider } from "@/ports/EvidenceProvider";
import type { OpportunityEvaluator } from "@/ports/OpportunityEvaluator";
import type {
  BillabilityStatus,
  Candidate,
  Client,
  Coverage,
  EvidenceBundle,
  Opportunity,
  Service,
} from "@/core/schema";
import { runRules } from "@/core/rules";
import { assessCatalogCoverage, type CatalogCoverage } from "@/core/rules/registry";
import { assessServiceCoverage, type CoverageAssessment } from "@/core/absenceVerification";
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
  /** Cap on targeted GETs across absence verification for this run. Default 12. */
  maxVerifyFetches?: number;
  /** Cap on status probes across broken-conversion-path for this run. Default 8. */
  maxProbes?: number;
}

export interface AnalyzeClientStats {
  candidates: number;
  passedEvidenceThreshold: number;
  suppressedByPriorDecision: number;
  suppressedByCoverage: number;
  evaluated: number;
  rejectedByEvaluator: number;
  /** Evaluator threw (unreachable provider, malformed output). Failed closed. */
  evaluatorErrors: number;
  surfaced: number;
  aiCalls: number;
}

export interface AnalyzeClientResult {
  /** Billable, surfaced opportunities (status new / proposal_prepared). */
  opportunities: Opportunity[];
  /** Kept but not resurfaced: covered, dismissed, or actively snoozed. */
  suppressed: Opportunity[];
  /** The evidence the run was based on (for caching and display). */
  evidence: EvidenceBundle;
  /**
   * Whether the crawl demonstrably reached the site's service section. When
   * `analyzable` is false, no rules run, no AI is called, and nothing is claimed
   * missing.
   */
  coverage: CoverageAssessment;
  /**
   * Which of today's rules this agency's catalog can reach. With none matched
   * no rule runs at all, so callers must not read an empty result as "the site
   * is fine".
   */
  catalogCoverage: CatalogCoverage;
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
    evaluatorErrors: 0,
    surfaced: 0,
    aiCalls: 0,
  };

  const evidence = await input.evidenceProvider.getEvidence(input.client);

  // 0. crawl service-coverage assessment. This gates missing-service-page (it
  //    must not claim a page is missing from a crawl that never reached the
  //    service section) but NOT broken-conversion-path, whose evidence is a
  //    concrete probed defect independent of service-page coverage.
  const coverage = assessServiceCoverage({ client: input.client, evidence });

  // 1. deterministic rules (+ deterministic absence verification / probes —
  //    never AI)
  const fetchPage = input.evidenceProvider.fetchPage?.bind(input.evidenceProvider);
  const probe = input.evidenceProvider.probe?.bind(input.evidenceProvider);
  const candidates = await runRules({
    client: input.client,
    catalog: input.catalog,
    evidence,
    coverage,
    fetchPage,
    verifyBudget: { remaining: input.maxVerifyFetches ?? 12 },
    probe,
    probeBudget: { remaining: input.maxProbes ?? 8 },
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

    // 3. resolve billability / existing coverage
    const billableStatus = resolveBillability(candidate.suggestedServiceId, input.coverage);

    // 4a. Contract coverage is authoritative over a prior state. This keeps a
    // direct coverage change and the next re-analysis in agreement.
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

    // 4b. A prior agency decision wins when the work is still billable — no
    // evaluator call. An expired snooze is intentionally not suppressed.
    if (prior && isSuppressed(prior, now)) {
      suppressed.push(prior);
      stats.suppressedByPriorDecision++;
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

    let evaluation;
    try {
      evaluation = await input.evaluator.evaluate({
        candidate,
        client: input.client,
        evidence,
      });
    } catch (err) {
      // Fail closed: an unreachable provider or malformed model output must
      // never produce an opportunity.
      stats.evaluatorErrors++;
      console.error(
        `[analyzeClient] evaluator failed for "${candidate.subject}": ${
          err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        }`,
      );
      continue;
    }

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

  return {
    opportunities,
    suppressed,
    evidence,
    coverage,
    catalogCoverage: assessCatalogCoverage(input.catalog),
    stats,
  };
}
