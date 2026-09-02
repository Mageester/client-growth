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
import { judge } from "@/core/judgment";
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
  /** Judged and not surfaced: rejected verdict, or failed the judgment gate. */
  rejectedByEvaluator: number;
  /** Evaluator threw (unreachable provider, malformed output). Failed closed. */
  evaluatorErrors: number;
  /** Previously-open findings this run re-checked and no longer sees. */
  resolved: number;
  surfaced: number;
  aiCalls: number;
}

export interface AnalyzeClientResult {
  /** Billable, surfaced opportunities (status new / proposal_prepared). */
  opportunities: Opportunity[];
  /** Kept but not resurfaced: covered, dismissed, or actively snoozed. */
  suppressed: Opportunity[];
  /**
   * Previously-open findings this run re-checked and no longer sees — the client
   * fixed them. Empty whenever the run was not in a position to tell.
   */
  resolved: Opportunity[];
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
    resolved: 0,
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

    // The commercial gate. A candidate surfaces only when the evaluator
    // positively identifies it as distinct, actionable work; an unclassified,
    // ambiguous or non-service subject fails closed here. See core/judgment.ts.
    const decision = judge(candidate, evaluation);
    if (!decision.surface) {
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

  const catalogCoverage = assessCatalogCoverage(input.catalog);
  const resolved = reconcileResolved({
    clientId: input.client.id,
    existing: input.existing ?? [],
    candidates,
    catalogCoverage,
    analyzable: coverage.analyzable,
    evidence,
    stats,
    maxAiCalls,
    now,
  });
  stats.resolved = resolved.length;

  return {
    opportunities,
    suppressed,
    resolved,
    evidence,
    coverage,
    catalogCoverage,
    stats,
  };
}

/**
 * Close out findings the client has actually fixed.
 *
 * Re-analysis only ever upserted what it found, so a repaired 404 CTA stayed
 * `new` and `billable` forever: it kept counting toward the client's open
 * opportunities and toward "estimated potential value", and the agency had no
 * way to tell a live gap from one they had already talked the client through.
 *
 * The dangerous version of this is a run that resolves everything because it
 * could not look. So a rule's findings are only eligible when THAT rule
 * demonstrably ran and completed this time:
 *
 *   - the catalog still matches it (a deactivated service means it never ran);
 *   - for missing-service-page, the crawl reached the service section;
 *   - the site was actually readable;
 *   - no evaluator error and no call-cap truncation left candidates unjudged.
 *
 * Presence is tested against ALL candidates, before the evidence threshold, so a
 * defect whose evidence merely got thinner is not mistaken for one that is gone.
 * Agency decisions are never overwritten — a dismissed or covered finding stays
 * exactly as the agency left it.
 */
function reconcileResolved(input: {
  clientId: string;
  existing: Opportunity[];
  candidates: Candidate[];
  catalogCoverage: CatalogCoverage;
  analyzable: boolean;
  evidence: EvidenceBundle;
  stats: AnalyzeClientStats;
  maxAiCalls: number;
  now: Date;
}): Opportunity[] {
  const readSomething = input.evidence.site.pages.some(
    (page) => page.status >= 200 && page.status < 300 && page.wordCount > 0,
  );
  const complete =
    input.stats.evaluatorErrors === 0 && input.stats.aiCalls < input.maxAiCalls;
  if (!readSomething || !complete) return [];

  const ranThisTime = new Set<string>();
  for (const rule of input.catalogCoverage.rules) {
    if (rule.serviceId === null) continue;
    if (rule.ruleId === "missing-service-page" && !input.analyzable) continue;
    ranThisTime.add(rule.ruleId);
  }
  if (ranThisTime.size === 0) return [];

  const stillPresent = new Set(
    input.candidates.map((c) => dedupeKey(input.clientId, c.ruleId, c.subject)),
  );

  const resolved: Opportunity[] = [];
  for (const opp of input.existing) {
    if (opp.billableStatus !== "billable") continue;
    if (opp.status !== "new" && opp.status !== "proposal_prepared") continue;
    if (!ranThisTime.has(opp.ruleId)) continue;
    if (stillPresent.has(opp.dedupeKey)) continue;
    resolved.push({ ...opp, status: "resolved", updatedAt: input.now.toISOString() });
  }
  return resolved;
}
