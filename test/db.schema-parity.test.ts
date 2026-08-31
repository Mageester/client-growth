import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SCHEMA_SQL } from "@/db/schema";

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
  "0001_init.sql",
);

/** Normalise: drop comments and blank lines, collapse whitespace, split on `;`. */
function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

describe("schema parity", () => {
  it("migrations/0001_init.sql matches SCHEMA_SQL statement-for-statement", () => {
    const fromFile = statements(readFileSync(migrationPath, "utf8"));
    const fromConst = statements(SCHEMA_SQL);
    expect(fromFile).toEqual(fromConst);
  });
});
