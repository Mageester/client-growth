import type { Client } from "@/core/schema";
import { FixtureEvidenceProvider } from "@/adapters/evidence/FixtureEvidenceProvider";
import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { createEvaluator } from "@/adapters/evaluator/createEvaluator";
import { DeepSeekInsightCritic } from "@/adapters/evaluator/DeepSeekInsightCritic";
import { DeepSeekSiteUnderstanding } from "@/adapters/evaluator/DeepSeekSiteUnderstanding";
import { createMeteredDeepSeekFetch } from "./provider-usage.server";
import { reviewClientVisually, visualReviewAvailable, visualServices } from "./visual-review.server";
import { isExternalBusinessMismatchEnabled, parseAnalysisCaps, parseEnv } from "@/config/env";
import { classifyAnalysis, type AnalysisOutcomeResult } from "@/core/analysisOutcome";
import { advanceAnalysisLifecycle } from "@/db/analysisLifecycle";
import { classifyTerminalAnalysisStage, isTerminalAnalysisStage, type AnalysisStage } from "@/core/analysisLifecycle";
import { RenderBudget } from "@/core/analysisAccounting";
import { isCommercialRule } from "@/core/rules/registry";
import { detectOfferingDrift } from "@/core/offeringDrift";
import { suggestOfferings } from "@/core/offeringSuggestions";
import { analyzeClient, type AnalyzeClientResult } from "@/pipeline/analyzeClient";
import * as repo from "@/db/repositories";
import type { RunTrigger } from "@/db/repositories";
import {
  requireAnalysisReservation,
  type AnalysisLimitOptions,
} from "@/db/analysisLimits";
import type { MonitoringChange } from "@/core/monitoring";
import type { TenantScope } from "@/db/tenant";

import hvacEvidence from "../../fixtures/hvac/evidence.json";

/**
 * The seeded demo client (only ever present in ws_demo) has a non-real domain,
 * so it uses the bundled fixture. Every other client is scanned for real.
 */
const DEMO_FIXTURE_CLIENT_ID = "client-coolbreeze";
const DEMO_WORKSPACE_ID = "ws_demo";

/**
 * A run is one request today, so its wall-clock budget has to be shorter than
 * the Worker request limit. Per-request timeouts alone are not enough: a DNS
 * failure can otherwise spend the full request budget on every crawl, probe,
 * and absence check before the UI gets a response.
 */
export const ANALYSIS_TIMEOUT_MS = 120_000;

export type AnalysisAbortReason = "timeout" | "cancelled";

export class AnalysisAbortedError extends Error {
  readonly reason: AnalysisAbortReason;

  constructor(reason: AnalysisAbortReason) {
    super(
      reason === "timeout"
        ? "This site did not finish reading within two minutes. The run was stopped before it could make a claim; check the domain or try again later."
        : "The site reading was stopped before it finished. No finding was saved from this incomplete run.",
    );
    this.name = "AnalysisAbortedError";
    this.reason = reason;
  }
}

export function createAnalysisDeadline(parent?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort("analysis timeout");
  }, ANALYSIS_TIMEOUT_MS);

  const onParentAbort = () => controller.abort(parent?.reason ?? "request aborted");
  if (parent) {
    if (parent.aborted) onParentAbort();
    else parent.addEventListener("abort", onParentAbort, { once: true });
  }

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

function evidenceProviderFor(client: Client, workspaceId: string, signal?: AbortSignal) {
  if (client.id === DEMO_FIXTURE_CLIENT_ID && workspaceId === DEMO_WORKSPACE_ID) {
    return new FixtureEvidenceProvider([hvacEvidence]);
  }
  return new HttpEvidenceProvider({ maxPages: 10, signal });
}

/**
 * Read a client's site and keep the evidence, without judging anything.
 *
 * Offering suggestions come from the last crawl, so before one exists a new
 * client gets no help with the very list the whole analysis is compared
 * against — which is how four of six real clients ended up recorded with one
 * offering or none, and every run against them was structurally guaranteed to
 * come back inconclusive.
 *
 * This is deliberately not an analysis. No evaluator is called, so it costs
 * nothing and cannot surface a finding; it records no run, so it cannot make a
 * client look analyzed when nothing was assessed. It only makes the site
 * readable to suggestOfferings.
 */
export async function collectEvidenceOnly(
  t: TenantScope,
  clientId: string,
  parentSignal?: AbortSignal,
): Promise<{ readablePages: number }> {
  const client = await repo.getClient(t, clientId);
  if (!client) throw new Response("Client not found", { status: 404 });

  const deadline = createAnalysisDeadline(parentSignal);
  try {
    const evidence = await evidenceProviderFor(client, t.workspaceId, deadline.signal).getEvidence(
      client,
    );
    await repo.saveEvidence(t, evidence);

    return {
      readablePages: evidence.site.pages.filter(
        (page) => page.status >= 200 && page.status < 300 && page.wordCount > 0,
      ).length,
    };
  } finally {
    deadline.dispose();
  }
}

export interface RunAnalysisResult extends AnalyzeClientResult {
  /** The truthful, persisted classification of this run. */
  verdict: AnalysisOutcomeResult;
  /** What this run changed relative to what the agency already knew. */
  change: MonitoringChange;
}

export interface RunAnalysisOptions extends AnalysisLimitOptions {
  /** Defaults to "manual" — a person pressed Analyze and is waiting. */
  trigger?: RunTrigger;
  /** The owning request signal; scheduled runs omit it but still get a deadline. */
  signal?: AbortSignal;
  /** Better Auth user identity for provider-usage attribution. */
  userId?: string;
}

/**
 * Analyze one client in the caller's workspace. Every read/write is scoped by
 * `t`; a client id from another workspace resolves to null -> 404, before any
 * crawl / probe / AI.
 *
 * The run's outcome is persisted alongside the evidence so later page loads can
 * still tell "we read the site and it is clean" apart from "we could not read
 * the site". Inferring the former from the latter would be a lie the crawler
 * deliberately refuses to tell.
 */
export async function runAnalysis(
  t: TenantScope,
  env: Record<string, unknown>,
  clientId: string,
  options: RunAnalysisOptions = {},
): Promise<RunAnalysisResult> {
  const client = await repo.getClient(t, clientId);
  if (!client) throw new Response("Client not found", { status: 404 });

  const catalog = await repo.listServices(t);
  const visualEnv = env as Parameters<typeof visualReviewAvailable>[0];
  const visualEnabled = visualReviewAvailable(visualEnv);
  const visualUnavailableReason =
    !visualEnabled && visualServices(catalog).length > 0
      ? "Connect DeepSeek and website capture to review the design. The text checks alone do not assess the visual customer journey."
      : undefined;

  const caps = parseAnalysisCaps(env);
  const reservation = await requireAnalysisReservation(t, clientId, {
    now: options.now,
    cooldownMs: options.cooldownMs,
    dailyLimit: options.dailyLimit ?? caps.ANALYSIS_WORKSPACE_DAILY_LIMIT,
    platformDailyLimit:
      options.platformDailyLimit ?? caps.ANALYSIS_PLATFORM_DAILY_LIMIT,
  });
  const renderBudget = new RenderBudget(String(reservation.reservationId), 3);
  const startedAt = reservation.reservedAt;
  const trigger = options.trigger ?? "manual";
  const deadline = createAnalysisDeadline(options.signal);
  let lifecycleStage: AnalysisStage = "queued";
  const advance = async (
    stage: AnalysisStage,
    details: {
      failureCode?: import("@/core/analysisLifecycle").AnalysisFailureCode | null;
      failureMessage?: string;
      analysisRunId?: number | null;
    } = {},
  ) => {
    await advanceAnalysisLifecycle(t, {
      reservationId: reservation.reservationId,
      stage,
      ...details,
    });
    lifecycleStage = stage;
  };

  try {
    await advance("preparing");
    // Only exhaustive runs can be baselines. Keeping this lookup separate from
    // the current evidence makes an incomplete crawl unable to overwrite the
    // last trustworthy view of what the site advertised.
    const previousOfferingRun = await repo.getLatestExhaustiveAnalysisRun(t, clientId);
    const parsed = parseEnv(env);
    const usageJobId = `analysis:${reservation.reservationId}`;
    const evaluatorFetch = parsed.AI_PROVIDER === "deepseek"
      ? createMeteredDeepSeekFetch(t, {
          clientId,
          userId: options.userId ?? null,
          jobId: usageJobId,
          feature: "opportunity-evaluation",
          model: parsed.DEEPSEEK_MODEL,
        })
      : undefined;
    let visualProviderCalls = 0;
    const visualFetch = parsed.AI_PROVIDER === "deepseek"
      ? createMeteredDeepSeekFetch(t, {
          clientId,
          userId: options.userId ?? null,
          jobId: usageJobId,
          feature: "visual-review",
          model: parsed.DEEPSEEK_VISION_MODEL,
          onProviderRequest: () => {
            visualProviderCalls += 1;
          },
        })
      : undefined;
    const understandingFetch = parsed.AI_PROVIDER === "deepseek"
      ? createMeteredDeepSeekFetch(t, {
          clientId,
          userId: options.userId ?? null,
          jobId: usageJobId,
          feature: "site-understanding",
          model: parsed.DEEPSEEK_MODEL,
        })
      : undefined;
    const criticFetch = parsed.AI_PROVIDER === "deepseek"
      ? createMeteredDeepSeekFetch(t, {
          clientId,
          userId: options.userId ?? null,
          jobId: usageJobId,
          feature: "insight-critic",
          model: parsed.DEEPSEEK_MODEL,
        })
      : undefined;
    const externalClaims = isExternalBusinessMismatchEnabled(parsed)
      ? await repo.listExternalBusinessClaims(t, clientId)
      : [];
    const result = await analyzeClient({
      client,
      catalog,
      workspaceId: t.workspaceId,
      runId: String(reservation.reservationId),
      renderBudget,
      coverage: await repo.listCoverage(t, clientId),
      existing: await repo.listOpportunities(t, clientId),
      evidenceProvider: evidenceProviderFor(client, t.workspaceId, deadline.signal),
      evaluator: createEvaluator(parsed, { fetchImpl: evaluatorFetch }),
      siteUnderstanding:
        understandingFetch && parsed.DEEPSEEK_API_KEY
          ? new DeepSeekSiteUnderstanding({
              apiKey: parsed.DEEPSEEK_API_KEY,
              baseUrl: parsed.DEEPSEEK_BASE_URL,
              model: parsed.DEEPSEEK_MODEL,
              fetchImpl: understandingFetch,
            })
          : undefined,
      insightCritic:
        criticFetch && parsed.DEEPSEEK_API_KEY
          ? new DeepSeekInsightCritic({
              apiKey: parsed.DEEPSEEK_API_KEY,
              baseUrl: parsed.DEEPSEEK_BASE_URL,
              model: parsed.DEEPSEEK_MODEL,
              fetchImpl: criticFetch,
            })
          : undefined,
      visualReview: visualEnabled
        ? (evidence, onAnalysisStart) =>
            reviewClientVisually(
              t,
              visualEnv,
              client,
              catalog,
              evidence,
              { runId: String(reservation.reservationId), budget: renderBudget },
              deadline.signal,
              onAnalysisStart,
              visualFetch,
            )
        : undefined,
      onStage: (stage) => advance(stage),
      signal: deadline.signal,
      visualReviewMaxCalls: 2,
      visualReviewProviderCalls: () => visualProviderCalls,
      visualReviewUnavailableReason: visualUnavailableReason,
      maxAiCalls: parsed.MAX_AI_CALLS_PER_RUN,
      externalClaims,
      now: options.now,
    });

    const verdictEvidence =
      result.evidence.visualReview?.status === "unavailable"
        ? { ...result.evidence, visualReview: undefined }
        : result.evidence;
    const verdict = classifyAnalysis({
      evidence: verdictEvidence,
      analyzable: result.coverage.analyzable,
      coverageReason: result.coverage.reason,
      coverageLimitation: result.coverage.limitation,
      surfaced:
        result.evidence.visualReview?.status !== "unavailable"
          ? result.opportunities.filter((opportunity) => isCommercialRule(opportunity.ruleId)).length
          : result.opportunities.length,
      evaluatorErrors: result.stats.evaluatorErrors,
      budgetSkipped: result.stats.budgetSkipped,
      catalog: result.catalogCoverage,
    });

    await advance("synthesizing");
    const change: MonitoringChange = {
      newCount: result.newlyFound.length,
      stillOpenCount: result.stillOpen.length,
      resolvedCount: result.resolved.length,
    };

    // The client page shows a short list for confirmation. A run snapshot is
    // wider so a lower-ranked service can still become meaningful drift later.
    const suggestedOfferings = suggestOfferings({
      evidence: result.evidence,
      existingOfferings: client.offerings,
      max: 40,
    }).map((suggestion) => suggestion.label);
    const offeringDrift = detectOfferingDrift({
      trigger,
      current: {
        labels: suggestedOfferings,
        crawlExhaustive: result.evidence.site.crawlExhaustive,
      },
      previous: previousOfferingRun
        ? {
            labels: previousOfferingRun.suggestedOfferings,
            crawlExhaustive: previousOfferingRun.crawlExhaustive,
          }
        : null,
    });

    const abortedAfterAnalysis = deadline.signal.aborted;
    if (!result.insightSnapshot) {
      throw new Error("Analysis did not produce its required insight snapshot.");
    }
    const analysisRunId = await repo.saveAnalysisCompletion(t, {
      evidence: result.evidence,
      insightSnapshot: result.insightSnapshot,
      shadowDrafts: result.shadowDrafts,
      criticDecisions: result.criticDecisions,
      stageDurations: result.stageDurations,
      opportunities: [
        ...result.opportunities,
        ...result.suppressed,
        ...result.resolved,
      ],
      run: {
        clientId,
        startedAt,
        finishedAt: new Date().toISOString(),
        source: result.evidence.source,
        outcome: verdict.outcome,
        summary: verdict.summary,
        limitation: verdict.limitation,
        pagesRead: verdict.reach.readablePages,
        pagesFetched: verdict.reach.fetchedPages,
        blockedEvents: verdict.reach.blockedEvents,
        inconclusiveEvents: verdict.reach.inconclusiveEvents,
        surfaced: result.opportunities.length,
        stats: { ...result.stats },
        trigger,
        newCount: change.newCount,
        resolvedCount: change.resolvedCount,
        evaluatorCalls: result.stats.aiCalls,
        evaluatorRejections: result.stats.rejectedByEvaluator,
        evaluatorErrors: result.stats.evaluatorErrors,
        crawlExhaustive: result.evidence.site.crawlExhaustive,
        suggestedOfferings,
        offeringDrift,
      },
    });

    const terminalStage = classifyTerminalAnalysisStage({
      outcome: verdict.outcome,
      limitation: Boolean(verdict.limitation),
      readablePages: verdict.reach.readablePages,
      blockedEvents: verdict.reach.blockedEvents,
      inconclusiveEvents: verdict.reach.inconclusiveEvents,
    });
    await advance(terminalStage, {
      analysisRunId,
      ...terminalFailureDetails(terminalStage, result.evidence, verdict),
    });
    if (abortedAfterAnalysis) {
      throw new AnalysisAbortedError(deadline.timedOut ? "timeout" : "cancelled");
    }
    return { ...result, verdict, change };
  } catch (error) {
    if (!isTerminalAnalysisStage(lifecycleStage)) {
      const failure = thrownFailureDetails(error, lifecycleStage, deadline);
      try {
        await advance(failure.stage, {
          failureCode: failure.failureCode,
          failureMessage: failure.failureMessage,
        });
      } catch {
        console.error("[analysis] could not persist terminal lifecycle state");
      }
    }
    if (deadline.signal.aborted) {
      throw new AnalysisAbortedError(deadline.timedOut ? "timeout" : "cancelled");
    }
    throw error;
  } finally {
    deadline.dispose();
  }
}

function terminalFailureDetails(
  stage: AnalysisStage,
  evidence: AnalyzeClientResult["evidence"],
  verdict: AnalysisOutcomeResult,
): { failureCode?: import("@/core/analysisLifecycle").AnalysisFailureCode; failureMessage?: string } {
  if (stage !== "failed" && stage !== "blocked") return {};
  const first = evidence.networkEvents[0];
  return {
    failureCode: stage === "blocked" ? "policy" : first?.code === "timeout" ? "timeout" : "network",
    failureMessage: verdict.limitation ?? verdict.summary,
  };
}

function thrownFailureDetails(
  _error: unknown,
  stage: AnalysisStage,
  deadline: ReturnType<typeof createAnalysisDeadline>,
): { stage: AnalysisStage; failureCode: import("@/core/analysisLifecycle").AnalysisFailureCode; failureMessage: string } {
  if (deadline.signal.aborted) {
    return {
      stage: "failed",
      failureCode: deadline.timedOut ? "timeout" : "cancelled",
      failureMessage: deadline.timedOut
        ? "Analysis stopped after its two minute deadline. No incomplete finding was saved."
        : "Analysis was cancelled before it finished. No incomplete finding was saved.",
    };
  }
  if (stage === "preparing" || stage === "queued") {
    return {
      stage: "unavailable",
      failureCode: "configuration",
      failureMessage: "Analysis is unavailable because its provider configuration is incomplete.",
    };
  }
  if (stage === "crawling") {
    return {
      stage: "failed",
      failureCode: "network",
      failureMessage: "The website could not be read because the crawl failed unexpectedly.",
    };
  }
  if (stage === "rendering" || stage === "analyzing") {
    return {
      stage: "failed",
      failureCode: "provider",
      failureMessage: "The evidence provider could not finish the analysis.",
    };
  }
  return {
    stage: "failed",
    failureCode: "persistence",
    failureMessage: "The analysis finished processing but its result could not be saved.",
  };
}
