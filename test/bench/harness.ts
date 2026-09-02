import { dedupeKey } from "@/core/dedupe";
import { classifyAnalysis, type AnalysisOutcome } from "@/core/analysisOutcome";
import { analyzeClient, type AnalyzeClientStats } from "@/pipeline/analyzeClient";
import { OpportunitySchema, type Opportunity } from "@/core/schema";
import type { OpportunityEvaluator } from "@/ports/OpportunityEvaluator";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";

import { agencyCatalog } from "./agency";
import { BenchEvidenceProvider } from "./site";
import { CASES, clientIdOf, clientOf, coverageOf, type BenchCase, type Grade } from "./cases";

/**
 * Runs every labeled case through the real pipeline and grades the result
 * against the human expectation.
 *
 * Grading is deliberately asymmetric. A false positive — pitching a client work
 * that is not justified — is always BAD, because it costs the agency its
 * credibility. A false negative is QUESTIONABLE: the product found less than it
 * could, which is disappointing but not damaging. Over-claiming an outcome
 * ("clean" when the site was never read) is BAD for the same reason as a false
 * positive: it is an untrue statement the agency might act on.
 */

const NOW = new Date("2026-09-02T00:00:00.000Z");

function priorOpportunity(
  c: BenchCase,
  spec: NonNullable<BenchCase["existing"]>[number],
): Opportunity {
  const clientId = clientIdOf(c);
  return OpportunitySchema.parse({
    id: "opp-prior-" + spec.subject.replace(/\W+/g, "-"),
    dedupeKey: dedupeKey(clientId, spec.ruleId, spec.subject),
    clientId,
    ruleId: spec.ruleId,
    title: spec.title ?? spec.subject,
    detected: spec.detected ?? "Recorded by an earlier run.",
    evidenceRefs: [],
    rationale: spec.rationale ?? "Recorded by an earlier run.",
    suggestedServiceId: spec.suggestedServiceId ?? "svc-landing-page",
    suggestedScope: [],
    priceMin: 900,
    priceMax: 1800,
    confidence: 0.7,
    billableStatus: spec.billableStatus ?? "billable",
    status: spec.status ?? "new",
    snoozeUntil: spec.snoozeUntil,
    updatedAt: "2026-08-01T00:00:00.000Z",
  });
}

export interface CaseResult {
  id: string;
  clientName: string;
  what: string;
  rationale: string;
  outcome: AnalysisOutcome;
  expectOutcome: AnalysisOutcome;
  summary: string;
  limitation: string | null;
  stats: AnalyzeClientStats;
  fetches: number;
  probes: number;
  surfaced: Array<{ ruleId: string; title: string; dedupeKey: string; priceMin: number; priceMax: number }>;
  expected: number;
  truePositives: number;
  falsePositives: string[];
  falseNegatives: string[];
  grade: Grade;
  why: string;
}

export async function runCase(
  c: BenchCase,
  evaluator: OpportunityEvaluator = new MockEvaluator(),
): Promise<CaseResult> {
  const client = clientOf(c);
  const provider = new BenchEvidenceProvider(client.id, c.site);
  const existing = (c.existing ?? []).map((spec) => priorOpportunity(c, spec));

  const result = await analyzeClient({
    client,
    catalog: agencyCatalog(),
    coverage: coverageOf(c),
    existing,
    evidenceProvider: provider,
    evaluator,
    now: NOW,
  });

  const verdict = classifyAnalysis({
    evidence: result.evidence,
    analyzable: result.coverage.analyzable,
    coverageReason: result.coverage.reason,
    surfaced: result.opportunities.length,
    evaluatorErrors: result.stats.evaluatorErrors,
    catalog: result.catalogCoverage,
  });

  const surfaced = result.opportunities.map((o) => ({
    ruleId: o.ruleId,
    title: o.title,
    dedupeKey: o.dedupeKey,
    priceMin: o.priceMin,
    priceMax: o.priceMax,
  }));

  const unmatched = [...surfaced];
  const falseNegatives: string[] = [];
  let truePositives = 0;
  for (const want of c.expect) {
    const hitIndex = unmatched.findIndex(
      (s) =>
        s.ruleId === want.ruleId &&
        (s.dedupeKey.includes(slug(want.subject)) ||
          s.title.toLowerCase().includes(want.subject.toLowerCase())),
    );
    if (hitIndex === -1) {
      falseNegatives.push(`${want.ruleId}: ${want.subject}`);
    } else {
      truePositives++;
      unmatched.splice(hitIndex, 1);
    }
  }
  const falsePositives = unmatched.map((s) => `${s.ruleId}: ${s.title}`);

  const overclaimed =
    verdict.outcome !== c.expectOutcome && c.expectOutcome === "inconclusive";
  const underclaimed = verdict.outcome !== c.expectOutcome && !overclaimed;

  let grade: Grade;
  let why: string;
  if (falsePositives.length > 0) {
    grade = "BAD";
    why = `Surfaced work the agency should not pitch: ${falsePositives.join("; ")}.`;
  } else if (overclaimed) {
    grade = "BAD";
    why = `Reported "${verdict.outcome}" for a run that should have been inconclusive.`;
  } else if (falseNegatives.length > 0) {
    grade = "QUESTIONABLE";
    why = `Missed real, sellable work: ${falseNegatives.join("; ")}.`;
  } else if (underclaimed) {
    grade = "QUESTIONABLE";
    why = `Expected outcome "${c.expectOutcome}" but reported "${verdict.outcome}".`;
  } else {
    grade = "GOOD";
    why =
      c.expect.length > 0
        ? `Surfaced exactly the ${c.expect.length} expected finding(s) and nothing else.`
        : "Correctly surfaced nothing.";
  }

  return {
    id: c.id,
    clientName: c.clientName,
    what: c.what,
    rationale: c.rationale,
    outcome: verdict.outcome,
    expectOutcome: c.expectOutcome,
    summary: verdict.summary,
    limitation: verdict.limitation,
    stats: result.stats,
    fetches: provider.fetches.length,
    probes: provider.probes.length,
    surfaced,
    expected: c.expect.length,
    truePositives,
    falsePositives,
    falseNegatives,
    grade,
    why,
  };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface Scorecard {
  results: CaseResult[];
  good: number;
  questionable: number;
  bad: number;
  falsePositives: number;
  falseNegatives: number;
  evaluatorCalls: number;
}

export async function runBenchmark(
  evaluator?: OpportunityEvaluator,
  cases: BenchCase[] = CASES,
): Promise<Scorecard> {
  const results: CaseResult[] = [];
  for (const c of cases) results.push(await runCase(c, evaluator));
  return {
    results,
    good: results.filter((r) => r.grade === "GOOD").length,
    questionable: results.filter((r) => r.grade === "QUESTIONABLE").length,
    bad: results.filter((r) => r.grade === "BAD").length,
    falsePositives: results.reduce((n, r) => n + r.falsePositives.length, 0),
    falseNegatives: results.reduce((n, r) => n + r.falseNegatives.length, 0),
    evaluatorCalls: results.reduce((n, r) => n + r.stats.aiCalls, 0),
  };
}
