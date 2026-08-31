/**
 * PRODUCT VALIDATION HARNESS (not product code).
 *
 * Runs real business websites through the existing missing-service-page rule +
 * the real DeepSeek evaluator and records the results for manual grading.
 *
 *   DEEPSEEK_API_KEY=... tsx scripts/validation/run.ts
 *
 * Hard budget stop: MAX_AI_CALLS. Writes scripts/validation/results.json.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HttpEvidenceProvider } from "../../src/adapters/evidence/HttpEvidenceProvider";
import { DeepSeekEvaluator } from "../../src/adapters/evaluator/DeepSeekEvaluator";
import { runRules } from "../../src/core/rules";
import { passesEvidenceThreshold } from "../../src/core/threshold";
import { resolveBillability } from "../../src/core/billability";
import { significantTokens } from "../../src/core/text";
import { assessServiceCoverage } from "../../src/core/absenceVerification";
import { ClientSchema, type Candidate, type EvidenceBundle } from "../../src/core/schema";
import { CATALOG } from "./catalog";
import { CASES as CASES_FRANCHISE } from "./cases";
import { CASES as CASES_LOCAL } from "./cases.local";

const CASES = process.env.VAL_CASESET === "local" ? CASES_LOCAL : CASES_FRANCHISE;
const OUT_FILE = process.env.VAL_OUT ?? "results.json";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_AI_CALLS = process.env.VAL_MAX_AI ? Number(process.env.VAL_MAX_AI) : 70;
const MAX_PAGES = 8;
const USD_IN = 0.27 / 1_000_000;
const USD_OUT = 1.1 / 1_000_000;

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("DEEPSEEK_API_KEY is required for the validation run.");
  process.exit(1);
}
const evaluator = new DeepSeekEvaluator({ apiKey });

interface CandidateResult {
  website: string;
  vertical: string;
  offering: string;
  passedThreshold: boolean;
  outcome: "surfaced" | "rejected" | "below-threshold" | "evaluator-error";
  confidence: number | null;
  suggestedService: string | null;
  suggestedPriceRange: string | null;
  rationale: string | null;
  suggestedScope: string[] | null;
  verificationReason: string | null;
  verificationInspected: string[];
  verificationCloseMatches: { value: string; satisfied: boolean; reason: string }[];
  evidenceRefs: string[];
}

interface SiteResult {
  id: string;
  name: string;
  website: string;
  vertical: string;
  crawl: {
    ok: boolean;
    pages: number;
    navCount: number;
    error?: string;
    pageTitles: string[];
    navLabels: string[];
  };
  analyzable: boolean;
  coverageReason: string;
  offeringsEvaluated: number;
  suppressedOfferings: string[];
  skippedOfferings: string[];
  candidates: CandidateResult[];
}

let aiCalls = 0;
let promptTokens = 0;
let completionTokens = 0;
let verifyFetches = 0;

async function evaluateOne(
  website: string,
  vertical: string,
  offering: string,
  candidate: Candidate,
  evidence: EvidenceBundle,
  client: ReturnType<typeof ClientSchema.parse>,
): Promise<CandidateResult> {
  const base: CandidateResult = {
    website,
    vertical,
    offering,
    passedThreshold: true,
    outcome: "rejected",
    confidence: null,
    suggestedService: null,
    suggestedPriceRange: null,
    rationale: null,
    suggestedScope: null,
    verificationReason: candidate.verification?.reason ?? null,
    verificationInspected: candidate.verification?.inspectedUrls ?? [],
    verificationCloseMatches: (candidate.verification?.closeMatches ?? []).map((m) => ({
      value: m.value,
      satisfied: m.satisfied,
      reason: m.reason,
    })),
    evidenceRefs: candidate.evidenceRefs.filter((r) => !r.startsWith("nav:")),
  };

  if (aiCalls >= MAX_AI_CALLS) {
    return { ...base, outcome: "evaluator-error", rationale: "budget stop" };
  }

  aiCalls++;
  let evaluation;
  try {
    evaluation = await evaluator.evaluate({ candidate, client, evidence });
  } catch (err) {
    return {
      ...base,
      outcome: "evaluator-error",
      rationale: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
  if (evaluator.lastUsage) {
    promptTokens += evaluator.lastUsage.promptTokens;
    completionTokens += evaluator.lastUsage.completionTokens;
  }

  const service = CATALOG.find((s) => s.id === candidate.suggestedServiceId) ?? null;
  const surfaced = evaluation.verdict === "surface" && evaluation.confidence >= 0.5;
  return {
    ...base,
    outcome: surfaced ? "surfaced" : "rejected",
    confidence: evaluation.confidence,
    suggestedService: service?.name ?? candidate.suggestedServiceId,
    suggestedPriceRange: service ? `$${service.priceMin}-$${service.priceMax}` : null,
    rationale: evaluation.rationale,
    suggestedScope: evaluation.suggestedScope,
  };
}

async function runSite(testCase: (typeof CASES)[number]): Promise<SiteResult> {
  const client = ClientSchema.parse({
    id: `val-${testCase.id}`,
    name: testCase.name,
    domain: testCase.domain,
    offerings: testCase.offerings,
  });

  const provider = new HttpEvidenceProvider({ maxPages: MAX_PAGES });
  let evidence: EvidenceBundle | null = null;
  let crawlError: string | undefined;
  try {
    evidence = await provider.getEvidence(client);
  } catch (err) {
    crawlError = err instanceof Error ? err.message : String(err);
  }

  const result: SiteResult = {
    id: testCase.id,
    name: testCase.name,
    website: testCase.domain,
    vertical: testCase.vertical,
    crawl: {
      ok: Boolean(evidence && evidence.site.pages.length > 0),
      pages: evidence?.site.pages.length ?? 0,
      navCount: evidence?.site.nav.length ?? 0,
      error: crawlError,
      pageTitles: evidence?.site.pages.map((p) => p.title) ?? [],
      navLabels: evidence?.site.nav ?? [],
    },
    analyzable: true,
    coverageReason: "",
    offeringsEvaluated: 0,
    suppressedOfferings: [],
    skippedOfferings: [],
    candidates: [],
  };

  if (!evidence || evidence.site.pages.length === 0) {
    result.analyzable = false;
    result.coverageReason = crawlError ? `crawl failed: ${crawlError}` : "no pages crawled";
    return result;
  }

  const cov = assessServiceCoverage({ client, evidence });
  result.analyzable = cov.analyzable;
  result.coverageReason = cov.reason;
  if (!cov.analyzable) return result;

  const countedFetch = async (url: string) => {
    verifyFetches++;
    return provider.fetchPage(url);
  };
  const candidates = await runRules({
    client,
    catalog: CATALOG,
    evidence,
    fetchPage: countedFetch,
    verifyBudget: { remaining: 12 },
  });

  // Offerings the rule considered but did not surface: either no distinctive
  // tokens (skipped) or verification found an existing page (suppressed).
  const candidateSubjects = new Set(candidates.map((c) => c.subject));
  for (const offering of testCase.offerings) {
    result.offeringsEvaluated++;
    if (candidateSubjects.has(offering)) continue;
    if (significantTokens(offering).length === 0) result.skippedOfferings.push(offering);
    else result.suppressedOfferings.push(offering);
  }

  for (const candidate of candidates) {
    if (!passesEvidenceThreshold(candidate, evidence)) {
      result.candidates.push({
        website: testCase.domain,
        vertical: testCase.vertical,
        offering: candidate.subject,
        passedThreshold: false,
        outcome: "below-threshold",
        confidence: null,
        suggestedService: null,
        suggestedPriceRange: null,
        rationale: null,
        suggestedScope: null,
        verificationReason: candidate.verification?.reason ?? null,
        verificationInspected: candidate.verification?.inspectedUrls ?? [],
        verificationCloseMatches: [],
        evidenceRefs: [],
      });
      continue;
    }
    const billable = resolveBillability(candidate.suggestedServiceId, []);
    if (billable !== "billable") continue;
    result.candidates.push(
      await evaluateOne(testCase.domain, testCase.vertical, candidate.subject, candidate, evidence, client),
    );
  }

  return result;
}

async function main() {
  const results: SiteResult[] = [];
  const limit = process.env.VAL_LIMIT ? Number(process.env.VAL_LIMIT) : CASES.length;
  for (const testCase of CASES.slice(0, limit)) {
    process.stdout.write(`\n▶ ${testCase.name} (${testCase.domain}) ... `);
    const r = await runSite(testCase);
    results.push(r);
    if (!r.crawl.ok) {
      process.stdout.write(`crawl FAILED (${r.crawl.error ?? "0 pages"})`);
    } else if (!r.analyzable) {
      process.stdout.write(`${r.crawl.pages} pages, nav ${r.crawl.navCount} | NOT ANALYZABLE — ${r.coverageReason}`);
    } else {
      const surfaced = r.candidates.filter((c) => c.outcome === "surfaced").length;
      const rejected = r.candidates.filter((c) => c.outcome === "rejected").length;
      const below = r.candidates.filter((c) => c.outcome === "below-threshold").length;
      process.stdout.write(
        `${r.crawl.pages} pages, nav ${r.crawl.navCount} | suppressed ${r.suppressedOfferings.length} | candidates: ${r.candidates.length} (surfaced ${surfaced}, rejected ${rejected}, below-threshold ${below})`,
      );
    }
    if (aiCalls >= MAX_AI_CALLS) {
      process.stdout.write(`\n\n!! AI call budget (${MAX_AI_CALLS}) reached — stopping early.\n`);
      break;
    }
  }

  const costUsd = promptTokens * USD_IN + completionTokens * USD_OUT;
  const summary = {
    generatedAt: new Date().toISOString(),
    caseSet: process.env.VAL_CASESET === "local" ? "local" : "franchise",
    sites: results.length,
    crawlOk: results.filter((r) => r.crawl.ok).length,
    crawlFailed: results.filter((r) => !r.crawl.ok).length,
    analyzable: results.filter((r) => r.analyzable).length,
    notAnalyzable: results.filter((r) => !r.analyzable).length,
    offeringsEvaluated: results.reduce((n, r) => n + r.offeringsEvaluated, 0),
    suppressedOfferings: results.reduce((n, r) => n + r.suppressedOfferings.length, 0),
    skippedOfferings: results.reduce((n, r) => n + r.skippedOfferings.length, 0),
    candidates: results.reduce((n, r) => n + r.candidates.length, 0),
    verifyFetches,
    aiCalls,
    tokens: { prompt: promptTokens, completion: completionTokens },
    approxCostUsd: Number(costUsd.toFixed(5)),
    outcomes: {
      surfaced: results.flatMap((r) => r.candidates).filter((c) => c.outcome === "surfaced").length,
      rejected: results.flatMap((r) => r.candidates).filter((c) => c.outcome === "rejected").length,
      belowThreshold: results
        .flatMap((r) => r.candidates)
        .filter((c) => c.outcome === "below-threshold").length,
      evaluatorError: results
        .flatMap((r) => r.candidates)
        .filter((c) => c.outcome === "evaluator-error").length,
    },
  };

  writeFileSync(
    join(HERE, OUT_FILE),
    JSON.stringify({ summary, results }, null, 2),
  );

  console.log("\n\n==================== SUMMARY ====================");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote scripts/validation/${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
