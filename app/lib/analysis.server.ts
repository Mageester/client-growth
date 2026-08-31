import type { Client } from "@/core/schema";
import { FixtureEvidenceProvider } from "@/adapters/evidence/FixtureEvidenceProvider";
import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { createEvaluator } from "@/adapters/evaluator/createEvaluator";
import { parseEnv } from "@/config/env";
import { analyzeClient, type AnalyzeClientResult } from "@/pipeline/analyzeClient";
import * as repo from "@/db/repositories";
import type { SqlDb } from "@/db/sql";

import hvacEvidence from "../../fixtures/hvac/evidence.json";

/**
 * The seeded demo client's domain is not a real site, so it always uses the
 * bundled fixture. Every other client is scanned for real over HTTP.
 */
const DEMO_FIXTURE_CLIENT_ID = "client-coolbreeze";

function evidenceProviderFor(client: Client) {
  if (client.id === DEMO_FIXTURE_CLIENT_ID) {
    return new FixtureEvidenceProvider([hvacEvidence]);
  }
  return new HttpEvidenceProvider({ maxPages: 10 });
}

export async function runAnalysis(
  db: SqlDb,
  env: Record<string, unknown>,
  clientId: string,
): Promise<AnalyzeClientResult> {
  const client = await repo.getClient(db, clientId);
  if (!client) throw new Response("Client not found", { status: 404 });

  const parsed = parseEnv(env);
  const result = await analyzeClient({
    client,
    catalog: await repo.listServices(db),
    coverage: await repo.listCoverage(db, clientId),
    existing: await repo.listOpportunities(db, clientId),
    evidenceProvider: evidenceProviderFor(client),
    evaluator: createEvaluator(parsed),
    maxAiCalls: parsed.MAX_AI_CALLS_PER_RUN,
  });

  await repo.saveEvidence(db, result.evidence);
  await repo.saveAnalysis(db, [...result.opportunities, ...result.suppressed]);
  return result;
}
