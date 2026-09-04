import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ClientSchema, OpportunitySchema, ServiceSchema } from "@/core/schema";
import { deleteClient } from "@/db/deleteClient";
import * as monitoringRepo from "@/db/monitoring";
import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import * as repo from "@/db/repositories";
import { SCHEMA_SQL } from "@/db/schema";
import type { TenantScope } from "@/db/tenant";
import { createWorkspaceForOwner, getWorkspace } from "@/db/workspaces";
import { hvacEvidence } from "./helpers/fixtures";

let db: NodeSqliteDb;
let a: TenantScope;
let b: TenantScope;

beforeEach(async () => {
  db = nodeSqliteDb(":memory:");
  await db.exec(SCHEMA_SQL);
  await createWorkspaceForOwner(db, { id: "ws_a", name: "A", ownerUserId: "u_a" });
  await createWorkspaceForOwner(db, { id: "ws_b", name: "B", ownerUserId: "u_b" });
  a = { db, workspaceId: "ws_a" };
  b = { db, workspaceId: "ws_b" };
  await saveClient(a, "cli_a", "Alpha");
  await saveClient(b, "cli_b", "Beta");
});

afterEach(() => db.close());

async function saveClient(t: TenantScope, id: string, name: string): Promise<void> {
  await repo.upsertClient(
    t,
    ClientSchema.parse({
      id,
      name,
      domain: `${id}.example`,
      offerings: ["web design"],
      notes: "",
    }),
  );
}

describe("deleteClient", () => {
  it("deletes a confirmed client and cascades all of its data", async () => {
    await repo.upsertService(
      a,
      ServiceSchema.parse({
        id: "svc_a",
        name: "Service A",
        description: "",
        priceMin: 100,
        priceMax: 200,
        tags: ["landing-page"],
        active: true,
      }),
    );
    await repo.upsertService(
      b,
      ServiceSchema.parse({
        id: "svc_b",
        name: "Service B",
        description: "",
        priceMin: 300,
        priceMax: 400,
        tags: ["landing-page"],
        active: true,
      }),
    );
    await repo.setCoverage(a, "cli_a", "svc_a", "retainer");
    await repo.saveEvidence(a, { ...hvacEvidence(), clientId: "cli_a" });
    await repo.saveAnalysis(a, [
      OpportunitySchema.parse({
        id: "opp_a",
        dedupeKey: "opp-a",
        clientId: "cli_a",
        ruleId: "missing-service-page",
        title: "Build a landing page",
        detected: "The page is missing.",
        evidenceRefs: [],
        rationale: "It is sellable work.",
        suggestedServiceId: "svc_a",
        suggestedScope: ["Build the page"],
        priceMin: 100,
        priceMax: 200,
        confidence: 0.9,
        billableStatus: "billable",
        status: "new",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }),
    ]);
    await repo.recordAnalysisRun(a, {
      clientId: "cli_a",
      startedAt: "2026-09-01T00:00:00.000Z",
      finishedAt: "2026-09-01T00:01:00.000Z",
      source: "fixture",
      outcome: "findings",
      summary: "One finding.",
      limitation: null,
      pagesRead: 1,
      pagesFetched: 1,
      blockedEvents: 0,
      inconclusiveEvents: 0,
      surfaced: 1,
      stats: {},
      trigger: "scheduled",
      newCount: 1,
      resolvedCount: 0,
      evaluatorCalls: 0,
      evaluatorRejections: 0,
      evaluatorErrors: 0,
    });
    await monitoringRepo.setMonitoringCadence(a, "cli_a", "weekly", {
      lastAnalyzedAt: null,
      now: new Date("2026-09-01T00:00:00.000Z"),
    });

    const result = await deleteClient(a, "cli_a", "Alpha");

    expect(result).toEqual({ status: "deleted" });
    expect(await repo.getClient(a, "cli_a")).toBeNull();
    expect(await repo.getClient(b, "cli_b")).not.toBeNull();
    for (const table of ["client_coverage", "evidence_bundles", "opportunities", "analysis_runs"]) {
      const row = await db
        .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ? AND client_id = ?`)
        .bind("ws_a", "cli_a")
        .first<{ count: number }>();
      expect(row?.count).toBe(0);
    }
    expect(await monitoringRepo.getMonitoring(a, "cli_a")).toBeNull();
    expect(await getWorkspace(db, "ws_a")).not.toBeNull();
    expect(await repo.listServices(a)).toHaveLength(1);
    expect(await repo.listServices(b)).toHaveLength(1);
    expect(await db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("does not delete when the confirmation does not exactly match", async () => {
    const result = await deleteClient(a, "cli_a", "Alpha typo");

    expect(result).toEqual({ status: "confirmation_mismatch" });
    expect(await repo.getClient(a, "cli_a")).not.toBeNull();
  });

  it("returns not_found for a missing client", async () => {
    const result = await deleteClient(a, "missing", "Alpha");

    expect(result).toEqual({ status: "not_found" });
  });

  it("cannot delete a client belonging to another workspace", async () => {
    const result = await deleteClient(a, "cli_b", "Beta");

    expect(result).toEqual({ status: "not_found" });
    expect(await repo.getClient(b, "cli_b")).not.toBeNull();
  });
});
