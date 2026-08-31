import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import * as repo from "@/db/repositories";
import { analyzeClient } from "@/pipeline/analyzeClient";
import { FixtureEvidenceProvider } from "@/adapters/evidence/FixtureEvidenceProvider";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import { generateProposalDraft } from "@/core/proposal";
import { hvacCatalog, hvacClient, hvacEvidence } from "./helpers/fixtures";

let db: NodeSqliteDb;

const NOW = new Date("2026-08-30T00:00:00.000Z");

async function seed() {
  for (const s of hvacCatalog()) await repo.upsertService(db, s);
  await repo.upsertClient(db, hvacClient());
}

async function analyzeAndPersist() {
  const client = (await repo.getClient(db, "client-coolbreeze"))!;
  const result = await analyzeClient({
    client,
    catalog: await repo.listServices(db),
    coverage: await repo.listCoverage(db, client.id),
    existing: await repo.listOpportunities(db, client.id),
    evidenceProvider: new FixtureEvidenceProvider([hvacEvidence()]),
    evaluator: new MockEvaluator(),
    now: NOW,
  });
  await repo.saveEvidence(db, result.evidence);
  await repo.saveAnalysis(db, [...result.opportunities, ...result.suppressed]);
  return result;
}

beforeEach(async () => {
  db = nodeSqliteDb(":memory:");
  await repo.applySchema(db);
  await seed();
});

afterEach(() => db.close());

describe("analyze -> persist -> decide -> re-analyze", () => {
  it("persists the surfaced opportunity", async () => {
    await analyzeAndPersist();
    const stored = await repo.listOpportunities(db, "client-coolbreeze");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.suggestedServiceId).toBe("svc-landing-page");
    expect(stored[0]?.status).toBe("new");
  });

  it("keeps a dismissed opportunity dismissed across a re-run (no resurface)", async () => {
    const first = await analyzeAndPersist();
    const id = first.opportunities[0]!.id;

    await repo.setOpportunityStatus(db, id, "dismissed");

    const second = await analyzeAndPersist();
    expect(second.opportunities).toHaveLength(0);
    expect(second.stats.suppressedByPriorDecision).toBe(1);
    expect(second.stats.aiCalls).toBe(0);

    const stored = await repo.listOpportunities(db, "client-coolbreeze");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.status).toBe("dismissed");
  });

  it("keeps a prepared proposal across a re-run", async () => {
    const first = await analyzeAndPersist();
    const opp = first.opportunities[0]!;
    const client = (await repo.getClient(db, "client-coolbreeze"))!;
    const service = (await repo.getService(db, opp.suggestedServiceId))!;

    const draft = generateProposalDraft({ opportunity: opp, client, service });
    await repo.setOpportunityProposal(db, opp.id, draft);

    await analyzeAndPersist();

    const stored = (await repo.getOpportunity(db, opp.id))!;
    expect(stored.status).toBe("proposal_prepared");
    expect(stored.proposalMd).toContain("# Proposal:");
    expect(stored.proposalMd).toContain("$900");
  });

  it("re-analysis after coverage is added moves it to already-covered and stops billing it", async () => {
    await analyzeAndPersist();
    await repo.setCoverage(db, "client-coolbreeze", "svc-landing-page", "now in retainer");

    const result = await analyzeAndPersist();
    expect(result.opportunities).toHaveLength(0);
    expect(result.stats.suppressedByCoverage).toBe(1);
    expect(result.stats.aiCalls).toBe(0);

    const stored = await repo.listOpportunities(db, "client-coolbreeze");
    expect(stored[0]?.billableStatus).toBe("already_covered");
    expect(stored[0]?.status).toBe("already_covered");
  });
});
