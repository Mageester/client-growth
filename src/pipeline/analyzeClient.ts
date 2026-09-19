import { z } from "zod";
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
import type { InsightSnapshot } from "@/core/insightSchema";
import type { VisualFinding, VisualReview } from "@/core/visualSchema";
import type { CriticDecision, ProblemDraft } from "@/core/siteUnderstandingSchema";
import type { ExternalBusinessClaim } from "@/core/externalBusinessEvidence";
import { buildExternalMismatchCandidates } from "@/core/businessSiteMismatch";
import { runRules } from "@/core/rules";
import { runDiagnosticRun } from "@/core/rules/broadDetectors";
import { candidateFromDiagnostic } from "@/core/diagnosticCompatibility";
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
import {
  diagnosticFromVisualFinding,
  matchingVisualPrior,
  validateVisualFindings,
  visualCandidate,
  visualEvaluation,
  visualSubject,
} from "@/core/visualReview";
import { RenderBudget, BudgetUsageSchema, InsightAccountingSchema } from "@/core/analysisAccounting";
import { buildInsightSnapshot } from "@/core/insightSnapshot";
import { assertShadowArtifacts } from "@/core/problemSynthesis";
import { buildPublishedFindings } from "@/core/findingPublication";
import {
  INSIGHT_DEFINITIONS,
  INSIGHT_PROBLEM_TYPES,
  MODEL_ANCHORED_PROBLEM_TYPES,
} from "@/core/insightTaxonomy";
import {
  InsightCriticResultSchema,
  SiteUnderstandingInputSchema,
  SiteUnderstandingResultSchema,
  validateCriticDecisionsWithRepair,
  validateProblemDrafts,
} from "@/core/siteUnderstandingSchema";

type SiteUnderstandingResult = z.infer<typeof SiteUnderstandingResultSchema>;
type InsightCriticResult = z.infer<typeof InsightCriticResultSchema>;

interface ModelCallBudget {
  reserve(label: string, count: number): boolean;
}

interface SiteUnderstandingRunner {
  understand(
    input: unknown,
    options: {
      maxDrafts: number;
      signal?: AbortSignal;
      budget?: ModelCallBudget;
    },
  ): Promise<SiteUnderstandingResult>;
}

interface InsightCriticRunner {
  critique(
    input: unknown,
    options: { signal?: AbortSignal; budget?: ModelCallBudget },
  ): Promise<InsightCriticResult>;
}

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

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new DOMException("The analysis was cancelled", "AbortError");
}

class SharedModelCallBudget implements ModelCallBudget {
  readonly limit: number;
  private usedCount: number;
  private attemptedCount: number;
  private skippedCount = 0;
  private cappedCount = 0;

  constructor(limit: number, initialUsed = 0, initialAttempted = initialUsed) {
    this.limit = Math.max(0, Math.floor(limit));
    this.usedCount = Math.max(0, Math.min(this.limit, Math.floor(initialUsed)));
    this.attemptedCount = Math.max(this.usedCount, Math.floor(initialAttempted));
  }

  get used(): number { return this.usedCount; }
  get attempted(): number { return this.attemptedCount; }
  get remaining(): number { return Math.max(0, this.limit - this.usedCount); }
  get skipped(): number { return this.skippedCount; }
  get capped(): number { return this.cappedCount; }

  reserve(_label: string, count: number): boolean {
    const normalized = Math.max(0, Math.floor(count));
    if (normalized === 0) return true;
    this.attemptedCount += normalized;
    if (normalized > this.remaining) {
      this.skippedCount += normalized;
      this.cappedCount += normalized;
      return false;
    }
    this.usedCount += normalized;
    return true;
  }

  skip(count = 1): void {
    const normalized = Math.max(0, Math.floor(count));
    if (normalized === 0) return;
    this.attemptedCount += normalized;
    this.skippedCount += normalized;
    this.cappedCount += normalized;
  }

  settle(reserved: number, actual: number): void {
    const held = Math.max(0, Math.floor(reserved));
    const observed = Math.max(0, Math.floor(actual));
    if (observed === held) return;
    if (observed < held) {
      const released = held - observed;
      this.usedCount = Math.max(0, this.usedCount - released);
      this.attemptedCount = Math.max(this.usedCount, this.attemptedCount - released);
      return;
    }
    const overrun = observed - held;
    this.attemptedCount += overrun;
    this.cappedCount += overrun;
    this.usedCount = Math.min(this.limit, this.usedCount + overrun);
  }
}

function uniqueLimitations(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 100);
}

function subtypeDefinitions() {
  return INSIGHT_PROBLEM_TYPES.map((problemType) => {
    const definition = INSIGHT_DEFINITIONS[problemType];
    return {
      id: problemType,
      subtypeId: problemType,
      version: "1",
      problemType,
      category: definition.category,
      claimKind: definition.claimKind,
      minimumGrade: definition.minimumGrade,
      requiresCompleteCoverage: definition.requiresCompleteCoverage,
      requiresCounterEvidence: definition.requiresCounterEvidence,
      projectWorkstream: definition.projectWorkstream,
      legacyRuleId: definition.legacyRuleId,
      reconciliationPolicy: definition.reconciliationPolicy,
      eligibleEvidenceKinds: [],
      capabilityIntent: [definition.projectWorkstream],
      deliverableIds: [],
      description: definition.description,
      priority: definition.priority,
      modelAnchored: MODEL_ANCHORED_PROBLEM_TYPES.has(problemType),
    };
  });
}

function buildSiteUnderstandingInput(client: Client, catalog: Service[], snapshot: InsightSnapshot) {
  return SiteUnderstandingInputSchema.parse({
    clientId: client.id,
    clientFacts: {
      clientId: client.id,
      name: client.name,
      domain: client.domain,
      offerings: client.offerings,
      notes: client.notes,
    },
    evidence: snapshot.evidence,
    diagnostics: snapshot.diagnostics,
    categories: snapshot.categories,
    capabilities: catalog.filter((service) => service.active).map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      deliverableIds: service.tags,
      deliverables: [service.name],
      intent: service.tags.join(", "),
      serviceId: service.id,
    })),
    subtypeDefinitions: subtypeDefinitions(),
  });
}

function failureKind(limitation: string): "malformed" | "timedOut" | "cancelled" | "failed" {
  if (/truncat|malformed|invalid json|not (?:valid )?json|contract|completion shape|empty|grounding|canonical|taxonomy|subtype|draft/i.test(limitation)) return "malformed";
  if (/timed.?out/i.test(limitation)) return "timedOut";
  if (/cancel/i.test(limitation)) return "cancelled";
  return "failed";
}

function canonicalizeUnderstandingResult(result: SiteUnderstandingResult, source: unknown, maxDrafts: number): SiteUnderstandingResult {
  if (result.status === "unavailable" && result.drafts.length === 0) return result;
  const validated = validateProblemDrafts(source, result.drafts, maxDrafts);
  const rejectedDrafts = result.rejectedDrafts + validated.rejectedDrafts;
  const status = validated.drafts.length > 0 && rejectedDrafts > 0
    ? "partial"
    : validated.drafts.length > 0 || rejectedDrafts === 0
      ? "complete"
      : "unavailable";
  return SiteUnderstandingResultSchema.parse({
    ...result,
    status,
    drafts: validated.drafts,
    rejectedDrafts,
    limitations: uniqueLimitations([...result.limitations, ...validated.limitations]),
  });
}

function modelAccountingState(
  understanding: SiteUnderstandingResult | undefined,
  critic: InsightCriticResult | undefined,
  budget: SharedModelCallBudget,
): z.infer<typeof InsightAccountingSchema>["modelShadow"]["state"] {
  if (!understanding) return budget.skipped > 0 ? "blocked" : "unassessed";
  if (understanding.status === "unavailable") return "unavailable";
  if (understanding.status === "partial") return "partial";
  if (understanding.drafts.length === 0) return "complete";
  if (!critic) return budget.skipped > 0 ? "blocked" : "unavailable";
  return critic.status === "complete" && understanding.status === "complete"
    ? "complete"
    : critic.status === "partial" ? "partial" : "unavailable";
}

function budgetUsage(limit: number, used: number, attempted = used, capped = false, capReason?: string) {
  const safeLimit = Math.max(0, Math.floor(limit));
  const safeUsed = Math.max(0, Math.min(safeLimit, Math.floor(used)));
  const safeAttempted = Math.max(safeUsed, Math.floor(attempted));
  return BudgetUsageSchema.parse({
    limit: safeLimit,
    used: safeUsed,
    remaining: safeLimit - safeUsed,
    attempted: safeAttempted,
    capped,
    ...(capped ? { capReason: capReason ?? "The run budget was capped." } : {}),
  });
}

function isVisualCatalogService(service: Service): boolean {
  return service.active && (
    service.tags.includes("visual-review") ||
    service.tags.includes("landing-page") ||
    service.tags.includes("service-pages-build") ||
    service.tags.includes("conversion-fix") ||
    service.tags.includes("competitor-gap") ||
    /web(?:site)? design|redesign|conversion|ux|user experience/i.test(service.name)
  );
}

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
  /** Current owner-authorized external profile claims, if the client supplied one. */
  externalClaims?: ExternalBusinessClaim[];
  /** Optional run identity used by the recovered evidence and accounting layers. */
  workspaceId?: string;
  runId?: string;
  signal?: AbortSignal;
  onStage?: (stage: "crawling" | "rendering" | "analyzing") => void | Promise<void>;
  renderBudget?: RenderBudget;
  visualReviewMaxCalls?: number;
  visualReviewUnavailableReason?: string;
  visualReview?: (
    evidence: EvidenceBundle,
    onAnalysisStart: () => Promise<void>,
    renderBudget: RenderBudget,
  ) => Promise<VisualReview>;
  visualReviewProviderCalls?: () => number;
  siteUnderstanding?: SiteUnderstandingRunner;
  insightCritic?: InsightCriticRunner;
  maxShadowDrafts?: number;
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
  /** Model work requested but withheld by the shared run budget. */
  budgetSkipped?: number;
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
  /** Recovered typed snapshot and publication artifacts, when enabled. */
  insightSnapshot?: InsightSnapshot;
  shadowDrafts?: ProblemDraft[];
  criticDecisions?: CriticDecision[];
  stageDurations?: Record<string, number>;
  findings?: ReturnType<typeof buildPublishedFindings>["findings"];
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
  if (
    fresh.ruleId === "visual-conversion-opportunity" &&
    ["accepted", "proposal_prepared", "pitched"].includes(prior.status)
  ) {
    fresh = {
      ...fresh,
      suggestedServiceId: prior.suggestedServiceId,
      suggestedScope: prior.suggestedScope,
      priceMin: prior.priceMin,
      priceMax: prior.priceMax,
    };
  }
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
      proposalMd: prior.proposalMd,
      acceptedAt: prior.acceptedAt,
      proposalPreparedAt: prior.proposalPreparedAt,
      pitchedAt: prior.pitchedAt,
      // A visibly corrected sold/lost outcome returns to pitched, but its
      // terminal values remain audit history. Re-analysis must not erase them.
      soldAt: prior.soldAt,
      soldAmount: prior.soldAmount,
      lostAt: prior.lostAt,
    };
  }
  return { ...fresh, id: prior.id };
}

async function analyzeClientLegacy(
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
  const verifyBudget = { remaining: input.maxVerifyFetches ?? 12 };
  const ruleCandidates = await runRules({
    client: input.client,
    catalog: input.catalog,
    evidence,
    coverage,
    fetchPage,
    verifyBudget,
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
  // External profile evidence is another deterministic input to the same
  // candidate pipeline. It cannot rescue an unreadable/incomplete crawl and it
  // cannot bypass absence verification, thresholds, billability, judgment or
  // reconciliation. Reusing the existing rule id also keeps one opportunity
  // identity when a client profile and an official profile name the same gap.
  const externalCandidates = await buildExternalMismatchCandidates({
    client: input.client,
    catalog: input.catalog,
    evidence,
    coverage,
    claims: input.externalClaims ?? [],
    now,
    fetchPage,
    budget: verifyBudget,
  });
  const candidateByKey = new Map<string, Candidate>();
  for (const candidate of [...ruleCandidates, ...externalCandidates]) {
    const key = dedupeKey(input.client.id, candidate.ruleId, candidate.subject);
    if (!candidateByKey.has(key)) candidateByKey.set(key, candidate);
  }
  const candidates = [...candidateByKey.values()];
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

    // Exhausted budget: skip only the candidates that would cost a call.
    // Later free, fully-evidenced findings still get processed — the cap
    // bounds AI spend, it does not cancel the rest of the run.
    if (!deterministic && stats.aiCalls >= maxAiCalls) continue;

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
 * Recovered production orchestration. The legacy implementation above remains
 * as a compatibility reference while this path restores the typed diagnostic,
 * visual, shadow-model, accounting, and publication stages observed in the
 * production bundle.
 */
export async function analyzeClient(
  input: AnalyzeClientInput,
): Promise<AnalyzeClientResult> {
  const now = input.now ?? new Date();
  const maxAiCalls = input.maxAiCalls ?? 10;
  const renderBudget = input.renderBudget ?? new RenderBudget(
    input.runId ?? `analysis:${input.client.id}:${Date.now()}`,
    3,
  );
  const existingByKey = new Map((input.existing ?? []).map((opportunity) => [opportunity.dedupeKey, opportunity]));
  let validatedVisualFindings: VisualFinding[] = [];
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
  const modelBudget = new SharedModelCallBudget(maxAiCalls);
  const stageDurations: Record<string, number> = {};

  await input.onStage?.("crawling");
  throwIfAborted(input.signal);
  const evidence = await input.evidenceProvider.getEvidence(input.client);
  throwIfAborted(input.signal);

  const visualStageStarted = Date.now();
  const visualCallBudget = Math.max(1, Math.floor(input.visualReviewMaxCalls ?? 1));
  if (!input.visualReview && input.visualReviewUnavailableReason) {
    evidence.visualReview = {
      status: "unavailable",
      model: "",
      summary: "Visual review is not configured.",
      strengths: [],
      screenshots: [],
      findings: [],
      limitations: [input.visualReviewUnavailableReason],
      accounting: {
        state: "unavailable",
        suggestions: 0,
        accepted: 0,
        rejected: 0,
        truncated: 0,
        capped: false,
        limitations: [input.visualReviewUnavailableReason],
      },
    };
  }
  if (input.visualReview && evidence.visualReview === undefined && !modelBudget.reserve("visual-review", visualCallBudget)) {
    stats.budgetSkipped = (stats.budgetSkipped ?? 0) + visualCallBudget;
    evidence.visualReview = {
      status: "unavailable",
      model: "",
      summary: "Visual review was not run because its AI budget is too small.",
      strengths: [],
      screenshots: [],
      findings: [],
      limitations: [`Allow at least ${visualCallBudget} AI calls per review to inspect and challenge the website evidence.`],
      accounting: {
        state: "unavailable",
        suggestions: 0,
        accepted: 0,
        rejected: 0,
        truncated: 0,
        capped: true,
        capReason: "The shared model-call budget was exhausted before visual review.",
        limitations: [`Allow at least ${visualCallBudget} AI calls per review to inspect and challenge the website evidence.`],
      },
    };
  }
  if (input.visualReview && evidence.visualReview === undefined) {
    await input.onStage?.("rendering");
    try {
      evidence.visualReview = await input.visualReview(
        evidence,
        async () => { await input.onStage?.("analyzing"); },
        renderBudget,
      );
      const actualVisualCalls = Math.max(
        0,
        Math.floor(input.visualReviewProviderCalls?.() ?? evidence.visualReview.providerCalls ?? visualCallBudget),
      );
      modelBudget.settle(visualCallBudget, actualVisualCalls);
      const visualMode: "shadow" | undefined = input.catalog.some(isVisualCatalogService) ? undefined : "shadow";
      const modernVisualFindings = evidence.visualReview.findings.filter(
        (finding) => (finding.visualEvidence?.length ?? 0) > 0 || (finding.evidence?.length ?? 0) > 0,
      );
      const legacyVisualFindings = evidence.visualReview.findings.filter(
        (finding) => (finding.visualEvidence?.length ?? 0) === 0 && (finding.evidence?.length ?? 0) === 0,
      );
      const validatedModern = validateVisualFindings(
        modernVisualFindings,
        evidence.visualReview.screenshots,
        evidence.renderedPages ?? [],
        input.catalog,
        { mode: visualMode, maxFindings: 3, requireExactReferences: true },
      );
      const validatedLegacy = validateVisualFindings(
        legacyVisualFindings,
        evidence.visualReview.screenshots,
        evidence.renderedPages ?? [],
        input.catalog,
        { mode: visualMode, maxFindings: 3, requireExactReferences: false },
      );
      const seenVisualSubjects = new Set<string>();
      validatedVisualFindings = [...validatedModern, ...validatedLegacy]
        .filter((finding) => {
          const subject = visualSubject(finding);
          if (seenVisualSubjects.has(subject)) return false;
          seenVisualSubjects.add(subject);
          return true;
        })
        .slice(0, 3);
      evidence.visualReview.findings = validatedVisualFindings;
      if (evidence.visualReview.status === "unavailable") stats.evaluatorErrors++;
    } catch (error) {
      if (input.signal?.aborted) throw error;
      stats.evaluatorErrors++;
      evidence.visualReview = {
        status: "unavailable",
        model: "",
        summary: "Visual review could not finish.",
        strengths: [],
        screenshots: [],
        findings: [],
        limitations: ["The visual provider did not return a usable review. Try again; no visual conclusion was made."],
      };
      modelBudget.settle(visualCallBudget, Math.max(0, Math.floor(input.visualReviewProviderCalls?.() ?? 0)));
    }
  }
  stats.aiCalls = modelBudget.used;
  stageDurations.visual = Math.max(0, Date.now() - visualStageStarted);
  await input.onStage?.("analyzing");

  const visualFindings = evidence.visualReview?.status === "unavailable" ? [] : validatedVisualFindings;
  const visualEvaluations = new Map(visualFindings.map((finding) => [visualSubject(finding), visualEvaluation(finding)]));
  const diagnosticsStageStarted = Date.now();
  const coverage = assessServiceCoverage({ client: input.client, evidence });
  const fetchPage = input.evidenceProvider.fetchPage?.bind(input.evidenceProvider);
  const probe = input.evidenceProvider.probe?.bind(input.evidenceProvider);
  const verifyBudget = { remaining: input.maxVerifyFetches ?? 12 };
  const probeBudget = { remaining: input.maxProbes ?? 8 };
  const technicalSuppressedEvidenceRefsByRule = (input.existing ?? []).reduce<Partial<Record<TechnicalRuleId, string[]>>>((byRule, opportunity) => {
    if (!isTechnicalRuleId(opportunity.ruleId)) return byRule;
    byRule[opportunity.ruleId] = [...new Set([...(byRule[opportunity.ruleId] ?? []), ...opportunity.suppressedEvidenceRefs])];
    return byRule;
  }, {});
  const diagnosticRun = await runDiagnosticRun({
    client: input.client,
    catalog: input.catalog,
    evidence,
    coverage,
    probe,
    fetchPage,
    verifyBudget,
    probeBudget,
    technicalSuppressedEvidenceRefsByRule,
  });
  const diagnosticDrafts = diagnosticRun.drafts;
  stageDurations.diagnostics = Math.max(0, Date.now() - diagnosticsStageStarted);
  const visualDiagnosticDrafts = visualFindings.map(diagnosticFromVisualFinding);
  const insightDrafts = [...diagnosticDrafts, ...visualDiagnosticDrafts];
  const ruleCandidates = diagnosticDrafts.flatMap((draft) => {
    const candidate = candidateFromDiagnostic(draft, input.catalog);
    return candidate ? [candidate] : [];
  });
  const externalCandidates = await buildExternalMismatchCandidates({
    client: input.client,
    catalog: input.catalog,
    evidence,
    coverage,
    claims: input.externalClaims ?? [],
    now,
    fetchPage,
    budget: verifyBudget,
  });
  const candidateByKey = new Map<string, Candidate>();
  const publicationVisualFindings = visualFindings.filter(
    (finding) => finding.serviceId !== undefined && input.catalog.some((service) => service.id === finding.serviceId && isVisualCatalogService(service)),
  );
  for (const candidate of [
    ...publicationVisualFindings.map(visualCandidate),
    ...ruleCandidates,
    ...externalCandidates,
  ]) {
    const key = dedupeKey(input.client.id, candidate.ruleId, candidate.subject);
    if (!candidateByKey.has(key)) candidateByKey.set(key, candidate);
  }
  const candidates = [...candidateByKey.values()];
  stats.candidates = candidates.length;
  const strong = candidates.filter((candidate) => passesEvidenceThreshold(candidate, evidence));
  stats.passedEvidenceThreshold = strong.length;

  const suppressed: Opportunity[] = [];
  const pending: Array<{ candidate: Candidate; billableStatus: BillabilityStatus; prior: Opportunity | undefined }> = [];
  const matchedVisualPriors = new Set<string>();
  for (const candidate of strong) {
    const key = dedupeKey(input.client.id, candidate.ruleId, candidate.subject);
    const visualFinding = candidate.ruleId === "visual-conversion-opportunity"
      ? publicationVisualFindings.find((finding) => visualSubject(finding) === candidate.subject)
      : undefined;
    const prior = existingByKey.get(key) ?? (visualFinding ? matchingVisualPrior(visualFinding, input.client.id, input.existing ?? []) : undefined);
    if (visualFinding && prior) {
      if (matchedVisualPriors.has(prior.id)) {
        if (evidence.visualReview) {
          evidence.visualReview.status = "partial";
          evidence.visualReview.limitations.push("An overlapping draft matched the same saved project and was withheld to preserve its history.");
        }
        continue;
      }
      matchedVisualPriors.add(prior.id);
    }
    const billableStatus = resolveBillability(candidate.suggestedServiceId, input.coverage);
    if (billableStatus === "already_covered") {
      if (prior && (prior.status === "sold" || prior.status === "lost" || prior.status === "dismissed")) {
        suppressed.push(prior);
        stats.suppressedByPriorDecision++;
        continue;
      }
      const service = input.catalog.find((item) => item.id === candidate.suggestedServiceId);
      if (service) suppressed.push(assembleCoveredOpportunity({ candidate, service, clientId: input.client.id, now, prior }));
      stats.suppressedByCoverage++;
      continue;
    }
    if (prior && isSuppressed(prior, now)) {
      suppressed.push(prior);
      stats.suppressedByPriorDecision++;
      continue;
    }
    pending.push({ candidate, billableStatus, prior });
  }

  const legacyEvaluatorStageStarted = Date.now();
  const opportunities: Opportunity[] = [];
  const newlyFound: Opportunity[] = [];
  const stillOpen: Opportunity[] = [];
  for (const { candidate, billableStatus, prior } of pending) {
    throwIfAborted(input.signal);
    const deterministic = candidate.ruleId === "visual-conversion-opportunity"
      ? visualEvaluations.get(candidate.subject) ?? null
      : deterministicEvaluationFor(candidate);
    if (!deterministic && !modelBudget.reserve("legacy-evaluator", 1)) {
      stats.budgetSkipped = (stats.budgetSkipped ?? 0) + 1;
      continue;
    }
    stats.evaluated++;
    let evaluation;
    if (deterministic) {
      evaluation = deterministic;
    } else {
      try {
        evaluation = await input.evaluator.evaluate({ candidate, client: input.client, evidence });
        throwIfAborted(input.signal);
      } catch (error) {
        if (input.signal?.aborted) throw error;
        stats.evaluatorErrors++;
        console.error(`[analyzeClient] evaluator failed for "${candidate.subject}": ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
        continue;
      }
    }
    const decision = judge(candidate, evaluation);
    if (!decision.surface) {
      stats.rejectedByEvaluator++;
      continue;
    }
    const service = input.catalog.find((item) => item.id === candidate.suggestedServiceId);
    if (!service) continue;
    const fresh = assembleOpportunity({ candidate, evaluation, billableStatus, service, clientId: input.client.id, now });
    const opportunity = reconcile(prior, fresh);
    opportunities.push(opportunity);
    if (!prior || prior.status === "resolved") newlyFound.push(opportunity);
    else stillOpen.push(opportunity);
  }
  stats.surfaced = opportunities.length;
  stats.newlyFound = newlyFound.length;
  stats.stillOpen = stillOpen.length;
  stageDurations.legacyEvaluator = Math.max(0, Date.now() - legacyEvaluatorStageStarted);

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

  const snapshotWorkspaceId = input.workspaceId ?? `workspace:${input.client.id}`;
  const snapshotRunId = input.runId ?? `analysis:${input.client.id}:${evidence.capturedAt}`;
  const deterministicSnapshot = buildInsightSnapshot({
    workspaceId: snapshotWorkspaceId,
    runId: snapshotRunId,
    clientId: input.client.id,
    coverage,
    bundle: evidence,
    drafts: insightDrafts,
    accounting: diagnosticRun.accounting,
  });

  let understandingResult: SiteUnderstandingResult | undefined;
  let criticResult: InsightCriticResult | undefined;
  let shadowDrafts: ProblemDraft[] = [];
  let criticDecisions: CriticDecision[] = [];
  let modelLimitations: string[] = [];
  let failedCalls = 0;
  let malformedCalls = 0;
  let timedOutCalls = 0;
  let cancelledCalls = 0;
  let understandingCalls = 0;
  let criticCalls = 0;
  let rejectedDrafts = 0;

  const understandingStageStarted = Date.now();
  const maxShadowDrafts = Math.max(0, Math.min(100, Math.floor(input.maxShadowDrafts ?? 20)));
  if (input.siteUnderstanding) {
    if (modelBudget.remaining === 0) {
      modelBudget.skip();
      modelLimitations.push("The shared model-call budget was exhausted before site understanding.");
    } else {
      const before = modelBudget.used;
      let understandingInput: unknown;
      try {
        understandingInput = buildSiteUnderstandingInput(input.client, input.catalog, deterministicSnapshot);
        const result = await input.siteUnderstanding.understand(understandingInput, {
          signal: input.signal,
          maxDrafts: maxShadowDrafts,
          budget: modelBudget,
        });
        const parsed = SiteUnderstandingResultSchema.parse(result);
        const reservationDelta = modelBudget.used - before;
        const unmeteredProvider = parsed.providerCalls > 0 && reservationDelta !== 1;
        const unmeteredDrafts = parsed.providerCalls === 0 && (parsed.drafts.length > 0 || reservationDelta !== 0);
        const overreportedProvider = parsed.providerCalls > 1;
        understandingResult = unmeteredProvider || unmeteredDrafts || overreportedProvider
          ? SiteUnderstandingResultSchema.parse({
              status: "unavailable",
              drafts: [],
              rejectedDrafts: parsed.rejectedDrafts + parsed.drafts.length,
              limitations: [
                ...parsed.limitations,
                unmeteredProvider
                  ? "Grouped understanding returned a provider call without consuming the run reservation exactly once; output was withheld."
                  : overreportedProvider
                    ? "Grouped understanding reported more than one provider call for one run reservation; output was withheld."
                    : "Grouped understanding returned drafts without a metered provider call; drafts were withheld.",
              ],
              providerCalls: 0,
            })
          : canonicalizeUnderstandingResult(parsed, understandingInput, maxShadowDrafts);
        if (understandingResult.drafts.length > 0) {
          try {
            assertShadowArtifacts({
              workspaceId: snapshotWorkspaceId,
              runId: snapshotRunId,
              clientId: input.client.id,
              evidence: deterministicSnapshot.evidence,
              diagnostics: deterministicSnapshot.diagnostics,
              drafts: understandingResult.drafts,
            });
          } catch (error) {
            const limitation = error instanceof Error
              ? `Grouped understanding output failed strict grounding: ${error.message.slice(0, 240)}`
              : "Grouped understanding output failed strict grounding.";
            understandingResult = SiteUnderstandingResultSchema.parse({
              status: "unavailable",
              drafts: [],
              rejectedDrafts: understandingResult.rejectedDrafts + understandingResult.drafts.length,
              limitations: [...understandingResult.limitations, limitation],
              providerCalls: understandingResult.providerCalls,
            });
          }
        }
        shadowDrafts = understandingResult.drafts;
        rejectedDrafts += understandingResult.rejectedDrafts;
        modelLimitations = uniqueLimitations([...modelLimitations, ...understandingResult.limitations]);
        if (understandingResult.providerCalls > 0) {
          understandingCalls++;
          if (understandingResult.status === "unavailable") {
            failedCalls++;
            const kind = failureKind(understandingResult.limitations.join(" "));
            if (kind === "malformed") malformedCalls++;
            if (kind === "timedOut") timedOutCalls++;
            if (kind === "cancelled") cancelledCalls++;
          }
        }
      } catch (error) {
        if (input.signal?.aborted) throw error;
        const metered = modelBudget.used > before;
        const limitation = error instanceof Error
          ? `The grouped understanding stage failed: ${error.message.slice(0, 300)}`
          : "The grouped understanding stage failed.";
        understandingResult = SiteUnderstandingResultSchema.parse({
          status: "unavailable",
          drafts: [],
          rejectedDrafts: 0,
          limitations: [
            limitation,
            ...(metered ? [] : ["Grouped understanding failed without consuming the run reservation; output was withheld."]),
          ],
          providerCalls: metered ? 1 : 0,
        });
        modelLimitations.push(limitation);
        if (metered) {
          understandingCalls++;
          failedCalls++;
          const kind = failureKind(limitation);
          if (kind === "malformed") malformedCalls++;
          if (kind === "timedOut") timedOutCalls++;
          if (kind === "cancelled") cancelledCalls++;
        }
      }
    }
  }
  stageDurations.understanding = Math.max(0, Date.now() - understandingStageStarted);

  const criticStageStarted = Date.now();
  if (shadowDrafts.length > 0 && input.insightCritic) {
    if (modelBudget.remaining === 0) {
      modelBudget.skip();
      modelLimitations.push("The shared model-call budget was exhausted before the insight critic.");
    } else {
      const before = modelBudget.used;
      try {
        const result = await input.insightCritic.critique(
          { evidence: deterministicSnapshot.evidence, diagnostics: deterministicSnapshot.diagnostics, drafts: shadowDrafts },
          { signal: input.signal, budget: modelBudget },
        );
        const parsed = InsightCriticResultSchema.parse(result);
        const reservationDelta = modelBudget.used - before;
        let repairLimitations: string[] = [];
        let repairedDecisions: CriticDecision[] | undefined;
        let validationError: string | undefined;
        if (parsed.status !== "unavailable") {
          try {
            const validated = validateCriticDecisionsWithRepair(parsed.decisions, shadowDrafts, deterministicSnapshot.evidence);
            repairedDecisions = validated.decisions;
            if (validated.repaired) repairLimitations = validated.limitations;
          } catch (error) {
            validationError = error instanceof Error ? error.message.slice(0, 240) : "The critic decision set was incomplete or invalid.";
          }
        } else if (parsed.decisions.length > 0) {
          validationError = "An unavailable critic cannot return decisions for supplied drafts.";
        }
        const unmeteredProvider = parsed.providerCalls > 0 && reservationDelta !== 1;
        const unmeteredDecisions = parsed.providerCalls === 0 && (parsed.decisions.length > 0 || reservationDelta !== 0);
        const overreportedProvider = parsed.providerCalls > 1;
        const invalidDecisionSet = Boolean(validationError);
        criticResult = unmeteredProvider || unmeteredDecisions || overreportedProvider || invalidDecisionSet
          ? InsightCriticResultSchema.parse({
              status: "unavailable",
              decisions: [],
              rejectedDrafts: parsed.rejectedDrafts + parsed.decisions.filter((decision) => decision.decision === "reject").length,
              limitations: [
                ...parsed.limitations,
                unmeteredProvider
                  ? "Insight critic returned a provider call without consuming the run reservation exactly once; output was withheld."
                  : overreportedProvider
                    ? "Insight critic reported more than one provider call for one run reservation; output was withheld."
                    : invalidDecisionSet
                      ? `Insight critic returned an incomplete or invalid decision set; output was withheld. ${validationError}`
                      : "Insight critic returned decisions without a metered provider call; decisions were withheld.",
              ],
              providerCalls: parsed.providerCalls > 0 && reservationDelta === 1 ? 1 : 0,
            })
          : InsightCriticResultSchema.parse({
              ...parsed,
              decisions: repairedDecisions ?? parsed.decisions,
              limitations: uniqueLimitations([...parsed.limitations, ...repairLimitations]),
            });
        criticDecisions = criticResult.decisions;
        rejectedDrafts += criticResult.rejectedDrafts;
        modelLimitations = uniqueLimitations([...modelLimitations, ...criticResult.limitations]);
        if (criticResult.providerCalls > 0) {
          criticCalls++;
          if (criticResult.status === "unavailable") {
            failedCalls++;
            const kind = failureKind(criticResult.limitations.join(" "));
            if (kind === "malformed") malformedCalls++;
            if (kind === "timedOut") timedOutCalls++;
            if (kind === "cancelled") cancelledCalls++;
          }
        }
      } catch (error) {
        if (input.signal?.aborted) throw error;
        const metered = modelBudget.used > before;
        const limitation = error instanceof Error
          ? `The insight critic stage failed: ${error.message.slice(0, 300)}`
          : "The insight critic stage failed.";
        criticResult = InsightCriticResultSchema.parse({
          status: "unavailable",
          decisions: [],
          rejectedDrafts: 0,
          limitations: [
            limitation,
            ...(metered ? [] : ["Insight critic failed without consuming the run reservation; output was withheld."]),
          ],
          providerCalls: metered ? 1 : 0,
        });
        modelLimitations.push(limitation);
        if (metered) {
          criticCalls++;
          failedCalls++;
          const kind = failureKind(limitation);
          if (kind === "malformed") malformedCalls++;
          if (kind === "timedOut") timedOutCalls++;
          if (kind === "cancelled") cancelledCalls++;
        }
      }
    }
  } else if (shadowDrafts.length > 0 && !input.insightCritic) {
    modelLimitations.push("The insight critic was not enabled; grouped drafts remain unassessed and shadow-only.");
  }
  stageDurations.critic = Math.max(0, Date.now() - criticStageStarted);

  try {
    assertShadowArtifacts({
      workspaceId: snapshotWorkspaceId,
      runId: snapshotRunId,
      clientId: input.client.id,
      evidence: deterministicSnapshot.evidence,
      diagnostics: deterministicSnapshot.diagnostics,
      drafts: shadowDrafts,
    });
  } catch (error) {
    modelLimitations.push(error instanceof Error ? `Grouped understanding output failed strict grounding: ${error.message.slice(0, 240)}` : "Grouped understanding output failed strict grounding.");
    rejectedDrafts += shadowDrafts.length;
    shadowDrafts = [];
    criticDecisions = [];
    if (understandingResult?.providerCalls) malformedCalls++;
  }
  if (shadowDrafts.length > 0 && criticResult && criticResult.status !== "unavailable") {
    try {
      assertShadowArtifacts({
        workspaceId: snapshotWorkspaceId,
        runId: snapshotRunId,
        clientId: input.client.id,
        evidence: deterministicSnapshot.evidence,
        diagnostics: deterministicSnapshot.diagnostics,
        drafts: shadowDrafts,
        criticDecisions,
      });
    } catch (error) {
      modelLimitations.push(error instanceof Error ? `Insight critic output failed strict grounding: ${error.message.slice(0, 240)}` : "Insight critic output failed strict grounding.");
      criticDecisions = [];
      if (criticResult.providerCalls) malformedCalls++;
    }
  }

  stats.aiCalls = modelBudget.used;
  if (!input.siteUnderstanding && modelLimitations.length === 0) modelLimitations.push("Grouped site understanding was not enabled for this run.");
  const draftsAfterCritic = criticResult && criticResult.status !== "unavailable"
    ? criticDecisions.filter((decision) => decision.decision === "retain").length
    : 0;
  const visualAccounting = evidence.visualReview?.accounting ?? (evidence.visualReview
    ? {
        state: evidence.visualReview.status === "complete" ? "complete" : evidence.visualReview.status === "partial" ? "partial" : "unavailable",
        suggestions: evidence.visualReview.findings.length + (evidence.visualReview.rejectedSuggestions?.length ?? 0),
        accepted: evidence.visualReview.findings.length,
        rejected: evidence.visualReview.rejectedSuggestions?.length ?? 0,
        truncated: 0,
        capped: false,
        limitations: evidence.visualReview.limitations.slice(0, 100),
      }
    : diagnosticRun.accounting.visual);
  const modelBudgetCapped = modelBudget.capped > 0 || modelBudget.skipped > 0 || (stats.budgetSkipped ?? 0) > 0;
  const modelBudgetAttempted = Math.max(modelBudget.attempted, stats.aiCalls + (stats.budgetSkipped ?? 0));
  const modelAccounting = budgetUsage(
    maxAiCalls,
    stats.aiCalls,
    modelBudgetAttempted,
    modelBudgetCapped,
    modelBudgetCapped ? "The model-call budget was reached before every requested model stage could run." : undefined,
  );
  const catalogless = catalogCoverage.matched === 0;
  const publicationAttempts = catalogless ? insightDrafts.length : candidates.length;
  const publicationBlocked = catalogless ? publicationAttempts : Math.max(0, candidates.length - opportunities.length);
  const publication = catalogless
    ? { state: "blocked" as const, attempted: publicationAttempts, published: 0, blocked: publicationBlocked, blockReason: "no_matching_catalog_service" as const, limitations: ["Diagnostics were retained, but no active catalog service matched a publication path."] }
    : { state: "available" as const, attempted: publicationAttempts, published: opportunities.length, blocked: publicationBlocked, limitations: [] };
  const accounting = InsightAccountingSchema.parse({
    ...diagnosticRun.accounting,
    budgets: { ...diagnosticRun.accounting.budgets, renders: renderBudget.snapshot(), modelCalls: modelAccounting },
    modelShadow: {
      state: modelAccountingState(understandingResult, criticResult, modelBudget),
      understandingCalls,
      criticCalls,
      skippedCalls: modelBudget.skipped,
      cappedCalls: modelBudget.capped,
      draftsBeforeCritic: shadowDrafts.length,
      draftsAfterCritic,
      rejectedDrafts,
      providerCalls: (understandingResult?.providerCalls ?? 0) + (criticResult?.providerCalls ?? 0),
      failedCalls,
      malformedCalls,
      timedOutCalls,
      cancelledCalls,
      limitations: uniqueLimitations(modelLimitations),
    },
    visual: visualAccounting,
    publication,
  });
  const insightSnapshot = buildInsightSnapshot({
    workspaceId: snapshotWorkspaceId,
    runId: snapshotRunId,
    clientId: input.client.id,
    coverage,
    bundle: evidence,
    drafts: insightDrafts,
    accounting,
    shadowDrafts,
    criticDecisions,
  });
  const findings = buildPublishedFindings({
    snapshot: insightSnapshot,
    shadowDrafts,
    criticDecisions,
    catalog: input.catalog,
    opportunities,
  }).findings;
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
    insightSnapshot,
    shadowDrafts,
    criticDecisions,
    stageDurations,
    findings,
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
