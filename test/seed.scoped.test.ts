import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const seedPath = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "seed.sql");

describe("local seed", () => {
  const sql = readFileSync(seedPath, "utf8");

  it("only ever writes into the demo workspace", () => {
    // every tenant INSERT names ws_demo
    const tenantInserts = sql
      .split("\n")
      .filter((l) => /^INSERT INTO (services|clients|client_coverage|evidence_bundles|opportunities)/.test(l));
    expect(tenantInserts.length).toBeGreaterThan(0);
    for (const line of tenantInserts) {
      expect(line).toMatch(/'ws_demo'/);
    }
    // every DELETE is scoped
    for (const line of sql.split("\n").filter((l) => l.startsWith("DELETE FROM"))) {
      expect(line).toMatch(/workspace_id = 'ws_demo'/);
    }
  });

  it("creates the demo user + workspace it depends on", () => {
    expect(sql).toMatch(/INSERT OR IGNORE INTO user .*user_demo/s);
    expect(sql).toMatch(/INSERT OR IGNORE INTO workspaces .*ws_demo/s);
    expect(sql).toMatch(/INSERT OR IGNORE INTO workspace_members .*ws_demo/s);
  });
});
