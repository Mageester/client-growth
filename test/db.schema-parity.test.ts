import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { nodeSqliteDb } from "@/db/nodeSqlite";
import { applySchema } from "@/db/repositories";

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

async function tableShapes(apply: (db: ReturnType<typeof nodeSqliteDb>) => Promise<void>) {
  const db = nodeSqliteDb(":memory:");
  await apply(db);
  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' ORDER BY name")
    .all<{ name: string }>();
  const shapes: Record<string, ColumnInfo[]> = {};
  for (const { name } of tables) {
    const cols = await db.prepare(`PRAGMA table_info(${name})`).all<ColumnInfo>();
    shapes[name] = cols
      .map((c) => ({ name: c.name, type: c.type, notnull: c.notnull, pk: c.pk }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  db.close();
  return shapes;
}

describe("schema parity", () => {
  it("running all migrations produces the same tables/columns as SCHEMA_SQL", async () => {
    const fromMigrations = await tableShapes(async (db) => {
      const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files) {
        await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
      }
    });
    const fromConst = await tableShapes((db) => applySchema(db));
    expect(fromMigrations).toEqual(fromConst);
  });
});
