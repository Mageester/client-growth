import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  countCatalogGenerationReservations,
  reserveCatalogGeneration,
} from "@/db/catalogGenerationLimits";
import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import { applySchema } from "@/db/repositories";
import type { TenantScope } from "@/db/tenant";
import { createWorkspaceForOwner } from "@/db/workspaces";

let db: NodeSqliteDb;
let first: TenantScope;
let second: TenantScope;

beforeEach(async () => {
  db = nodeSqliteDb(":memory:");
  await applySchema(db);
  await createWorkspaceForOwner(db, { id: "ws_one", name: "One", ownerUserId: "u1" });
  await createWorkspaceForOwner(db, { id: "ws_two", name: "Two", ownerUserId: "u2" });
  first = { db, workspaceId: "ws_one" };
  second = { db, workspaceId: "ws_two" };
});

afterEach(() => db.close());

describe("catalog generation admission", () => {
  it("atomically enforces the workspace daily cap", async () => {
    const now = new Date("2026-09-08T14:00:00.000Z");
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        reserveCatalogGeneration(first, { now, dailyLimit: 2, platformDailyLimit: 10 }),
      ),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(2);
    expect(results.find((result) => !result.allowed)).toMatchObject({
      allowed: false,
      limitation: { code: "workspace-daily-cap", retryAt: "2026-09-09T00:00:00.000Z" },
    });
    expect(await countCatalogGenerationReservations(first, { dayUtc: "2026-09-08" })).toBe(2);
  });

  it("enforces the platform cap across workspaces without exposing another tenant", async () => {
    const now = new Date("2026-09-08T14:00:00.000Z");
    expect(
      await reserveCatalogGeneration(first, { now, dailyLimit: 10, platformDailyLimit: 1 }),
    ).toMatchObject({ allowed: true });

    expect(
      await reserveCatalogGeneration(second, { now, dailyLimit: 10, platformDailyLimit: 1 }),
    ).toMatchObject({
      allowed: false,
      limitation: {
        code: "platform-daily-cap",
        reason: expect.not.stringContaining("ws_one"),
      },
    });
    expect(await countCatalogGenerationReservations(second)).toBe(0);
  });

  it("opens a fresh allowance on the next UTC day", async () => {
    const options = { dailyLimit: 1, platformDailyLimit: 1 };
    await reserveCatalogGeneration(first, {
      ...options,
      now: new Date("2026-09-08T23:59:59.999Z"),
    });

    expect(
      await reserveCatalogGeneration(first, {
        ...options,
        now: new Date("2026-09-09T00:00:00.000Z"),
      }),
    ).toMatchObject({ allowed: true, dayUtc: "2026-09-09" });
  });
});
