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
import { deterministicEvaluationFor } from "@/core/rules/deterministicEvaluation";
import {
  canReconcileTechnicalRule,
  isTechnicalRuleId,
  technicalSubjectWasRevisited,
  type TechnicalRuleId,
} from "@/core/rules/technical";
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
  /** Cap on status probes across broken-link rules for this run. Default 8. */
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
  /** Surfaced findings the client did not already have open. See `newlyFound`. */
  newlyFound: number;
  /** Surfaced findings that were already open before this run. */
  stillOpen: number;
  aiCalls: number;
}

export interface AnalyzeClientResult {
  /** Billable, surfaced opportunities (status new / proposal_prepared). */
  opportunities: Opportunity[];
  /**
   * The subset of `opportunities` this client did not already have open — a
   * first-time detection, or one that was resolved and has genuinely come back.
   * Recurring monitoring announces exactly these; anything already known is not
   * news, however many times it is re-detected.
   */
  newlyFound: Opportunity[];
  /** The subset of `opportunities` that was already open before this run. */
  stillOpen: Opportunity[];
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
  // A sold finding is finished work, and re-surfacing it would do two kinds of
  // damage at once: it would put work the agency has already been paid for back
  // into their queue as an upsell, and the re-analysis would overwrite the sale
  // record with a fresh "new" row, destroying the only measurement of what this
  // agency actually converts.
  //
  // `lost` is equally terminal: the client saw the pitch and declined. And
  // `dismissed` is the agency's own recorded rejection. None of these may be
  // re-litigated by a crawler.
  if (opp.status === "sold" || opp.status === "lost") return true;
  if (opp.status === "dismissed" || opp.status === "already_covered") return true;
  if (opp.status === "snoozed") {
    return !opp.snoozeUntil || opp.snoozeUntil > now.toISOString();
  }
  return false;
}

/**
 * Carry the prior row's commercial state onto a freshly assembled finding.
 *
 * A re-detection must never un-write a sales decision: an accepted finding
 * stays accepted, a pitched one stays pitched, a proposal keeps its text — and
 * every funnel milestone survives untouched. A resolved prior is different:
 * its milestones belong to a CLOSED sales cycle, so a genuinely reappeared
 * finding starts fresh rather than inheriting history that never happened to
 * this cycle. Terminal rows (sold/lost/dismissed) never reach here — they are
 * suppressed before evaluation.
 */
function reconcile(prior: Opportunity | undefined, fresh: Opportunity): Opportunity {
  if (!prior) return fresh;
  if (prior.status === "resolved" || prior.status === "superseded") {
    return { ...fresh, id: prior.id };
  }
  if (prior.status === "proposal_prepared") {
    return {
      ...fresh,
      id: prior.id,
      status: "proposal_prepared",
      proposalMd: prior.proposalMd,
      acceptedAt: prior.acceptedAt,
      proposalPreparedAt: prior.proposalPreparedAt,
    };
  }
  if (prior.status === "accepted") {
    return { ...fresh, id: prior.id, status: "accepted", acceptedAt: prior.acceptedAt };
  }
  if (prior.status === "pitched") {
    return {
      ...fresh,
      id: prior.id,
      status: "pitched",
      acceptedAt: prior.acceptedAt,
      pitchedAt: prior.pitchedAt,
    };
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
    newlyFound: 0,
    stillOpen: 0,
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
    // Dismissed page-level rows were folded into canonical aggregate rows by
    // migration. Suppress only their recorded page evidence after the literal
    // rules run, so that an agency's dismissal cannot return as a new site-wide
    // opportunity while non-technical rules remain entirely unaffected.
    technicalSuppressedEvidenceRefsByRule: (input.existing ?? []).reduce<
      Partial<Record<TechnicalRuleId, string[]>>
    >((byRule, opportunity) => {
      if (!isTechnicalRuleId(opportunity.ruleId)) return byRule;
      byRule[opportunity.ruleId] = [
        ...new Set([
          ...(byRule[opportunity.ruleId] ?? []),
          ...opportunity.suppressedEvidenceRefs,
        ]),
      ];
      return byRule;
    }, {}),
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
    // direct coverage change and the next re-analysis in agreement. But a
    // terminal commercial outcome is history, not a coverage state: marking the
    // mapped service covered must not rewrite a recorded sale, a client loss or
    // a dismissal into an "already covered" finding.
    if (billableStatus === "already_covered") {
      if (
        prior &&
        (prior.status === "sold" || prior.status === "lost" || prior.status === "dismissed")
      ) {
        suppressed.push(prior);
        stats.suppressedByPriorDecision++;
        continue;
      }
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
  const newlyFound: Opportunity[] = [];
  const stillOpen: Opportunity[] = [];
  for (const { candidate, billableStatus, prior } of pending) {
    // Some findings have no subject left to classify and carry their own
    // judgment. They are decided before the cap is consulted, because the cap
    // bounds AI spend and these cost nothing — letting a chatty portfolio push
    // a free, fully-evidenced finding off the end of a run would drop it for a
    // reason that has nothing to do with it.
    const deterministic = deterministicEvaluationFor(candidate);

    if (!deterministic && stats.aiCalls >= maxAiCalls) break;

    stats.evaluated++;

    let evaluation;
    if (deterministic) {
      evaluation = deterministic;
    } else {
      stats.aiCalls++;
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
    const opportunity = reconcile(prior, fresh);
    opportunities.push(opportunity);

    // Change detection. "New" is about the agency's knowledge, not the run: a
    // finding they already have open is not news no matter how many times it is
    // re-detected. A finding they had marked resolved and that the site now
    // genuinely shows again IS news — it reuses the same row (same id, same
    // dedupe key), so it becomes actionable again without forking its history.
    if (!prior || prior.status === "resolved") newlyFound.push(opportunity);
    else stillOpen.push(opportunity);
  }
  stats.surfaced = opportunities.length;
  stats.newlyFound = newlyFound.length;
  stats.stillOpen = stillOpen.length;

  const catalogCoverage = assessCatalogCoverage(input.catalog);
  const resolved = reconcileResolved({
    clientId: input.client.id,
    existing: input.existing ?? [],
    candidates,
    catalogCoverage,
    analyzable: coverage.analyzable,
    coverageLimitation: coverage.limitation,
    evidence,
    stats,
    maxAiCalls,
    now,
  });
  stats.resolved = resolved.length;

  return {
    opportunities,
    newlyFound,
    stillOpen,
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
  coverageLimitation: "site-too-thin" | "coverage-limited" | null;
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
    if (
      rule.ruleId === "no-service-pages" &&
      !input.analyzable &&
      input.coverageLimitation !== "site-too-thin"
    ) {
      continue;
    }
    // New technical rules require a complete, field-aware crawl. A missing
    // optional parser field or an internal target absent from the crawl is
    // unknown, so an old finding must remain open.
    if (isTechnicalRuleId(rule.ruleId) && !canReconcileTechnicalRule(rule.ruleId, input.evidence)) {
      continue;
    }
    ranThisTime.add(rule.ruleId);
  }
  if (ranThisTime.size === 0) return [];

  const stillPresent = new Set(
    input.candidates.map((c) => dedupeKey(input.clientId, c.ruleId, c.subject)),
  );

  const resolved: Opportunity[] = [];
  // Eligible: the still-open funnel states only. Terminal commercial outcomes
  // (sold/lost/dismissed) and covered work are never auto-resolved — the
  // reconciliation closes findings the client fixed, and it must never
  // re-classify commercial history in doing so.
  const OPEN_RECONCILABLE: ReadonlySet<Opportunity["status"]> = new Set([
    "new",
    "accepted",
    "proposal_prepared",
    "pitched",
  ]);
  for (const opp of input.existing) {
    if (opp.billableStatus !== "billable") continue;
    if (!OPEN_RECONCILABLE.has(opp.status)) continue;
    // A candidate may be absent solely because its legacy page evidence was
    // intentionally suppressed. That is not proof the client fixed it.
    if (isTechnicalRuleId(opp.ruleId) && opp.suppressedEvidenceRefs.length > 0) continue;
    if (!ranThisTime.has(opp.ruleId)) continue;
    if (stillPresent.has(opp.dedupeKey)) continue;
    if (
      isTechnicalRuleId(opp.ruleId) &&
      !technicalSubjectWasRevisited({
        ruleId: opp.ruleId,
        subject: subjectFromOpportunity(opp),
        evidenceRefs: opp.evidenceRefs,
        evidence: input.evidence,
      })
    ) {
      continue;
    }
    resolved.push({ ...opp, status: "resolved", updatedAt: input.now.toISOString() });
  }
  return resolved;
}

/** Legacy fallback when a technical opportunity has no page evidence to revisit. */
function subjectFromOpportunity(opp: Opportunity): string {
  const target = opp.evidenceRefs
    .find((ref) => ref.startsWith("target:"))
    ?.slice("target:".length);
  if (target) return target;
  const page = opp.evidenceRefs
    .find((ref) => ref.startsWith("page:"))
    ?.slice("page:".length);
  return page ?? opp.title;
}
