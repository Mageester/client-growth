import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reserveAnalysisStart, type AnalysisLimit } from "@/db/analysisLimits";
import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { ClientSchema } from "@/core/schema";
import type { TenantScope } from "@/db/tenant";
import { runAnalysis } from "../app/lib/analysis.server";

const NOW = new Date("2026-09-04T12:00:00.000Z");
const FIVE_MINUTES = 5 * 60 * 1000;

let db: NodeSqliteDb;
let A: TenantScope;
let B: TenantScope;

async function addClient(t: TenantScope, id: string): Promise<void> {
  await repo.upsertClient(
    t,
    ClientSchema.parse({
      id,
      name: id,
      domain: `${id}.example`,
      offerings: ["service"],
      notes: "",
    }),
  );
}

beforeEach(async () => {
  db = nodeSqliteDb(":memory:");
  await repo.applySchema(db);
  await createWorkspaceForOwner(db, { id: "ws_a", name: "A", ownerUserId: "u_a" });
  await createWorkspaceForOwner(db, { id: "ws_b", name: "B", ownerUserId: "u_b" });
  A = { db, workspaceId: "ws_a" };
  B = { db, workspaceId: "ws_b" };
  await addClient(A, "client_a");
  await addClient(B, "client_b");
});

afterEach(() => db.close());

describe("analysis admission limits", () => {
  it("allows exactly at the five minute cooldown boundary", async () => {
    const first = await reserveAnalysisStart(A, "client_a", { now: NOW });
    expect(first.allowed).toBe(true);

    const justBefore = await reserveAnalysisStart(A, "client_a", {
      now: new Date(NOW.getTime() + FIVE_MINUTES - 1),
    });
    expect(justBefore.allowed).toBe(false);
    if (justBefore.allowed) return;
    expect(justBefore.limitation.code).toBe("client-cooldown");
    expect(justBefore.limitation.retryAt).toBe(
      new Date(NOW.getTime() + FIVE_MINUTES).toISOString(),
    );

    const atBoundary = await reserveAnalysisStart(A, "client_a", {
      now: new Date(NOW.getTime() + FIVE_MINUTES),
    });
    expect(atBoundary.allowed).toBe(true);
  });

  it("allows exactly the fiftieth UTC daily reservation and retries at midnight", async () => {
    for (let i = 0; i < 49; i++) {
      const result = await reserveAnalysisStart(A, "client_a", {
        now: new Date(NOW.getTime() + (i + 1) * FIVE_MINUTES),
        cooldownMs: 0,
        dailyLimit: 50,
      });
      expect(result.allowed).toBe(true);
    }

    const fiftieth = await reserveAnalysisStart(A, "client_a", {
      now: new Date("2026-09-04T23:59:59.999Z"),
      cooldownMs: 0,
      dailyLimit: 50,
    });
    expect(fiftieth.allowed).toBe(true);

    const denied = await reserveAnalysisStart(A, "client_a", {
      now: new Date("2026-09-04T23:59:59.999Z"),
      cooldownMs: 0,
      dailyLimit: 50,
    });
    expect(denied.allowed).toBe(false);
    if (denied.allowed) return;
    expect(denied.limitation.code).toBe("workspace-daily-cap");
    expect(denied.limitation.retryAt).toBe("2026-09-05T00:00:00.000Z");

    const nextDay = await reserveAnalysisStart(A, "client_a", {
      now: new Date("2026-09-05T00:00:00.000Z"),
      cooldownMs: 0,
      dailyLimit: 50,
    });
    expect(nextDay.allowed).toBe(true);
  });

  it("admits only one of parallel starts for one client", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        reserveAnalysisStart(A, "client_a", { now: NOW, cooldownMs: FIVE_MINUTES }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(results.filter((result) => !result.allowed)).toHaveLength(11);
  });

  it("isolates reservations and caps per workspace", async () => {
    const firstA = await reserveAnalysisStart(A, "client_a", {
      now: NOW,
      cooldownMs: 0,
      dailyLimit: 1,
    });
    expect(firstA.allowed).toBe(true);

    // A's daily cap and client cooldown cannot deny B.
    const firstB = await reserveAnalysisStart(B, "client_b", {
      now: NOW,
      cooldownMs: FIVE_MINUTES,
      dailyLimit: 1,
    });
    expect(firstB.allowed).toBe(true);

    const secondA = await reserveAnalysisStart(A, "client_a", {
      now: NOW,
      cooldownMs: 0,
      dailyLimit: 1,
    });
    expect(secondA.allowed).toBe(false);
    if (secondA.allowed) return;
    expect(secondA.limitation.code).toBe("workspace-daily-cap");
  });

  it("keeps a reservation after the client is deleted", async () => {
    const result = await reserveAnalysisStart(A, "client_a", {
      now: NOW,
      cooldownMs: 0,
      dailyLimit: 1,
    });
    expect(result.allowed).toBe(true);

    await db
      .prepare("DELETE FROM clients WHERE id = ? AND workspace_id = ?")
      .bind("client_a", "ws_a")
      .run();

    const row = await db
      .prepare("SELECT COUNT(*) AS count FROM analysis_limit_reservations WHERE workspace_id = ?")
      .bind("ws_a")
      .first<{ count: number }>();
    expect(row?.count).toBe(1);
  });

  it("counts a run that fails before crawling toward the daily cap", async () => {
    await expect(
      runAnalysis(A, { AI_PROVIDER: "not-a-provider" }, "client_a", {
        now: NOW,
        cooldownMs: 0,
        dailyLimit: 2,
      }),
    ).rejects.toThrow();
    await expect(
      runAnalysis(A, { AI_PROVIDER: "not-a-provider" }, "client_a", {
        now: NOW,
        cooldownMs: 0,
        dailyLimit: 2,
      }),
    ).rejects.toThrow();

    const third = await reserveAnalysisStart(A, "client_a", {
      now: NOW,
      cooldownMs: 0,
      dailyLimit: 2,
    });
    expect(third.allowed).toBe(false);
    if (third.allowed) return;
    expect(third.limitation.code).toBe("workspace-daily-cap");
  });

  it("returns a typed limitation with a human readable reason and retry time", async () => {
    await reserveAnalysisStart(A, "client_a", { now: NOW });
    const denied = await reserveAnalysisStart(A, "client_a", { now: NOW });
    expect(denied.allowed).toBe(false);
    if (denied.allowed) return;
    const limitation: AnalysisLimit = denied.limitation;
    expect(limitation.reason).toMatch(/wait|cooldown|again/i);
    expect(Date.parse(limitation.retryAt)).not.toBeNaN();
    expect(limitation.retryAfterMs).toBe(FIVE_MINUTES);
  });
});
