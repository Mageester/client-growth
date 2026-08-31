import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { nodeSqliteDb } from "@/db/nodeSqlite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "migrations");

describe("production migration baseline", () => {
  it("leaves a fresh database without the local demo user or workspace", async () => {
    const db = nodeSqliteDb(":memory:");
    try {
      const migrations = readdirSync(migrationsDir)
        .filter((file) => file.endsWith(".sql"))
        .sort();
      for (const migration of migrations) {
        await db.exec(readFileSync(join(migrationsDir, migration), "utf8"));
      }

      const demoUser = await db
        .prepare('SELECT COUNT(*) AS count FROM "user" WHERE id = ?')
        .bind("user_demo")
        .first<{ count: number }>();
      const demoWorkspace = await db
        .prepare("SELECT COUNT(*) AS count FROM workspaces WHERE id = ?")
        .bind("ws_demo")
        .first<{ count: number }>();

      expect(demoUser?.count).toBe(0);
      expect(demoWorkspace?.count).toBe(0);
    } finally {
      db.close();
    }
  });
});
