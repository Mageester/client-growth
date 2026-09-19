import type { EvidenceBundle } from "@/core/schema";
import { AnalysisCategoryAssessmentSchema, InsightSnapshotSchema, type Diagnostic, type EvidenceRef, type Problem } from "@/core/insightSchema";
import { INSIGHT_CATEGORIES } from "@/core/insightTaxonomy";
import { buildEvidenceLedger } from "@/core/evidenceLedger";
import { semanticDiagnosticDrafts } from "@/core/semanticDrafts";
import { materializeDiagnostics, assertShadowArtifacts, synthesizeProblems } from "@/core/problemSynthesis";
import type { ProblemDraft } from "@/core/siteUnderstandingSchema";

function uniqueStrings(values: readonly string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
function coverageInput(coverage: unknown, crawlExhaustive: boolean): unknown {
  if (typeof coverage === "string") return coverage;
  if (coverage && typeof coverage === "object" && "analyzable" in coverage) {
    const value = coverage as { analyzable: boolean; limitation?: string; reason?: string };
    const state = value.analyzable && (crawlExhaustive || value.limitation === "site-too-thin") ? "complete" : "partial";
    return { state, reason: value.reason, limitations: value.reason ? [value.reason] : [] };
  }
  return coverage;
}

export function crawlCoverageFrom(bundle: EvidenceBundle) {
  const site = bundle.site as EvidenceBundle["site"] & { coverage?: Record<string, unknown>; ignoredUrls?: Array<{ reason: string }> };
  const coverage = site.coverage;
  const ignored = Array.isArray(site.ignoredUrls) ? site.ignoredUrls : [];
  const countReason = (reason: string) => ignored.filter((entry) => entry.reason === reason).length;
  const known = new Set(["page-budget", "duplicate", "off-site", "robots", "depth", "unsupported"]);
  return {
    exhaustive: site.crawlExhaustive === true,
    discovered: typeof coverage?.discoveredUrls === "number" ? coverage.discoveredUrls : site.pages.length,
    attempted: typeof coverage?.attemptedUrls === "number" ? coverage.attemptedUrls : site.pages.length,
    retrieved: typeof coverage?.retrievedUrls === "number" ? coverage.retrievedUrls : site.pages.length,
    failed: typeof coverage?.failedUrls === "number" ? coverage.failedUrls : 0,
    rendered: typeof coverage?.renderedUrls === "number" ? coverage.renderedUrls : 0,
    deferredByPageBudget: countReason("page-budget"),
    duplicatesOfPagesAlreadyRead: countReason("duplicate"),
    offSite: countReason("off-site"),
    otherReasons: ignored.filter((entry) => !known.has(entry.reason)).length,
  };
}

function categoryReason(state: string, diagnostics: Diagnostic[], problems: Problem[]): string | undefined {
  if (state === "unassessed") return "No current diagnostic was produced for this category.";
  if (state === "blocked") return "Required evidence for this category was blocked.";
  if (state === "limited") return [...diagnostics.flatMap((diagnostic) => diagnostic.assessment.limitations), ...problems.flatMap((problem) => problem.rejectionReasons)].find((value) => value.trim()) ?? "Evidence for this category is limited by its policy.";
  return undefined;
}
function categoryState(diagnostics: Diagnostic[], problems: Problem[]): "assessed" | "limited" | "blocked" | "unassessed" {
  if (diagnostics.length === 0) return "unassessed";
  if (diagnostics.some((diagnostic) => diagnostic.state === "blocked" || diagnostic.assessment.coverage === "blocked")) return "blocked";
  if (diagnostics.some((diagnostic) => diagnostic.state !== "observed" || diagnostic.assessment.grade === "limited" || diagnostic.assessment.grade === "insufficient" || diagnostic.assessment.unassessedEvidence.length > 0 || diagnostic.assessment.limitations.length > 0) || problems.some((problem) => problem.qualityGate !== "supported")) return "limited";
  return "assessed";
}
function assessCategories(diagnostics: Diagnostic[], problems: Problem[]) {
  return INSIGHT_CATEGORIES.map((category) => {
    const categoryDiagnostics = diagnostics.filter((diagnostic) => diagnostic.category === category);
    const categoryProblems = problems.filter((problem) => problem.category === category);
    const state = categoryState(categoryDiagnostics, categoryProblems);
    const reason = categoryReason(state, categoryDiagnostics, categoryProblems);
    return AnalysisCategoryAssessmentSchema.parse({ category, state, diagnosticCount: categoryDiagnostics.length, problemCount: categoryProblems.length, ...(reason ? { reason } : {}), limitations: uniqueStrings(categoryDiagnostics.flatMap((diagnostic) => diagnostic.assessment.limitations)).slice(0, 50) });
  });
}

export interface BuildInsightSnapshotInput {
  workspaceId: string;
  runId: string;
  clientId: string;
  bundle: EvidenceBundle;
  coverage: unknown;
  drafts: readonly unknown[];
  shadowDrafts?: readonly ProblemDraft[];
  criticDecisions?: readonly unknown[];
  accounting?: unknown;
}

export function buildInsightSnapshot(input: BuildInsightSnapshotInput) {
  if (input.bundle.clientId !== input.clientId) throw new Error("Evidence bundle crosses the snapshot client boundary.");
  const evidence = buildEvidenceLedger({ runId: input.runId, bundle: input.bundle });
  const semanticDiagnostics = semanticDiagnosticDrafts(input.shadowDrafts ?? [], evidence);
  const diagnostics = materializeDiagnostics({ workspaceId: input.workspaceId, runId: input.runId, clientId: input.clientId, coverage: coverageInput(input.coverage, input.bundle.site.crawlExhaustive === true), drafts: [...input.drafts, ...semanticDiagnostics], ledger: evidence });
  const problems = synthesizeProblems({ workspaceId: input.workspaceId, runId: input.runId, clientId: input.clientId, diagnostics });
  assertShadowArtifacts({ workspaceId: input.workspaceId, runId: input.runId, clientId: input.clientId, evidence, diagnostics, drafts: input.shadowDrafts, criticDecisions: input.criticDecisions });
  const categories = assessCategories(diagnostics, problems);
  const limitations = uniqueStrings(categories.filter((category) => category.state !== "assessed" && category.reason).map((category) => category.reason!)).slice(0, 100);
  return InsightSnapshotSchema.parse({ workspaceId: input.workspaceId, runId: input.runId, clientId: input.clientId, evidence, diagnostics, problems, categories, ...(input.accounting ? { accounting: input.accounting } : {}), crawlCoverage: crawlCoverageFrom(input.bundle), ...(limitations.length > 0 ? { limitations } : {}) });
}
