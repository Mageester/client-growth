import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { nodeSqliteDb } from "@/db/nodeSqlite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "migrations");
const EXPECTED_MIGRATIONS = [
  "0001_init.sql",
  "0002_add_verification.sql",
  "0003_add_conversion_defect.sql",
  "0004_better_auth.sql",
  "0005_multitenant.sql",
  "0006_remove_demo_fixture.sql",
  "0007_analysis_runs.sql",
] as const;

const DEMO_IDENTIFIERS = [
  ["workspaces", "id", "ws_demo"],
  ["workspace_members", "workspace_id", "ws_demo"],
  ["services", "workspace_id", "ws_demo"],
  ["clients", "workspace_id", "ws_demo"],
  ["client_coverage", "workspace_id", "ws_demo"],
  ["evidence_bundles", "workspace_id", "ws_demo"],
  ["opportunities", "workspace_id", "ws_demo"],
  ["analysis_runs", "workspace_id", "ws_demo"],
  ["user", "id", "user_demo"],
  ["session", "userId", "user_demo"],
  ["account", "userId", "user_demo"],
] as const;

describe("production migration baseline", () => {
  it("leaves a fresh database without the local demo user or workspace", async () => {
    const db = nodeSqliteDb(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON;");
      const migrations = readdirSync(migrationsDir)
        .filter((file) => file.endsWith(".sql"))
        .sort();
      expect(migrations).toEqual(EXPECTED_MIGRATIONS);

      for (const migration of migrations) {
        await db.exec(readFileSync(join(migrationsDir, migration), "utf8"));
      }

      const foreignKeyViolations = await db.prepare("PRAGMA foreign_key_check").all();
      expect(foreignKeyViolations).toEqual([]);

      for (const [table, column, identifier] of DEMO_IDENTIFIERS) {
        const row = await db
          .prepare(`SELECT COUNT(*) AS count FROM "${table}" WHERE "${column}" = ?`)
          .bind(identifier)
          .first<{ count: number }>();
        expect(row?.count, `${table}.${column} still contains ${identifier}`).toBe(0);
      }
    } finally {
      db.close();
    }
  });
});
