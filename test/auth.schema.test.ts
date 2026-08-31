import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { generateAuthMigrationSql } from "../scripts/auth/generate-schema";
import { makeTestAuth, signUp, headers } from "./helpers/testAuth";

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
  "0004_better_auth.sql",
);

/** strip the generated header comment block for comparison */
const body = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();

describe("better-auth schema", () => {
  it("committed migration 0004 matches what the pinned better-auth version expects", async () => {
    const committed = readFileSync(migrationPath, "utf8");
    const fresh = await generateAuthMigrationSql();
    expect(body(committed)).toBe(body(fresh));
  });

  it("Better Auth initializes and runs against the migrated schema (drift fails loudly)", async () => {
    const { auth, raw } = makeTestAuth();

    const { status, cookie } = await signUp(auth, "a@x.example", "correct-horse-battery");
    expect(status).toBe(200);
    expect(cookie).toContain("better-auth");

    const session = await auth.api.getSession({ headers: headers(cookie) });
    expect(session?.user?.email).toBe("a@x.example");

    // wrong password rejected
    await expect(
      auth.api.signInEmail({ body: { email: "a@x.example", password: "nope" } }),
    ).rejects.toBeDefined();

    // password stored hashed, not plaintext
    const acct = raw.prepare("SELECT password FROM account LIMIT 1").get() as { password: string };
    expect(acct.password).toBeTruthy();
    expect(acct.password).not.toContain("correct-horse-battery");
  });
});
