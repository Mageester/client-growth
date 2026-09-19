// src/pipeline/analyzeClient.ts
function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new DOMException("The analysis was cancelled", "AbortError");
}
__name(throwIfAborted, "throwIfAborted");
var SharedModelCallBudget = class {
  static {
    __name(this, "SharedModelCallBudget");
  }
  limit;
  usedCount;
  attemptedCount;
  skippedCount = 0;
  cappedCount = 0;
  constructor(limit, initialUsed, initialAttempted = initialUsed) {
    this.limit = Math.max(0, Math.floor(limit));
    this.usedCount = Math.max(0, Math.min(this.limit, Math.floor(initialUsed)));
    this.attemptedCount = Math.max(this.usedCount, Math.floor(initialAttempted));
  }
  get used() {
    return this.usedCount;
  }
  get attempted() {
    return this.attemptedCount;
  }
  get remaining() {
    return Math.max(0, this.limit - this.usedCount);
  }
  get skipped() {
    return this.skippedCount;
  }
  get capped() {
    return this.cappedCount;
  }
  /** Reconcile a pre-reserved stage allowance with its actual provider count. */
  settle(reserved, actual) {
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
  reserve(_label, count5 = 1) {
    const normalized3 = Math.max(0, Math.floor(count5));
    if (normalized3 === 0) return true;
    this.attemptedCount += normalized3;
    if (normalized3 > this.remaining) {
      this.skippedCount += normalized3;
      this.cappedCount += normalized3;
      return false;
    }
    this.usedCount += normalized3;
    return true;
  }
  /** Record a pipeline-level skip without invoking a provider adapter. */
  skip(count5 = 1) {
    const normalized3 = Math.max(0, Math.floor(count5));
    if (normalized3 === 0) return;
    this.attemptedCount += normalized3;
    this.skippedCount += normalized3;
    this.cappedCount += normalized3;
  }
};
function uniqueLimitations(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 100);
}
__name(uniqueLimitations, "uniqueLimitations");
function subtypeDefinitions() {
  return INSIGHT_PROBLEM_TYPES.map((problemType) => {
    const definition3 = INSIGHT_DEFINITIONS[problemType];
    return {
      id: problemType,
      subtypeId: problemType,
      version: "1",
      problemType,
      category: definition3.category,
      claimKind: definition3.claimKind,
      minimumGrade: definition3.minimumGrade,
      requiresCompleteCoverage: definition3.requiresCompleteCoverage,
      requiresCounterEvidence: definition3.requiresCounterEvidence,
      projectWorkstream: definition3.projectWorkstream,
      legacyRuleId: definition3.legacyRuleId,
      reconciliationPolicy: definition3.reconciliationPolicy,
      eligibleEvidenceKinds: [],
      capabilityIntent: [definition3.projectWorkstream],
      deliverableIds: [],
      // Without these the model sees only a snake_case identifier and a bare
      // boolean, which is how a page of live template copy was passed over in
      // favour of a missing meta description.
      description: definition3.description,
      priority: definition3.priority,
      modelAnchored: MODEL_ANCHORED_PROBLEM_TYPES.has(problemType)
    };
  });
}
__name(subtypeDefinitions, "subtypeDefinitions");
function buildSiteUnderstandingInput(client, catalog, snapshot) {
  return SiteUnderstandingInputSchema.parse({
    clientId: client.id,
    clientFacts: {
      clientId: client.id,
      name: client.name,
      domain: client.domain,
      offerings: client.offerings,
      notes: client.notes
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
      serviceId: service.id
    })),
    subtypeDefinitions: subtypeDefinitions()
  });
}
__name(buildSiteUnderstandingInput, "buildSiteUnderstandingInput");
function failureKind(limitation3) {
  if (/truncat|malformed|invalid json|not (?:valid )?json|contract|completion shape|empty|grounding|canonical|taxonomy|subtype|draft/i.test(limitation3)) {
    return "malformed";
  }
  if (/timed.?out/i.test(limitation3)) return "timedOut";
  if (/cancel/i.test(limitation3)) return "cancelled";
  return "failed";
}
__name(failureKind, "failureKind");
function canonicalizeUnderstandingResult(result, source2, maxDrafts) {
  if (result.status === "unavailable" && result.drafts.length === 0) return result;
  const validated = validateProblemDrafts(source2, result.drafts, maxDrafts);
  const rejectedDrafts = result.rejectedDrafts + validated.rejectedDrafts;
  const status = validated.drafts.length > 0 && rejectedDrafts > 0 ? "partial" : validated.drafts.length > 0 || rejectedDrafts === 0 ? "complete" : "unavailable";
  return SiteUnderstandingResultSchema.parse({
    ...result,
    status,
    drafts: validated.drafts,
    rejectedDrafts,
    limitations: uniqueLimitations([...result.limitations, ...validated.limitations])
  });
}
__name(canonicalizeUnderstandingResult, "canonicalizeUnderstandingResult");
function modelAccountingState(understanding, critic, budget3) {
  if (!understanding) {
    return budget3.skipped > 0 ? "blocked" : "unassessed";
  }
  if (understanding.status === "unavailable") return "unavailable";
  if (understanding.status === "partial") return "partial";
  if (understanding.drafts.length === 0) return "complete";
  if (!critic) return budget3.skipped > 0 ? "blocked" : "unavailable";
  return critic.status === "complete" && understanding.status === "complete" ? "complete" : critic.status === "partial" ? "partial" : "unavailable";
}
__name(modelAccountingState, "modelAccountingState");
function budgetUsage(limit, used, attempted = used, capped = false, capReason) {
  const safeLimit = Math.max(0, Math.floor(limit));
  const safeUsed = Math.max(0, Math.min(safeLimit, Math.floor(used)));
  const safeAttempted = Math.max(safeUsed, Math.floor(attempted));
  return BudgetUsageSchema.parse({
    limit: safeLimit,
    used: safeUsed,
    remaining: safeLimit - safeUsed,
    attempted: safeAttempted,
    capped,
    ...capped ? { capReason: capReason ?? "The run budget was capped." } : {}
  });
}
__name(budgetUsage, "budgetUsage");
function isSuppressed(opp, now2) {
  if (opp.status === "sold" || opp.status === "lost") return true;
  if (opp.status === "dismissed" || opp.status === "already_covered") return true;
  if (opp.status === "snoozed") {
    return !opp.snoozeUntil || opp.snoozeUntil > now2.toISOString();
  }
  return false;
}
__name(isSuppressed, "isSuppressed");
function reconcile(prior, fresh) {
  if (!prior) return fresh;
  if (fresh.ruleId === "visual-conversion-opportunity" && ["accepted", "proposal_prepared", "pitched"].includes(prior.status)) {
    fresh = { ...fresh, suggestedServiceId: prior.suggestedServiceId, suggestedScope: prior.suggestedScope, priceMin: prior.priceMin, priceMax: prior.priceMax };
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
      proposalPreparedAt: prior.proposalPreparedAt
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
      lostAt: prior.lostAt
    };
  }
  return { ...fresh, id: prior.id };
}
__name(reconcile, "reconcile");
async function analyzeClient(input) {
  const now2 = input.now ?? /* @__PURE__ */ new Date();
  const maxAiCalls = input.maxAiCalls ?? 10;
  const renderBudget = input.renderBudget ?? new RenderBudget(input.runId ?? `analysis:${input.client.id}:${Date.now()}`, 3);
  const existingByKey = new Map((input.existing ?? []).map((o) => [o.dedupeKey, o]));
  let validatedVisualFindings3 = [];
  const stats = {
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
    aiCalls: 0
  };
  const modelBudget = new SharedModelCallBudget(maxAiCalls, 0, 0);
  let visualReservation = 0;
  const stageDurations = {};
  await input.onStage?.("crawling");
  const evidence = await input.evidenceProvider.getEvidence(input.client);
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
        limitations: [input.visualReviewUnavailableReason]
      }
    };
  }
  if (input.visualReview && !modelBudget.reserve("visual-review", visualCallBudget)) {
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
        limitations: [`Allow at least ${visualCallBudget} AI calls per review to inspect and challenge the website evidence.`]
      }
    };
  }
  if (input.visualReview && evidence.visualReview === void 0) {
    visualReservation = visualCallBudget;
    await input.onStage?.("rendering");
    try {
      evidence.visualReview = await input.visualReview(
        evidence,
        () => input.onStage?.("analyzing") ?? Promise.resolve(),
        renderBudget
      );
      const actualVisualCalls = Math.max(
        0,
        Math.floor(
          input.visualReviewProviderCalls?.() ?? evidence.visualReview.providerCalls ?? (evidence.visualReview.status === "unavailable" ? 0 : visualCallBudget)
        )
      );
      modelBudget.settle(visualReservation, actualVisualCalls);
      const visualMode = input.catalog.some(isVisualService) ? "legacy" : "shadow";
      const modernVisualFindings = evidence.visualReview.findings.filter(
        (finding) => (finding.visualEvidence?.length ?? 0) > 0 || (finding.evidence?.length ?? 0) > 0
      );
      const legacyVisualFindings = evidence.visualReview.findings.filter(
        (finding) => (finding.visualEvidence?.length ?? 0) === 0 && (finding.evidence?.length ?? 0) === 0
      );
      const validatedModern = validateVisualFindings(
        modernVisualFindings,
        evidence.visualReview.screenshots,
        evidence.renderedPages ?? [],
        input.catalog,
        {
          mode: visualMode,
          maxFindings: 3,
          requireExactReferences: true
        }
      );
      const validatedLegacy = validateVisualFindings(
        legacyVisualFindings,
        evidence.visualReview.screenshots,
        evidence.renderedPages ?? [],
        input.catalog,
        {
          mode: visualMode,
          maxFindings: 3,
          requireExactReferences: false
        }
      );
      const seenVisualSubjects = /* @__PURE__ */ new Set();
      validatedVisualFindings3 = [...validatedModern, ...validatedLegacy].filter((finding) => {
        const subject = visualSubject(finding);
        if (seenVisualSubjects.has(subject)) return false;
        seenVisualSubjects.add(subject);
        return true;
      }).slice(0, 3);
      evidence.visualReview.findings = validatedVisualFindings3;
      if (evidence.visualReview.status === "unavailable") stats.evaluatorErrors++;
    } catch {
      stats.aiCalls += Math.max(
        0,
        Math.floor(input.visualReviewProviderCalls?.() ?? 0)
      );
      stats.evaluatorErrors++;
      evidence.visualReview = {
        status: "unavailable",
        model: "",
        summary: "Visual review could not finish.",
        strengths: [],
        screenshots: [],
        findings: [],
        limitations: ["The visual provider did not return a usable review. Try again; no visual conclusion was made."]
      };
      const actualVisualCalls = Math.max(0, Math.floor(input.visualReviewProviderCalls?.() ?? 0));
      modelBudget.settle(visualReservation, actualVisualCalls);
    }
  }
  stats.aiCalls = modelBudget.used;
  stageDurations.visual = Math.max(0, Date.now() - visualStageStarted);
  await input.onStage?.("analyzing");
  const visualFindings = evidence.visualReview?.status === "unavailable" ? [] : validatedVisualFindings3;
  const visualEvaluations = new Map(visualFindings.map((f) => [visualSubject(f), visualEvaluation(f)]));
  const diagnosticsStageStarted = Date.now();
  const coverage = assessServiceCoverage({ client: input.client, evidence });
  const fetchPage = input.evidenceProvider.fetchPage?.bind(input.evidenceProvider);
  const probe = input.evidenceProvider.probe?.bind(input.evidenceProvider);
  const verifyBudget = { remaining: input.maxVerifyFetches ?? 12 };
  const probeBudget = { remaining: input.maxProbes ?? 8 };
  const technicalSuppressedEvidenceRefsByRule = (input.existing ?? []).reduce((byRule, opportunity) => {
    if (!isTechnicalRuleId2(opportunity.ruleId)) return byRule;
    byRule[opportunity.ruleId] = [
      .../* @__PURE__ */ new Set([
        ...byRule[opportunity.ruleId] ?? [],
        ...opportunity.suppressedEvidenceRefs
      ])
    ];
    return byRule;
  }, {});
  const diagnosticContext = {
    client: input.client,
    evidence,
    coverage,
    probe,
    fetchPage,
    verifyBudget,
    probeBudget,
    technicalSuppressedEvidenceRefsByRule
  };
  const diagnosticRun = await runDiagnosticRun(diagnosticContext);
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
    now: now2,
    fetchPage,
    budget: verifyBudget
  });
  const candidateByKey = /* @__PURE__ */ new Map();
  const publicationVisualFindings = visualFindings.filter(
    (finding) => finding.serviceId !== void 0 && input.catalog.some(
      (service) => service.id === finding.serviceId && isVisualService(service)
    )
  );
  for (const candidate of [
    ...publicationVisualFindings.map(visualCandidate),
    ...ruleCandidates,
    ...externalCandidates
  ]) {
    const key = dedupeKey(input.client.id, candidate.ruleId, candidate.subject);
    if (!candidateByKey.has(key)) candidateByKey.set(key, candidate);
  }
  const candidates = [...candidateByKey.values()];
  stats.candidates = candidates.length;
  const strong = candidates.filter((c) => passesEvidenceThreshold(c, evidence));
  stats.passedEvidenceThreshold = strong.length;
  const suppressed = [];
  const pending = [];
  const matchedVisualPriors = /* @__PURE__ */ new Set();
  for (const candidate of strong) {
    const key = dedupeKey(input.client.id, candidate.ruleId, candidate.subject);
    const visualFinding = candidate.ruleId === "visual-conversion-opportunity" ? publicationVisualFindings.find((f) => visualSubject(f) === candidate.subject) : void 0;
    const prior = existingByKey.get(key) ?? (visualFinding ? matchingVisualPrior(visualFinding, input.client.id, input.existing ?? []) : void 0);
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
      const service = input.catalog.find((s) => s.id === candidate.suggestedServiceId);
      if (service) {
        suppressed.push(
          assembleCoveredOpportunity({
            candidate,
            service,
            clientId: input.client.id,
            now: now2,
            prior
          })
        );
      }
      stats.suppressedByCoverage++;
      continue;
    }
    if (prior && isSuppressed(prior, now2)) {
      suppressed.push(prior);
      stats.suppressedByPriorDecision++;
      continue;
    }
    pending.push({ candidate, billableStatus, prior });
  }
  const legacyEvaluatorStageStarted = Date.now();
  const opportunities = [];
  const newlyFound = [];
  const stillOpen = [];
  for (const { candidate, billableStatus, prior } of pending) {
    throwIfAborted(input.signal);
    const deterministic = candidate.ruleId === "visual-conversion-opportunity" ? visualEvaluations.get(candidate.subject) ?? null : deterministicEvaluationFor(candidate);
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
        const evaluatorInput = {
          candidate,
          client: input.client,
          evidence,
          signal: input.signal
        };
        evaluation = await input.evaluator.evaluate(evaluatorInput);
        throwIfAborted(input.signal);
      } catch (err) {
        if (input.signal?.aborted) throw err;
        stats.evaluatorErrors++;
        console.error(
          `[analyzeClient] evaluator failed for "${candidate.subject}": ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`
        );
        continue;
      }
    }
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
      now: now2
    });
    if (prior && candidate.ruleId === "visual-conversion-opportunity") fresh.dedupeKey = prior.dedupeKey;
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
    now: now2
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
    accounting: diagnosticRun.accounting
  });
  let understandingResult;
  let criticResult;
  let shadowDrafts = [];
  let criticDecisions = [];
  let modelLimitations = [];
  let failedCalls = 0;
  let malformedCalls = 0;
  let timedOutCalls = 0;
  let cancelledCalls = 0;
  let understandingCalls = 0;
  let criticCalls = 0;
  let rejectedDrafts = 0;
  const understandingStageStarted = Date.now();
  if (input.siteUnderstanding) {
    if (modelBudget.remaining === 0) {
      modelBudget.skip();
      modelLimitations.push("The shared model-call budget was exhausted before site understanding.");
    } else {
      const before = modelBudget.used;
      try {
        const result = await input.siteUnderstanding.understand(
          buildSiteUnderstandingInput(input.client, input.catalog, deterministicSnapshot),
          {
            signal: input.signal,
            maxDrafts: Math.max(0, Math.min(100, Math.floor(input.maxShadowDrafts ?? 20))),
            budget: modelBudget
          }
        );
        const parsedUnderstanding = SiteUnderstandingResultSchema.parse(result);
        const reservationDelta = modelBudget.used - before;
        const unmeteredProvider = parsedUnderstanding.providerCalls > 0 && reservationDelta !== 1;
        const unmeteredDrafts = parsedUnderstanding.providerCalls === 0 && (parsedUnderstanding.drafts.length > 0 || reservationDelta !== 0);
        const overreportedProvider = parsedUnderstanding.providerCalls > 1;
        understandingResult = unmeteredProvider || unmeteredDrafts || overreportedProvider ? SiteUnderstandingResultSchema.parse({
          status: "unavailable",
          drafts: [],
          rejectedDrafts: parsedUnderstanding.rejectedDrafts + parsedUnderstanding.drafts.length,
          limitations: [
            ...parsedUnderstanding.limitations,
            unmeteredProvider ? "Grouped understanding returned a provider call without consuming the run reservation exactly once; output was withheld." : overreportedProvider ? "Grouped understanding reported more than one provider call for one run reservation; output was withheld." : "Grouped understanding returned drafts without a metered provider call; drafts were withheld."
          ],
          providerCalls: 0
        }) : canonicalizeUnderstandingResult(
          parsedUnderstanding,
          buildSiteUnderstandingInput(input.client, input.catalog, deterministicSnapshot),
          Math.max(0, Math.min(100, Math.floor(input.maxShadowDrafts ?? 20)))
        );
        if (understandingResult.drafts.length > 0) {
          try {
            assertShadowArtifacts({
              workspaceId: snapshotWorkspaceId,
              runId: snapshotRunId,
              clientId: input.client.id,
              evidence: deterministicSnapshot.evidence,
              diagnostics: deterministicSnapshot.diagnostics,
              drafts: understandingResult.drafts
            });
          } catch (error3) {
            const limitation3 = error3 instanceof Error ? `Grouped understanding output failed strict grounding: ${error3.message.slice(0, 240)}` : "Grouped understanding output failed strict grounding.";
            understandingResult = SiteUnderstandingResultSchema.parse({
              status: "unavailable",
              drafts: [],
              rejectedDrafts: understandingResult.rejectedDrafts + understandingResult.drafts.length,
              limitations: [...understandingResult.limitations, limitation3],
              providerCalls: understandingResult.providerCalls
            });
          }
        }
        shadowDrafts = understandingResult.drafts;
        rejectedDrafts += understandingResult.rejectedDrafts;
        modelLimitations = uniqueLimitations([
          ...modelLimitations,
          ...understandingResult.limitations
        ]);
        if (understandingResult.providerCalls > 0) {
          understandingCalls += 1;
          if (understandingResult.status === "unavailable") {
            failedCalls += 1;
            const kind = failureKind(understandingResult.limitations.join(" "));
            if (kind === "malformed") malformedCalls += 1;
            if (kind === "timedOut") timedOutCalls += 1;
            if (kind === "cancelled") cancelledCalls += 1;
          }
        }
      } catch (error3) {
        const metered = modelBudget.used > before;
        const limitation3 = error3 instanceof Error ? `The grouped understanding stage failed: ${error3.message.slice(0, 300)}` : "The grouped understanding stage failed.";
        understandingResult = SiteUnderstandingResultSchema.parse({
          status: "unavailable",
          drafts: [],
          rejectedDrafts: 0,
          limitations: [
            limitation3,
            ...metered ? [] : ["Grouped understanding failed without consuming the run reservation; output was withheld."]
          ],
          providerCalls: metered ? 1 : 0
        });
        modelLimitations.push(limitation3);
        if (metered) {
          understandingCalls += 1;
          failedCalls += 1;
          const kind = failureKind(limitation3);
          if (kind === "malformed") malformedCalls += 1;
          if (kind === "timedOut") timedOutCalls += 1;
          if (kind === "cancelled") cancelledCalls += 1;
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
          {
            evidence: deterministicSnapshot.evidence,
            diagnostics: deterministicSnapshot.diagnostics,
            drafts: shadowDrafts
          },
          { signal: input.signal, budget: modelBudget }
        );
        const parsedCritic = InsightCriticResultSchema.parse(result);
        let repairedCriticDecisions;
        let criticRepairLimitations = [];
        const reservationDelta = modelBudget.used - before;
        const unmeteredProvider = parsedCritic.providerCalls > 0 && reservationDelta !== 1;
        const unmeteredDecisions = parsedCritic.providerCalls === 0 && (parsedCritic.decisions.length > 0 || reservationDelta !== 0);
        const overreportedProvider = parsedCritic.providerCalls > 1;
        let decisionValidationError;
        if (parsedCritic.status !== "unavailable") {
          try {
            const validated = validateCriticDecisionsWithRepair(
              parsedCritic.decisions,
              shadowDrafts,
              deterministicSnapshot.evidence
            );
            repairedCriticDecisions = validated.decisions;
            if (validated.repaired) {
              criticRepairLimitations = validated.limitations;
            }
          } catch (error3) {
            decisionValidationError = error3 instanceof Error ? error3.message.slice(0, 240) : "The critic decision set was incomplete or invalid.";
          }
        } else if (parsedCritic.decisions.length > 0) {
          decisionValidationError = "An unavailable critic cannot return decisions for supplied drafts.";
        }
        const invalidDecisionSet = Boolean(decisionValidationError);
        const repairedDecisions = invalidDecisionSet ? void 0 : repairedCriticDecisions;
        criticResult = unmeteredProvider || unmeteredDecisions || overreportedProvider || invalidDecisionSet ? InsightCriticResultSchema.parse({
          status: "unavailable",
          decisions: [],
          rejectedDrafts: parsedCritic.rejectedDrafts + parsedCritic.decisions.filter((decision) => decision.decision === "reject").length,
          limitations: [
            ...parsedCritic.limitations,
            unmeteredProvider ? "Insight critic returned a provider call without consuming the run reservation exactly once; output was withheld." : overreportedProvider ? "Insight critic reported more than one provider call for one run reservation; output was withheld." : invalidDecisionSet ? `Insight critic returned an incomplete or invalid decision set; output was withheld. ${decisionValidationError}` : "Insight critic returned decisions without a metered provider call; decisions were withheld."
          ],
          providerCalls: parsedCritic.providerCalls > 0 && reservationDelta === 1 ? 1 : 0
        }) : InsightCriticResultSchema.parse({
          ...parsedCritic,
          decisions: repairedDecisions ?? parsedCritic.decisions,
          limitations: uniqueLimitations([
            ...parsedCritic.limitations,
            ...criticRepairLimitations
          ])
        });
        criticDecisions = criticResult.decisions;
        rejectedDrafts += criticResult.rejectedDrafts;
        modelLimitations = uniqueLimitations([
          ...modelLimitations,
          ...criticResult.limitations
        ]);
        if (criticResult.providerCalls > 0) {
          criticCalls += 1;
          if (criticResult.status === "unavailable") {
            failedCalls += 1;
            const kind = failureKind(criticResult.limitations.join(" "));
            if (kind === "malformed") malformedCalls += 1;
            if (kind === "timedOut") timedOutCalls += 1;
            if (kind === "cancelled") cancelledCalls += 1;
          }
        }
      } catch (error3) {
        const metered = modelBudget.used > before;
        const limitation3 = error3 instanceof Error ? `The insight critic stage failed: ${error3.message.slice(0, 300)}` : "The insight critic stage failed.";
        criticResult = InsightCriticResultSchema.parse({
          status: "unavailable",
          decisions: [],
          rejectedDrafts: 0,
          limitations: [
            limitation3,
            ...metered ? [] : ["Insight critic failed without consuming the run reservation; output was withheld."]
          ],
          providerCalls: metered ? 1 : 0
        });
        modelLimitations.push(limitation3);
        if (metered) {
          criticCalls += 1;
          failedCalls += 1;
          const kind = failureKind(limitation3);
          if (kind === "malformed") malformedCalls += 1;
          if (kind === "timedOut") timedOutCalls += 1;
          if (kind === "cancelled") cancelledCalls += 1;
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
      drafts: shadowDrafts
    });
  } catch (error3) {
    modelLimitations.push(
      error3 instanceof Error ? `Grouped understanding output failed strict grounding: ${error3.message.slice(0, 240)}` : "Grouped understanding output failed strict grounding."
    );
    rejectedDrafts += shadowDrafts.length;
    shadowDrafts = [];
    criticDecisions = [];
    malformedCalls += understandingResult?.providerCalls ? 1 : 0;
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
        criticDecisions
      });
    } catch (error3) {
      modelLimitations.push(
        error3 instanceof Error ? `Insight critic output failed strict grounding: ${error3.message.slice(0, 240)}` : "Insight critic output failed strict grounding."
      );
      criticDecisions = [];
      malformedCalls += criticResult?.providerCalls ? 1 : 0;
    }
  }
  stats.aiCalls = modelBudget.used;
  const draftsAfterCritic = criticResult && criticResult.status !== "unavailable" ? criticDecisions.filter((decision) => decision.decision === "retain").length : 0;
  const modelShadowState = modelAccountingState(understandingResult, criticResult, modelBudget);
  if (!input.siteUnderstanding && !modelLimitations.length) {
    modelLimitations.push("Grouped site understanding was not enabled for this run.");
  }
  const visualReview = evidence.visualReview;
  const visualAccounting = visualReview?.accounting ?? (visualReview ? {
    state: visualReview.status === "complete" ? "complete" : visualReview.status === "partial" ? "partial" : "unavailable",
    suggestions: visualReview.findings.length + (visualReview.rejectedSuggestions?.length ?? 0),
    accepted: visualReview.findings.length,
    rejected: visualReview.rejectedSuggestions?.length ?? 0,
    truncated: 0,
    capped: false,
    limitations: visualReview.limitations.slice(0, 100)
  } : diagnosticRun.accounting.visual);
  const modelBudgetCapped = modelBudget.capped > 0 || modelBudget.skipped > 0 || (stats.budgetSkipped ?? 0) > 0;
  const modelBudgetAttempted = Math.max(
    modelBudget.attempted,
    stats.aiCalls + (stats.budgetSkipped ?? 0)
  );
  const modelAccounting = budgetUsage(
    maxAiCalls,
    stats.aiCalls,
    modelBudgetAttempted,
    modelBudgetCapped,
    modelBudgetCapped ? "The model-call budget was reached before every requested model stage could run." : void 0
  );
  const catalogless = catalogCoverage.matched === 0;
  const publicationAttempts = catalogless ? insightDrafts.length : candidates.length;
  const publicationBlocked = catalogless ? publicationAttempts : Math.max(0, candidates.length - opportunities.length);
  const publication = catalogless ? {
    state: "blocked",
    attempted: publicationAttempts,
    published: 0,
    blocked: publicationBlocked,
    blockReason: "no_matching_catalog_service",
    limitations: [
      "Diagnostics were retained, but no active catalog service matched a publication path."
    ]
  } : {
    state: "available",
    attempted: publicationAttempts,
    published: opportunities.length,
    blocked: publicationBlocked,
    limitations: []
  };
  const accounting = InsightAccountingSchema.parse({
    ...diagnosticRun.accounting,
    budgets: {
      ...diagnosticRun.accounting.budgets,
      renders: renderBudget.snapshot(),
      modelCalls: modelAccounting
    },
    modelShadow: {
      state: modelShadowState,
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
      limitations: uniqueLimitations(modelLimitations)
    },
    visual: visualAccounting,
    publication
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
    criticDecisions
  });
  const findings = buildPublishedFindings({
    snapshot: insightSnapshot,
    shadowDrafts,
    criticDecisions,
    catalog: input.catalog,
    opportunities: opportunities.map((opportunity) => ({
      id: opportunity.id,
      dedupeKey: opportunity.dedupeKey
    }))
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
    findings
  };
}
__name(analyzeClient, "analyzeClient");
function reconcileResolved(input) {
  const readSomething = input.evidence.site.pages.some(
    (page) => page.status >= 200 && page.status < 300 && page.wordCount > 0
  );
  const complete = input.stats.evaluatorErrors === 0 && input.stats.aiCalls < input.maxAiCalls;
  if (!readSomething || !complete) return [];
  const ranThisTime = /* @__PURE__ */ new Set();
  for (const rule of input.catalogCoverage.rules) {
    if (rule.ruleId === "visual-conversion-opportunity") continue;
    if (rule.serviceId === null) continue;
    if (rule.ruleId === "missing-service-page" && !input.analyzable) continue;
    if (rule.ruleId === "no-service-pages" && !input.analyzable && input.coverageLimitation !== "site-too-thin") {
      continue;
    }
    if (isTechnicalRuleId2(rule.ruleId) && !canReconcileTechnicalRule(rule.ruleId, input.evidence)) {
      continue;
    }
    ranThisTime.add(rule.ruleId);
  }
  if (ranThisTime.size === 0) return [];
  const stillPresent = new Set(
    input.candidates.map((c) => dedupeKey(input.clientId, c.ruleId, c.subject))
  );
  const resolved = [];
  const OPEN_RECONCILABLE = /* @__PURE__ */ new Set([
    "new",
    "accepted",
    "proposal_prepared",
    "pitched"
  ]);
  for (const opp of input.existing) {
    if (opp.billableStatus !== "billable") continue;
    if (!OPEN_RECONCILABLE.has(opp.status)) continue;
    if (isTechnicalRuleId2(opp.ruleId) && opp.suppressedEvidenceRefs.length > 0) continue;
    if (!ranThisTime.has(opp.ruleId)) continue;
    if (stillPresent.has(opp.dedupeKey)) continue;
    if (isTechnicalRuleId2(opp.ruleId) && !technicalSubjectWasRevisited({
      ruleId: opp.ruleId,
      subject: subjectFromOpportunity(opp),
      evidenceRefs: opp.evidenceRefs,
      evidence: input.evidence
    })) {
      continue;
    }
    resolved.push({ ...opp, status: "resolved", updatedAt: input.now.toISOString() });
  }
  return resolved;
}
__name(reconcileResolved, "reconcileResolved");
function subjectFromOpportunity(opp) {
  const target = opp.evidenceRefs.find((ref) => ref.startsWith("target:"))?.slice("target:".length);
  if (target) return target;
  const page = opp.evidenceRefs.find((ref) => ref.startsWith("page:"))?.slice("page:".length);
  return page ?? opp.title;
}
__name(subjectFromOpportunity, "subjectFromOpportunity");
