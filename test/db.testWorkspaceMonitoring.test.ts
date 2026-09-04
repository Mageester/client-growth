import { describe, expect, it } from "vitest";
import { buildPortfolio } from "./helpers/portfolio";
import { claimClient, listDueClients } from "@/db/monitoring";

describe("reserved test workspace namespace", () => {
  it("excludes test clients from selection and rechecks the namespace at claim time", async () => {
    const now = new Date("2026-09-04T12:00:00Z");
    const p = await buildPortfolio({ workspaces: 2, perWorkspace: 6, now });
    try {
      const before = await listDueClients(p.db, { now, limit: 100 });
      const target = before.find((c) => c.workspaceId === "ws_a")!;
      expect(target).toBeDefined();
      await p.db.prepare("UPDATE workspaces SET name = ? WHERE id = ?")
        .bind("[TEST] Production Smoke A", "ws_a").run();
      const after = await listDueClients(p.db, { now, limit: 100 });
      expect(after.some((c) => c.workspaceId === "ws_a")).toBe(false);
      // A real workspace stays eligible: filtering everything must fail this test.
      expect(after.some((c) => c.workspaceId === "ws_b")).toBe(true);
      expect(await claimClient(p.db, target, now)).toBe(false);
    } finally { p.close(); }
  });
});
