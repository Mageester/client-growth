import { describe, expect, it } from "vitest";

import { InsightSnapshotSchema } from "@/core/insightSchema";
import { INSIGHT_CATEGORIES } from "@/core/insightTaxonomy";
import { EvidenceBundleSchema } from "@/core/schema";
import { saveAnalysisCompletion, applySchema } from "@/db/repositories";
import { nodeSqliteDb } from "@/db/nodeSqlite";

import rawEvidence from "../fixtures/hvac/evidence.json";

describe("recovered atomic analysis completion", () => {
  it("writes typed persistence and returns the same run on an idempotent retry", async () => {
    const db = nodeSqliteDb(":memory:");
    try {
      await applySchema(db);
      await db.prepare("INSERT INTO workspaces (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)")
        .bind("ws_test", "Test", "user_test", "2026-09-19T00:00:00.000Z").run();
      await db.prepare("INSERT INTO services (id, workspace_id, name, description, price_min, price_max, tags, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind("svc_test", "ws_test", "Landing page", "", 900, 1800, '["landing-page"]', 1, "2026-09-19T00:00:00.000Z").run();
      await db.prepare("INSERT INTO clients (id, workspace_id, name, domain, offerings, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind("client-coolbreeze", "ws_test", "Cool Breeze", "coolbreezehvac.example", '["duct cleaning"]', "", "2026-09-19T00:00:00.000Z").run();
      await db.prepare("INSERT INTO analysis_limit_reservations (workspace_id, client_id, reserved_at, day_utc) VALUES (?, ?, ?, ?)")
        .bind("ws_test", "client-coolbreeze", "2026-09-19T00:00:00.000Z", "2026-09-19").run();

      const evidence = EvidenceBundleSchema.parse({
        ...rawEvidence,
        clientId: "client-coolbreeze",
      });
      const snapshot = InsightSnapshotSchema.parse({
        workspaceId: "ws_test",
        runId: "1",
        clientId: "client-coolbreeze",
        evidence: [],
        diagnostics: [],
        problems: [],
        categories: INSIGHT_CATEGORIES.map((category) => ({
          category,
          state: "unassessed" as const,
          diagnosticCount: 0,
          problemCount: 0,
          reason: "No current diagnostic was produced for this category.",
          limitations: [],
        })),
      });
      const scope = { db, workspaceId: "ws_test" };
      const input: Parameters<typeof saveAnalysisCompletion>[1] = {
        evidence,
        insightSnapshot: snapshot,
        opportunities: [],
        run: {
          clientId: "client-coolbreeze",
          startedAt: "2026-09-19T00:00:00.000Z",
          finishedAt: "2026-09-19T00:01:00.000Z",
          source: "fixture",
          outcome: "clean" as const,
          summary: "No unmet billable work.",
          limitation: null,
          pagesRead: 1,
          pagesFetched: 1,
          blockedEvents: 0,
          inconclusiveEvents: 0,
          surfaced: 0,
          stats: { aiCalls: 0 },
          trigger: "manual" as const,
          newCount: 0,
          resolvedCount: 0,
          evaluatorCalls: 0,
          evaluatorRejections: 0,
          evaluatorErrors: 0,
        },
      };
      const first = await saveAnalysisCompletion(scope, input);
      const second = await saveAnalysisCompletion(scope, input);
      expect(first).toBeGreaterThan(0);
      expect(second).toBe(first);
      expect((await db.prepare("SELECT COUNT(*) AS count FROM analysis_runs").first<{ count: number }>())?.count).toBe(1);
      expect((await db.prepare("SELECT COUNT(*) AS count FROM analysis_insight_accounting").first<{ count: number }>())?.count).toBe(1);
      expect((await db.prepare("SELECT analysis_run_id, stage FROM analysis_limit_reservations WHERE id = 1").first<{ analysis_run_id: number; stage: string }>())?.analysis_run_id).toBe(first);
    } finally {
      db.close();
    }
  });
});
