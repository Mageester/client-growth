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
  "0008_monitoring.sql",
  "0009_analysis_limits.sql",
  "0010_team_invitations.sql",
  "0011_proposal_shares.sql",
  "0012_analysis_completion.sql",
  "0013_technical_aggregation.sql",
  "0014_technical_aggregate_titles.sql",
  "0015_canonical_technical_aggregate_titles.sql",
  "0016_platform_analysis_ceiling.sql",
  "0017_invitation_email_lookup.sql",
  "0018_opportunity_outcomes.sql",
  "0019_client_job_value.sql",
  "0020_competitors.sql",
  "0021_offering_drift.sql",
  "0022_sales_funnel.sql",
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
  ["analysis_limit_reservations", "workspace_id", "ws_demo"],
  ["workspace_invitations", "workspace_id", "ws_demo"],
  ["workspace_branding", "workspace_id", "ws_demo"],
  ["proposal_shares", "workspace_id", "ws_demo"],
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

  /**
   * The migration that matters is not the one that runs on an empty database —
   * it is the one that runs on the schema production is on right now, with rows
   * in it. This walks 0001..0007, populates it the way production is populated,
   * then applies 0008 through 0021 alone.
   */
  it("upgrades the live production schema in place without touching existing rows", async () => {
    const db = nodeSqliteDb(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON;");
      for (const migration of EXPECTED_MIGRATIONS.filter((m) => m < "0008")) {
        await db.exec(readFileSync(join(migrationsDir, migration), "utf8"));
      }

      await db.exec(`
        INSERT INTO user (id, name, email, "emailVerified", "createdAt", "updatedAt")
          VALUES ('u_live', 'Live', 'live@example.test', 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
        INSERT INTO workspaces (id, name, owner_user_id, created_at)
          VALUES ('ws_live', 'Live Agency', 'u_live', '2026-08-01T00:00:00.000Z');
        INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
          VALUES ('ws_live', 'u_live', 'owner', '2026-08-01T00:00:00.000Z');
        INSERT INTO services (id, workspace_id, name, description, price_min, price_max, tags, active, updated_at)
          VALUES ('svc_live', 'ws_live', 'Landing page', '', 900, 1800, '["landing-page"]', 1, '2026-08-01T00:00:00.000Z');
        INSERT INTO clients (id, workspace_id, name, domain, offerings, notes, updated_at)
          VALUES ('client_live', 'ws_live', 'Live Client', 'live.example', '["ducts"]', '', '2026-08-01T00:00:00.000Z');
        INSERT INTO analysis_runs (
          workspace_id, client_id, started_at, finished_at, source, outcome, summary,
          limitation, pages_read, pages_fetched, blocked_events, inconclusive_events, surfaced, stats
        ) VALUES (
          'ws_live', 'client_live', '2026-08-01T00:00:00.000Z', '2026-08-01T00:01:00.000Z',
          'http', 'clean', 'Read 4 pages and found no unmet billable work.', NULL, 4, 5, 0, 0, 0, '{}'
        );
      `);

      await db.exec(readFileSync(join(migrationsDir, "0008_monitoring.sql"), "utf8"));
      await db.exec(readFileSync(join(migrationsDir, "0009_analysis_limits.sql"), "utf8"));
      await db.exec(readFileSync(join(migrationsDir, "0010_team_invitations.sql"), "utf8"));
      await db.exec(readFileSync(join(migrationsDir, "0011_proposal_shares.sql"), "utf8"));
      await db.exec(readFileSync(join(migrationsDir, "0012_analysis_completion.sql"), "utf8"));
      await db.exec(readFileSync(join(migrationsDir, "0013_technical_aggregation.sql"), "utf8"));
      await db.exec(readFileSync(join(migrationsDir, "0014_technical_aggregate_titles.sql"), "utf8"));
      await db.exec(readFileSync(join(migrationsDir, "0015_canonical_technical_aggregate_titles.sql"), "utf8"));
      await db.exec(readFileSync(join(migrationsDir, "0016_platform_analysis_ceiling.sql"), "utf8"));
      await db.exec(readFileSync(join(migrationsDir, "0017_invitation_email_lookup.sql"), "utf8"));
      await db.exec(readFileSync(join(migrationsDir, "0018_opportunity_outcomes.sql"), "utf8"));
      await db.exec(readFileSync(join(migrationsDir, "0019_client_job_value.sql"), "utf8"));
      await db.exec(readFileSync(join(migrationsDir, "0020_competitors.sql"), "utf8"));
      await db.exec(readFileSync(join(migrationsDir, "0021_offering_drift.sql"), "utf8"));

      expect(await db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

      // The whole point of the canary rollout: deploying monitoring does not
      // enable it for a single existing client.
      const client = await db
        .prepare("SELECT * FROM clients WHERE id = 'client_live'")
        .first<Record<string, unknown>>();
      expect(client?.name).toBe("Live Client");
      expect(client?.offerings).toBe('["ducts"]');
      expect(client?.monitoring_cadence).toBe("off");
      expect(client?.monitoring_next_due_at).toBeNull();
      expect(client?.monitoring_consecutive_failures).toBe(0);
      expect(client?.monitoring_claimed_at).toBeNull();

      // A pre-existing run keeps its meaning and reads as manual, because it was.
      const run = await db
        .prepare("SELECT * FROM analysis_runs WHERE client_id = 'client_live'")
        .first<Record<string, unknown>>();
      expect(run?.outcome).toBe("clean");
      expect(run?.pages_read).toBe(4);
      expect(run?.trigger).toBe("manual");
      expect(run?.new_count).toBe(0);
      expect(run?.resolved_count).toBe(0);
      expect(run?.evaluator_errors).toBe(0);
    } finally {
      db.close();
    }
  });
});
