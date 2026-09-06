import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { analyzeClient } from "@/pipeline/analyzeClient";
import { FixtureEvidenceProvider } from "@/adapters/evidence/FixtureEvidenceProvider";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { ClientSchema, type Opportunity } from "@/core/schema";
import { computeWinRates } from "@/core/winRates";
import type { TenantScope } from "@/db/tenant";
import { coverageNone, hvacCatalog, hvacClient, hvacEvidence } from "./helpers/fixtures";

const NOW = new Date("2026-08-30T00:00:00.000Z");

function analyze(existing: Opportunity[] = []) {
  return analyzeClient({
    client: hvacClient(),
    catalog: hvacCatalog(),
    coverage: coverageNone(),
    evidenceProvider: new FixtureEvidenceProvider([hvacEvidence()]),
    evaluator: new MockEvaluator(),
    existing,
    now: NOW,
  });
}

describe("a finding the agency sold", () => {
  it("does not come back on the next run, and costs no AI call", async () => {
    const first = await analyze();
    const opp = first.opportunities[0] as Opportunity;
    expect(opp).toBeDefined();

    const sold: Opportunity = { ...opp, status: "sold", soldAmount: 1800 };
    const second = await analyze([sold]);

    // Re-surfacing it would put work the agency has been paid for back in
    // their queue AND overwrite the sale with a fresh "new" row.
    expect(second.opportunities.map((o) => o.dedupeKey)).not.toContain(sold.dedupeKey);
    expect(second.suppressed.map((o) => o.dedupeKey)).toContain(sold.dedupeKey);
    expect(second.stats.aiCalls).toBe(0);
  });

  it("keeps the sale amount through the re-run", async () => {
    const first = await analyze();
    const opp = first.opportunities[0] as Opportunity;
    const sold: Opportunity = { ...opp, status: "sold", soldAmount: 1800 };
    const second = await analyze([sold]);

    const kept = second.suppressed.find((o) => o.dedupeKey === sold.dedupeKey);
    expect(kept?.soldAmount).toBe(1800);
    expect(kept?.status).toBe("sold");
  });
});

describe("recording a sale", () => {
  let db: NodeSqliteDb;
  let scope: TenantScope;
  let openId: string;

  beforeEach(async () => {
    db = nodeSqliteDb(":memory:");
    await repo.applySchema(db);
    await createWorkspaceForOwner(db, { id: "ws_a", name: "A", ownerUserId: "u_a" });
    scope = { db, workspaceId: "ws_a" };
    await repo.upsertClient(
      scope,
      ClientSchema.parse({ id: "cli_1", name: "C", domain: "c.example", offerings: ["x"] }),
    );

    // The opportunity is priced from a catalog service, and the repository
    // refuses to persist one that points outside the workspace.
    for (const service of hvacCatalog()) await repo.upsertService(scope, service);

    const result = await analyze();
    const opp = result.opportunities[0] as Opportunity;
    openId = opp.id;
    await repo.saveAnalysis(scope, [{ ...opp, clientId: "cli_1" }]);
  });

  afterEach(() => db.close());

  it("stores the amount and shows up in the win rate", async () => {
    expect(await repo.recordOpportunitySale(scope, openId, { amount: 1800 })).toBe(true);

    const stored = await repo.getOpportunity(scope, openId);
    expect(stored?.status).toBe("sold");
    expect(stored?.soldAmount).toBe(1800);
    expect(stored?.soldAt).toBeTruthy();

    const rates = computeWinRates(await repo.listOpportunities(scope, "cli_1"));
    expect(rates.totalSold).toBe(1);
    expect(rates.totalSoldValue).toBe(1800);
  });

  it("records the win even when nobody types an amount", async () => {
    expect(await repo.recordOpportunitySale(scope, openId)).toBe(true);
    const stored = await repo.getOpportunity(scope, openId);
    expect(stored?.status).toBe("sold");
    expect(stored?.soldAmount).toBeUndefined();

    // The fact that it sold is the signal; the amount is a bonus.
    const rates = computeWinRates(await repo.listOpportunities(scope, "cli_1"));
    expect(rates.totalSold).toBe(1);
    expect(rates.byRule.get(stored!.ruleId)!.valuedSales).toBe(0);
  });

  it("clears the sale when the finding is moved back out of sold", async () => {
    await repo.recordOpportunitySale(scope, openId, { amount: 1800 });
    await repo.setOpportunityStatus(scope, openId, "new");

    const stored = await repo.getOpportunity(scope, openId);
    expect(stored?.status).toBe("new");
    // Leaving the amount behind would inflate every win rate with a sale the
    // agency has taken back.
    expect(stored?.soldAmount).toBeUndefined();
    expect(stored?.soldAt).toBeUndefined();

    const rates = computeWinRates(await repo.listOpportunities(scope, "cli_1"));
    expect(rates.totalSold).toBe(0);
    expect(rates.totalSoldValue).toBe(0);
  });

  it("cannot record a sale against another workspace's finding", async () => {
    await createWorkspaceForOwner(db, { id: "ws_b", name: "B", ownerUserId: "u_b" });
    const foreign: TenantScope = { db, workspaceId: "ws_b" };

    expect(await repo.recordOpportunitySale(foreign, openId, { amount: 5000 })).toBe(false);
    const stored = await repo.getOpportunity(scope, openId);
    expect(stored?.status).not.toBe("sold");
  });

  it("refuses a negative amount rather than storing it", async () => {
    await repo.recordOpportunitySale(scope, openId, { amount: -100 });
    const stored = await repo.getOpportunity(scope, openId);
    expect(stored?.status).toBe("sold");
    expect(stored?.soldAmount).toBeUndefined();
  });
});
