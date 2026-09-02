import type { Client } from "@/core/schema";
import { FixtureEvidenceProvider } from "@/adapters/evidence/FixtureEvidenceProvider";
import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { createEvaluator } from "@/adapters/evaluator/createEvaluator";
import { parseEnv } from "@/config/env";
import { classifyAnalysis, type AnalysisOutcomeResult } from "@/core/analysisOutcome";
import { analyzeClient, type AnalyzeClientResult } from "@/pipeline/analyzeClient";
import * as repo from "@/db/repositories";
import type { TenantScope } from "@/db/tenant";

import hvacEvidence from "../../fixtures/hvac/evidence.json";

/**
 * The seeded demo client (only ever present in ws_demo) has a non-real domain,
 * so it uses the bundled fixture. Every other client is scanned for real.
 */
const DEMO_FIXTURE_CLIENT_ID = "client-coolbreeze";
const DEMO_WORKSPACE_ID = "ws_demo";

function evidenceProviderFor(client: Client, workspaceId: string) {
  if (client.id === DEMO_FIXTURE_CLIENT_ID && workspaceId === DEMO_WORKSPACE_ID) {
    return new FixtureEvidenceProvider([hvacEvidence]);
  }
  return new HttpEvidenceProvider({ maxPages: 10 });
}

export interface RunAnalysisResult extends AnalyzeClientResult {
  /** The truthful, persisted classification of this run. */
  verdict: AnalysisOutcomeResult;
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
): Promise<RunAnalysisResult> {
  const client = await repo.getClient(t, clientId);
  if (!client) throw new Response("Client not found", { status: 404 });

  const startedAt = new Date().toISOString();
  const parsed = parseEnv(env);
  const result = await analyzeClient({
    client,
    catalog: await repo.listServices(t),
    coverage: await repo.listCoverage(t, clientId),
    existing: await repo.listOpportunities(t, clientId),
    evidenceProvider: evidenceProviderFor(client, t.workspaceId),
    evaluator: createEvaluator(parsed),
    maxAiCalls: parsed.MAX_AI_CALLS_PER_RUN,
  });

  const verdict = classifyAnalysis({
    evidence: result.evidence,
    analyzable: result.coverage.analyzable,
    coverageReason: result.coverage.reason,
    surfaced: result.opportunities.length,
    evaluatorErrors: result.stats.evaluatorErrors,
    catalog: result.catalogCoverage,
  });

  await repo.saveEvidence(t, result.evidence);
  await repo.saveAnalysis(t, [...result.opportunities, ...result.suppressed]);
  await repo.recordAnalysisRun(t, {
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
  });

  return { ...result, verdict };
}
