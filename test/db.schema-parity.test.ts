import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { nodeSqliteDb } from "@/db/nodeSqlite";
import { applySchema } from "@/db/repositories";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// SCHEMA_SQL is the complete all-feature fixture used by repository tests. The
// external business-profile table belongs to the paused mismatch feature and
// is intentionally not part of the active production migration chain.
const PAUSED_TABLES = new Set(["external_business_claims"]);

/** Better Auth owns these — generated from the pinned version (0004), covered by auth.schema.test.ts. */
const AUTH_TABLES = new Set(["user", "session", "account", "verification", "rateLimit"]);

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}
interface FkInfo {
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
}

async function introspect(apply: (db: ReturnType<typeof nodeSqliteDb>) => Promise<void>) {
  const db = nodeSqliteDb(":memory:");
  await apply(db);
  const tables = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' ORDER BY name",
      )
      .all<{ name: string }>()
  )
    .map((t) => t.name)
    .filter((name) => !PAUSED_TABLES.has(name))
    .filter((n) => !AUTH_TABLES.has(n));

  const columns: Record<string, ColumnInfo[]> = {};
  const fks: Record<string, FkInfo[]> = {};
  for (const name of tables) {
    const cols = await db.prepare(`PRAGMA table_info(${name})`).all<ColumnInfo>();
    columns[name] = cols
      .map((c) => ({ name: c.name, type: c.type.toUpperCase(), notnull: c.notnull, pk: c.pk }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const fkRows = await db
      .prepare(`PRAGMA foreign_key_list(${name})`)
      .all<{ from: string; table: string; to: string; on_update: string; on_delete: string }>();
    fks[name] = fkRows
      .map((f) => ({
        table: f.table,
        from: f.from,
        to: f.to,
        on_update: f.on_update,
        on_delete: f.on_delete,
      }))
      .sort((a, b) => `${a.table}.${a.from}`.localeCompare(`${b.table}.${b.from}`));
  }
  db.close();
  return { columns, fks };
}

describe("schema parity", () => {
  it("running all migrations produces the same columns AND foreign keys as SCHEMA_SQL", async () => {
    const fromMigrations = await introspect(async (db) => {
      const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files) {
        await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
      }
    });
    const fromConst = await introspect((db) => applySchema(db));
    expect(fromMigrations.columns).toEqual(fromConst.columns);
    expect(fromMigrations.fks).toEqual(fromConst.fks);
  });
});
