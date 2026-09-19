// src/core/insightSnapshot.ts
function uniqueStrings4(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
__name(uniqueStrings4, "uniqueStrings");
function coverageInput(coverage, crawlExhaustive) {
  if (typeof coverage === "string") return coverage;
  if ("analyzable" in coverage) {
    const state = coverage.analyzable && (crawlExhaustive || coverage.limitation === "site-too-thin") ? "complete" : "partial";
    return {
      state,
      reason: coverage.reason,
      limitations: coverage.reason ? [coverage.reason] : []
    };
  }
  return coverage;
}
__name(coverageInput, "coverageInput");
function crawlCoverageFrom(bundle) {
  const coverage = bundle.site.coverage;
  const ignored = Array.isArray(coverage?.ignoredUrls) ? coverage.ignoredUrls : [];
  const countReason = /* @__PURE__ */ __name((reason) => ignored.filter((entry2) => entry2.reason === reason).length, "countReason");
  const known = /* @__PURE__ */ new Set(["page-budget", "duplicate", "off-site", "robots", "depth", "unsupported"]);
  return {
    exhaustive: bundle.site.crawlExhaustive === true,
    discovered: coverage?.discoveredUrls ?? bundle.site.pages.length,
    attempted: coverage?.attemptedUrls ?? bundle.site.pages.length,
    retrieved: coverage?.retrievedUrls ?? bundle.site.pages.length,
    failed: coverage?.failedUrls ?? 0,
    rendered: coverage?.renderedUrls ?? 0,
    deferredByPageBudget: countReason("page-budget"),
    duplicatesOfPagesAlreadyRead: countReason("duplicate"),
    offSite: countReason("off-site"),
    otherReasons: ignored.filter((entry2) => !known.has(entry2.reason)).length
  };
}
__name(crawlCoverageFrom, "crawlCoverageFrom");
function categoryReason(state, diagnostics, problems) {
  if (state === "unassessed") {
    return "No current diagnostic was produced for this category.";
  }
  if (state === "blocked") {
    return "Required evidence for this category was blocked.";
  }
  if (state === "limited") {
    const reason = [
      ...diagnostics.flatMap((diagnostic) => diagnostic.assessment.limitations),
      ...problems.flatMap((problem) => problem.rejectionReasons)
    ].find((value) => value.trim());
    return reason ?? "Evidence for this category is limited by its policy.";
  }
  return void 0;
}
__name(categoryReason, "categoryReason");
function categoryState(diagnostics, problems) {
  if (diagnostics.length === 0) return "unassessed";
  if (diagnostics.some(
    (diagnostic) => diagnostic.state === "blocked" || diagnostic.assessment.coverage === "blocked"
  )) {
    return "blocked";
  }
  if (diagnostics.some(
    (diagnostic) => diagnostic.state !== "observed" || diagnostic.assessment.grade === "limited" || diagnostic.assessment.grade === "insufficient" || diagnostic.assessment.unassessedEvidence.length > 0 || diagnostic.assessment.limitations.length > 0
  ) || problems.some((problem) => problem.qualityGate !== "supported")) {
    return "limited";
  }
  return "assessed";
}
__name(categoryState, "categoryState");
function assessCategories(diagnostics, problems) {
  return INSIGHT_CATEGORIES.map((category) => {
    const categoryDiagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.category === category
    );
    const categoryProblems = problems.filter((problem) => problem.category === category);
    const state = categoryState(categoryDiagnostics, categoryProblems);
    return AnalysisCategoryAssessmentSchema.parse({
      category,
      state,
      diagnosticCount: categoryDiagnostics.length,
      problemCount: categoryProblems.length,
      ...categoryReason(state, categoryDiagnostics, categoryProblems) ? { reason: categoryReason(state, categoryDiagnostics, categoryProblems) } : {},
      limitations: uniqueStrings4(
        categoryDiagnostics.flatMap((diagnostic) => diagnostic.assessment.limitations)
      ).slice(0, 50)
    });
  });
}
__name(assessCategories, "assessCategories");
function buildInsightSnapshot(input) {
  if (input.bundle.clientId !== input.clientId) {
    throw new Error("Evidence bundle crosses the snapshot client boundary.");
  }
  const evidence = buildEvidenceLedger({ runId: input.runId, bundle: input.bundle });
  const semanticDiagnostics = semanticDiagnosticDrafts(input.shadowDrafts ?? [], evidence);
  const diagnostics = materializeDiagnostics({
    workspaceId: input.workspaceId,
    runId: input.runId,
    clientId: input.clientId,
    coverage: coverageInput(input.coverage, input.bundle.site.crawlExhaustive === true),
    drafts: [...input.drafts, ...semanticDiagnostics],
    ledger: evidence
  });
  const problems = synthesizeProblems({
    workspaceId: input.workspaceId,
    runId: input.runId,
    clientId: input.clientId,
    diagnostics
  });
  assertShadowArtifacts({
    workspaceId: input.workspaceId,
    runId: input.runId,
    clientId: input.clientId,
    evidence,
    diagnostics,
    drafts: input.shadowDrafts,
    criticDecisions: input.criticDecisions
  });
  const categories = assessCategories(diagnostics, problems);
  const limitations = uniqueStrings4(
    categories.filter((category) => category.state !== "assessed" && category.reason).map((category) => category.reason)
  ).slice(0, 100);
  return InsightSnapshotSchema.parse({
    workspaceId: input.workspaceId,
    runId: input.runId,
    clientId: input.clientId,
    evidence,
    diagnostics,
    problems,
    categories,
    ...input.accounting ? { accounting: input.accounting } : {},
    crawlCoverage: crawlCoverageFrom(input.bundle),
    ...limitations.length > 0 ? { limitations } : {}
  });
}
__name(buildInsightSnapshot, "buildInsightSnapshot");
