import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as repo from "@/db/repositories";
import { nodeSqliteDb } from "@/db/nodeSqlite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "migrations");

async function applyThrough(db: ReturnType<typeof nodeSqliteDb>, last: string): Promise<void> {
  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql") && file <= last)
    .sort();
  for (const migration of migrations) {
    await db.exec(readFileSync(join(migrationsDir, migration), "utf8"));
  }
}

describe("technical aggregation migration", () => {
  it("folds legacy page rows into canonical site rows without reviving dismissed work", async () => {
    const db = nodeSqliteDb(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON;");
      await applyThrough(db, "0012_analysis_completion.sql");

      await db.exec(`
        INSERT INTO workspaces (id, name, owner_user_id, created_at)
          VALUES ('ws_live', 'Live Agency', 'u_live', '2026-09-01T00:00:00.000Z');
        INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
          VALUES ('ws_live', 'u_live', 'owner', '2026-09-01T00:00:00.000Z');
        INSERT INTO clients (id, workspace_id, name, domain, offerings, notes, updated_at)
          VALUES ('client_live', 'ws_live', 'Live Client', 'live.example', '[]', '', '2026-09-01T00:00:00.000Z');
        INSERT INTO services (id, workspace_id, name, description, price_min, price_max, tags, active, updated_at) VALUES
          ('svc_title_default', 'ws_live', 'Title repair', '', 150, 400, '["missing-title"]', 1, '2026-09-01T00:00:00.000Z'),
          ('svc_title_custom', 'ws_live', 'Custom title repair', '', 175, 444, '["missing-title"]', 1, '2026-09-01T00:00:00.000Z'),
          ('svc_duplicate_default', 'ws_live', 'Duplicate title repair', '', 200, 500, '["duplicate-title"]', 1, '2026-09-01T00:00:00.000Z'),
          ('svc_thin_default', 'ws_live', 'Thin page repair', '', 900, 1800, '["thin-service-page"]', 1, '2026-09-01T00:00:00.000Z'),
          ('svc_h1_default', 'ws_live', 'H1 repair', '', 150, 400, '["missing-h1"]', 1, '2026-09-01T00:00:00.000Z'),
          ('svc_broken_default', 'ws_live', 'Broken link repair', '', 200, 600, '["broken-internal-link"]', 1, '2026-09-01T00:00:00.000Z'),
          ('svc_meta_default', 'ws_live', 'Meta repair', '', 200, 500, '["missing-meta-description"]', 1, '2026-09-01T00:00:00.000Z'),
          ('svc_structured_default', 'ws_live', 'Structured data repair', '', 300, 800, '["missing-structured-data"]', 1, '2026-09-01T00:00:00.000Z'),
          ('svc_alt_default', 'ws_live', 'Image alt repair', '', 900, 2200, '["missing-image-alt"]', 1, '2026-09-01T00:00:00.000Z'),
          ('svc_alt_custom', 'ws_live', 'Custom image alt repair', '', 900, 2201, '["missing-image-alt"]', 1, '2026-09-01T00:00:00.000Z');
        INSERT INTO client_coverage (workspace_id, client_id, service_id, note)
          VALUES ('ws_live', 'client_live', 'svc_title_default', 'under contract');

        INSERT INTO opportunities (
          id, workspace_id, dedupe_key, client_id, rule_id, title, detected, evidence_refs, rationale,
          suggested_service_id, suggested_scope, price_min, price_max, confidence, billable_status,
          status, snooze_until, proposal_md, verification, conversion_defect, updated_at
        ) VALUES
          ('title-dismissed', 'ws_live', 'old-title-root', 'client_live', 'missing-title', 'Missing page title', 'root missing', '["page:https://live.example/","title:missing"]', 'why', 'svc_title_default', '[]', 150, 400, .9, 'billable', 'dismissed', NULL, '# page-only draft', NULL, NULL, '2026-09-01T00:00:00.000Z'),
          ('title-open', 'ws_live', 'old-title-about', 'client_live', 'missing-title', 'Missing page title', 'about missing', '["page:https://live.example/about","title:missing"]', 'why', 'svc_title_default', '[]', 150, 400, .9, 'billable', 'new', NULL, NULL, NULL, NULL, '2026-09-01T00:00:00.000Z'),
          ('h1-dismissed', 'ws_live', 'old-h1-root', 'client_live', 'missing-h1', 'Missing H1', 'root missing', '["page:https://live.example/","h1:missing"]', 'why', 'svc_h1_default', '[]', 150, 400, .9, 'billable', 'dismissed', NULL, NULL, NULL, NULL, '2026-09-01T00:00:00.000Z'),
          ('meta-dismissed', 'ws_live', 'old-meta-root', 'client_live', 'missing-meta-description', 'Missing meta', 'root missing', '["page:https://live.example/","meta-description:missing"]', 'why', 'svc_meta_default', '[]', 200, 500, .9, 'billable', 'dismissed', NULL, NULL, NULL, NULL, '2026-09-01T00:00:00.000Z'),
          ('meta-open', 'ws_live', 'old-meta-about', 'client_live', 'missing-meta-description', 'Missing meta', 'about missing', '["page:https://live.example/about","meta-description:missing"]', 'why', 'svc_meta_default', '[]', 200, 500, .9, 'billable', 'new', NULL, NULL, NULL, NULL, '2026-09-01T00:00:00.000Z'),
          ('alt-open', 'ws_live', 'old-alt-root', 'client_live', 'missing-image-alt', 'Missing image alt attribute', 'image missing', '["page:https://live.example/","images-without-alt:10"]', 'why', 'svc_alt_default', '[]', 900, 2200, .9, 'billable', 'new', NULL, NULL, NULL, NULL, '2026-09-01T00:00:00.000Z');
      `);

      await db.exec(readFileSync(join(migrationsDir, "0013_technical_aggregation.sql"), "utf8"));

      expect(
        await db.prepare("SELECT price_min, price_max FROM services WHERE id = 'svc_title_default'").first(),
      ).toMatchObject({ price_min: 150, price_max: 300 });
      expect(
        await db.prepare("SELECT price_min, price_max FROM services WHERE id = 'svc_title_custom'").first(),
      ).toMatchObject({ price_min: 175, price_max: 444 });
      expect(
        await db.prepare("SELECT price_min, price_max FROM services WHERE id = 'svc_duplicate_default'").first(),
      ).toMatchObject({ price_min: 200, price_max: 400 });
      expect(
        await db.prepare("SELECT price_min, price_max FROM services WHERE id = 'svc_thin_default'").first(),
      ).toMatchObject({ price_min: 400, price_max: 800 });
      expect(
        await db.prepare("SELECT price_min, price_max FROM services WHERE id = 'svc_h1_default'").first(),
      ).toMatchObject({ price_min: 150, price_max: 300 });
      expect(
        await db.prepare("SELECT price_min, price_max FROM services WHERE id = 'svc_broken_default'").first(),
      ).toMatchObject({ price_min: 200, price_max: 500 });
      expect(
        await db.prepare("SELECT price_min, price_max FROM services WHERE id = 'svc_meta_default'").first(),
      ).toMatchObject({ price_min: 200, price_max: 500 });
      expect(
        await db.prepare("SELECT price_min, price_max FROM services WHERE id = 'svc_structured_default'").first(),
      ).toMatchObject({ price_min: 300, price_max: 700 });
      expect(
        await db.prepare("SELECT price_min, price_max FROM services WHERE id = 'svc_alt_default'").first(),
      ).toMatchObject({ price_min: 150, price_max: 400 });
      expect(
        await db.prepare("SELECT price_min, price_max FROM services WHERE id = 'svc_alt_custom'").first(),
      ).toMatchObject({ price_min: 900, price_max: 2201 });

      const title = await db
        .prepare("SELECT * FROM opportunities WHERE dedupe_key = 'technical::client_live::missing-title'")
        .first<Record<string, string>>();
      expect(title).toMatchObject({
        id: "technical::client_live::missing-title",
        status: "already_covered",
        billable_status: "already_covered",
        proposal_md: null,
      });
      const titleRow = title!;
      expect(JSON.parse(titleRow.suppressed_evidence_refs!)).toEqual(["page:https://live.example/"]);
      expect(JSON.parse(titleRow.evidence_refs!)).toEqual(
        expect.arrayContaining(["page:https://live.example/", "page:https://live.example/about"]),
      );

      const h1 = await db
        .prepare("SELECT status FROM opportunities WHERE dedupe_key = 'technical::client_live::missing-h1'")
        .first<{ status: string }>();
      expect(h1?.status).toBe("dismissed");

      const meta = await db
        .prepare("SELECT status, suppressed_evidence_refs FROM opportunities WHERE dedupe_key = 'technical::client_live::missing-meta-description'")
        .first<{ status: string; suppressed_evidence_refs: string }>();
      expect(meta?.status).toBe("new");
      expect(JSON.parse(meta!.suppressed_evidence_refs)).toEqual(["page:https://live.example/"]);

      const imageAlt = await db
        .prepare("SELECT price_min, price_max FROM opportunities WHERE dedupe_key = 'technical::client_live::missing-image-alt'")
        .first<{ price_min: number; price_max: number }>();
      expect(imageAlt).toMatchObject({ price_min: 150, price_max: 400 });

      const legacy = await db
        .prepare("SELECT id, status, proposal_md FROM opportunities WHERE id IN ('title-dismissed', 'title-open', 'h1-dismissed', 'meta-dismissed', 'meta-open', 'alt-open') ORDER BY id")
        .all<{ id: string; status: string; proposal_md: string | null }>();
      expect(legacy.every((row) => row.status === "superseded")).toBe(true);
      expect(legacy.find((row) => row.id === "title-dismissed")?.proposal_md).toBe("# page-only draft");

      const scope = { db, workspaceId: "ws_live" };
      const visible = await repo.listOpportunities(scope, "client_live");
      expect(visible.map((opportunity) => opportunity.dedupeKey).sort()).toEqual([
        "technical::client_live::missing-h1",
        "technical::client_live::missing-image-alt",
        "technical::client_live::missing-meta-description",
        "technical::client_live::missing-title",
      ]);
      expect(await repo.getOpportunity(scope, "title-dismissed")).toBeNull();
      expect(await repo.setOpportunityStatus(scope, "title-dismissed", "new")).toBe(false);
      await repo.setOpportunityStatus(
        scope,
        "technical::client_live::missing-meta-description",
        "dismissed",
      );
      expect(
        await repo.setOpportunityStatus(
          scope,
          "technical::client_live::missing-meta-description",
          "new",
        ),
      ).toBe(true);
      const reopened = await db
        .prepare("SELECT suppressed_evidence_refs FROM opportunities WHERE id = 'technical::client_live::missing-meta-description'")
        .first<{ suppressed_evidence_refs: string }>();
      expect(JSON.parse(reopened!.suppressed_evidence_refs)).toEqual([]);
      expect(await db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
