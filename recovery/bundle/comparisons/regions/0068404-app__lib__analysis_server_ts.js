// app/lib/analysis.server.ts
var DEMO_FIXTURE_CLIENT_ID = "client-coolbreeze";
var DEMO_WORKSPACE_ID = "ws_demo";
var ANALYSIS_TIMEOUT_MS = 12e4;
var AnalysisAbortedError = class extends Error {
  static {
    __name(this, "AnalysisAbortedError");
  }
  reason;
  constructor(reason) {
    super(
      reason === "timeout" ? "This site did not finish reading within two minutes. The run was stopped before it could make a claim; check the domain or try again later." : "The site reading was stopped before it finished. No finding was saved from this incomplete run."
    );
    this.name = "AnalysisAbortedError";
    this.reason = reason;
  }
};
function createAnalysisDeadline(parent) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort("analysis timeout");
  }, ANALYSIS_TIMEOUT_MS);
  const onParentAbort = /* @__PURE__ */ __name(() => controller.abort(parent?.reason ?? "request aborted"), "onParentAbort");
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
    }
  };
}
__name(createAnalysisDeadline, "createAnalysisDeadline");
function evidenceProviderFor(client, workspaceId, signal) {
  if (client.id === DEMO_FIXTURE_CLIENT_ID && workspaceId === DEMO_WORKSPACE_ID) {
    return new FixtureEvidenceProvider([evidence_default]);
  }
  return new HttpEvidenceProvider({ maxPages: 10, signal });
}
__name(evidenceProviderFor, "evidenceProviderFor");
async function runAnalysis(t, env2, clientId2, options = {}) {
  const client = await getClient(t, clientId2);
  if (!client) throw new Response("Client not found", { status: 404 });
  const catalog = await listServices(t);
  const visualEnabled = visualReviewAvailable(env2);
  const visualUnavailableReason = !visualEnabled && catalog.some(isVisualService) ? "Connect DeepSeek and website capture to review the design. The text checks alone do not assess the visual customer journey." : void 0;
  const caps = parseAnalysisCaps(env2);
  const reservation = await requireAnalysisReservation(t, clientId2, {
    now: options.now,
    cooldownMs: options.cooldownMs,
    dailyLimit: options.dailyLimit ?? caps.ANALYSIS_WORKSPACE_DAILY_LIMIT,
    platformDailyLimit: options.platformDailyLimit ?? caps.ANALYSIS_PLATFORM_DAILY_LIMIT
  });
  const renderBudget = new RenderBudget(String(reservation.reservationId), 3);
  const startedAt = reservation.reservedAt;
  const trigger = options.trigger ?? "manual";
  const deadline = createAnalysisDeadline(options.signal);
  let lifecycleStage = "queued";
  const advance = /* @__PURE__ */ __name(async (stage, details = {}) => {
    await advanceAnalysisLifecycle(t, {
      reservationId: reservation.reservationId,
      stage,
      ...details
    });
    lifecycleStage = stage;
  }, "advance");
  try {
    await advance("preparing");
    const previousOfferingRun = await getLatestExhaustiveAnalysisRun(t, clientId2);
    const parsed = parseEnv(env2);
    const usageJobId = `analysis:${reservation.reservationId}`;
    const evaluatorFetch = parsed.AI_PROVIDER === "deepseek" ? createMeteredDeepSeekFetch(t, {
      clientId: clientId2,
      userId: options.userId ?? null,
      jobId: usageJobId,
      feature: "opportunity-evaluation",
      model: parsed.DEEPSEEK_MODEL
    }) : void 0;
    let visualProviderCalls = 0;
    const visualFetch = parsed.AI_PROVIDER === "deepseek" ? createMeteredDeepSeekFetch(t, {
      clientId: clientId2,
      userId: options.userId ?? null,
      jobId: usageJobId,
      feature: "visual-review",
      model: parsed.DEEPSEEK_VISION_MODEL,
      onProviderRequest: /* @__PURE__ */ __name(() => {
        visualProviderCalls++;
      }, "onProviderRequest")
    }) : void 0;
    const understandingFetch = parsed.AI_PROVIDER === "deepseek" ? createMeteredDeepSeekFetch(t, {
      clientId: clientId2,
      userId: options.userId ?? null,
      jobId: usageJobId,
      feature: "site-understanding",
      model: parsed.DEEPSEEK_MODEL
    }) : void 0;
    const criticFetch = parsed.AI_PROVIDER === "deepseek" ? createMeteredDeepSeekFetch(t, {
      clientId: clientId2,
      userId: options.userId ?? null,
      jobId: usageJobId,
      feature: "insight-critic",
      model: parsed.DEEPSEEK_MODEL
    }) : void 0;
    const externalClaims = isExternalBusinessMismatchEnabled(parsed) ? await listExternalBusinessClaims(t, clientId2) : [];
    const result = await analyzeClient({
      client,
      catalog,
      workspaceId: t.workspaceId,
      runId: String(reservation.reservationId),
      renderBudget,
      coverage: await listCoverage(t, clientId2),
      existing: await listOpportunities(t, clientId2),
      evidenceProvider: evidenceProviderFor(client, t.workspaceId, deadline.signal),
      evaluator: createEvaluator(parsed, { fetchImpl: evaluatorFetch }),
      siteUnderstanding: understandingFetch && parsed.DEEPSEEK_API_KEY ? new DeepSeekSiteUnderstanding({
        apiKey: parsed.DEEPSEEK_API_KEY,
        baseUrl: parsed.DEEPSEEK_BASE_URL,
        model: parsed.DEEPSEEK_MODEL,
        fetchImpl: understandingFetch
      }) : void 0,
      insightCritic: criticFetch && parsed.DEEPSEEK_API_KEY ? new DeepSeekInsightCritic({
        apiKey: parsed.DEEPSEEK_API_KEY,
        baseUrl: parsed.DEEPSEEK_BASE_URL,
        model: parsed.DEEPSEEK_MODEL,
        fetchImpl: criticFetch
      }) : void 0,
      visualReview: visualEnabled ? (evidence, onAnalysisStart) => reviewClientVisually(
        t,
        env2,
        client,
        catalog,
        evidence,
        { runId: String(reservation.reservationId), budget: renderBudget },
        deadline.signal,
        onAnalysisStart,
        visualFetch
      ) : void 0,
      onStage: /* @__PURE__ */ __name((stage) => advance(stage), "onStage"),
      signal: deadline.signal,
      visualReviewMaxCalls: 2,
      visualReviewProviderCalls: /* @__PURE__ */ __name(() => visualProviderCalls, "visualReviewProviderCalls"),
      visualReviewUnavailableReason: visualUnavailableReason,
      maxAiCalls: parsed.MAX_AI_CALLS_PER_RUN,
      externalClaims,
      now: options.now
    });
    const verdictEvidence = result.evidence.visualReview?.status === "unavailable" ? { ...result.evidence, visualReview: void 0 } : result.evidence;
    const verdict = classifyAnalysis({
      evidence: verdictEvidence,
      analyzable: result.coverage.analyzable,
      coverageReason: result.coverage.reason,
      coverageLimitation: result.coverage.limitation,
      surfaced: result.evidence.visualReview?.status !== "unavailable" ? result.opportunities.filter((o) => isCommercialRule(o.ruleId)).length : result.opportunities.length,
      evaluatorErrors: result.stats.evaluatorErrors,
      budgetSkipped: result.stats.budgetSkipped,
      catalog: result.catalogCoverage
    });
    await advance("synthesizing");
    const change = {
      newCount: result.newlyFound.length,
      stillOpenCount: result.stillOpen.length,
      resolvedCount: result.resolved.length
    };
    const suggestedOfferings = suggestOfferings({
      evidence: result.evidence,
      existingOfferings: client.offerings,
      max: 40
    }).map((suggestion) => suggestion.label);
    const offeringDrift = detectOfferingDrift({
      trigger,
      current: {
        labels: suggestedOfferings,
        crawlExhaustive: result.evidence.site.crawlExhaustive
      },
      previous: previousOfferingRun ? {
        labels: previousOfferingRun.suggestedOfferings,
        crawlExhaustive: previousOfferingRun.crawlExhaustive
      } : null
    });
    const abortedAfterAnalysis = deadline.signal.aborted;
    if (!result.insightSnapshot) {
      throw new Error("Analysis did not produce its required insight snapshot.");
    }
    const analysisRunId = await saveAnalysisCompletion(t, {
      evidence: result.evidence,
      insightSnapshot: result.insightSnapshot,
      shadowDrafts: result.shadowDrafts,
      criticDecisions: result.criticDecisions,
      stageDurations: result.stageDurations,
      opportunities: [
        ...result.opportunities,
        ...result.suppressed,
        ...result.resolved
      ],
      run: {
        clientId: clientId2,
        startedAt,
        finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
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
        offeringDrift
      }
    });
    const terminalStage = classifyTerminalAnalysisStage({
      outcome: verdict.outcome,
      limitation: verdict.limitation,
      readablePages: verdict.reach.readablePages,
      blockedEvents: verdict.reach.blockedEvents,
      inconclusiveEvents: verdict.reach.inconclusiveEvents
    });
    const terminalFailure = terminalFailureDetails(terminalStage, result.evidence, verdict);
    await advance(terminalStage, { analysisRunId, ...terminalFailure });
    if (abortedAfterAnalysis) {
      throw new AnalysisAbortedError(deadline.timedOut ? "timeout" : "cancelled");
    }
    return { ...result, verdict, change };
  } catch (error3) {
    if (!isTerminalAnalysisStage(lifecycleStage)) {
      const failure = thrownFailureDetails(error3, lifecycleStage, deadline);
      try {
        await advance(failure.stage, failure);
      } catch {
        console.error("[analysis] could not persist terminal lifecycle state");
      }
    }
    if (deadline.signal.aborted) {
      throw new AnalysisAbortedError(deadline.timedOut ? "timeout" : "cancelled");
    }
    throw error3;
  } finally {
    deadline.dispose();
  }
}
__name(runAnalysis, "runAnalysis");
function terminalFailureDetails(stage, evidence, verdict) {
  if (stage !== "failed" && stage !== "blocked") return {};
  const first = evidence.networkEvents[0];
  const failureCode = stage === "blocked" ? "policy" : first?.code === "timeout" ? "timeout" : "network";
  return {
    failureCode,
    failureMessage: verdict.limitation ?? verdict.summary
  };
}
__name(terminalFailureDetails, "terminalFailureDetails");
function thrownFailureDetails(_error, stage, deadline) {
  if (deadline.signal.aborted) {
    return {
      stage: "failed",
      failureCode: deadline.timedOut ? "timeout" : "cancelled",
      failureMessage: deadline.timedOut ? "Analysis stopped after its two minute deadline. No incomplete finding was saved." : "Analysis was cancelled before it finished. No incomplete finding was saved."
    };
  }
  if (stage === "preparing" || stage === "queued") {
    return {
      stage: "unavailable",
      failureCode: "configuration",
      failureMessage: "Analysis is unavailable because its provider configuration is incomplete."
    };
  }
  if (stage === "crawling") {
    return {
      stage: "failed",
      failureCode: "network",
      failureMessage: "The website could not be read because the crawl failed unexpectedly."
    };
  }
  if (stage === "rendering" || stage === "analyzing") {
    return {
      stage: "failed",
      failureCode: "provider",
      failureMessage: "The evidence provider could not finish the analysis."
    };
  }
  return {
    stage: "failed",
    failureCode: "persistence",
    failureMessage: "The analysis finished processing but its result could not be saved."
  };
}
__name(thrownFailureDetails, "thrownFailureDetails");
