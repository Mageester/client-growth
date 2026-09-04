import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { betterAuth } from "better-auth";

import { buildAuthOptions } from "../../app/lib/authOptions";
import type {
  PasswordResetSender,
  VerificationEmailSender,
} from "../../app/lib/resend.server";
import { SCHEMA_SQL } from "@/db/schema";
import type { RunResult, SqlDb, SqlStatement, SqlValue } from "@/db/sql";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

/** A minimal SqlDb over a better-sqlite3 Database (shared with Better Auth in tests). */
function sqlDbOver(raw: Database.Database): SqlDb {
  const stmt = (sql: string, bound: SqlValue[]): SqlStatement => ({
    bind: (...v: SqlValue[]) => stmt(sql, v),
    all: <T,>() => Promise.resolve(raw.prepare(sql).all(...(bound as never[])) as T[]),
    first: <T,>() =>
      Promise.resolve((raw.prepare(sql).get(...(bound as never[])) ?? null) as T | null),
    run: (): Promise<RunResult> => {
      const r = raw.prepare(sql).run(...(bound as never[]));
      return Promise.resolve({ rowsAffected: Number(r.changes ?? 0) });
    },
  });
  return {
    exec: (sql: string) => {
      raw.exec(sql);
      return Promise.resolve();
    },
    prepare: (sql: string) => stmt(sql, []),
  };
}

/**
 * A Better Auth instance + a SqlDb view of the SAME in-memory database, with the
 * committed auth migration (0004) and the app schema applied — so app repos and
 * Better Auth share storage in tests.
 */
export interface TestAuthOptions {
  sendResetPassword?: PasswordResetSender;
  sendVerificationEmail?: VerificationEmailSender;
  backgroundTaskHandler?: (promise: Promise<unknown>) => void;
  resetPasswordTokenExpiresIn?: number;
}

export function makeTestAuth(options: TestAuthOptions = {}): {
  auth: ReturnType<typeof betterAuth>;
  db: SqlDb;
  raw: Database.Database;
} {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  raw.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  raw.exec(SCHEMA_SQL);

  const authOptions = buildAuthOptions({
    database: raw as never,
    secret: "test-secret-".padEnd(48, "x"),
    baseURL: "http://localhost:8787",
    sendResetPassword: options.sendResetPassword,
    sendVerificationEmail: options.sendVerificationEmail,
    backgroundTaskHandler: options.backgroundTaskHandler,
  });
  if (options.resetPasswordTokenExpiresIn !== undefined) {
    authOptions.emailAndPassword!.resetPasswordTokenExpiresIn = options.resetPasswordTokenExpiresIn;
  }

  const auth = betterAuth(authOptions);

  return { auth, db: sqlDbOver(raw), raw };
}

export async function signUp(
  auth: ReturnType<typeof betterAuth>,
  email: string,
  password: string,
  name = "Test",
): Promise<{ cookie: string; status: number }> {
  const res = await auth.api.signUpEmail({ body: { email, password, name }, asResponse: true });
  return { cookie: res.headers.get("set-cookie") ?? "", status: res.status };
}

/**
 * Explicitly provisions a verified fixture user for tests that exercise an
 * authenticated or password based flow. Production signup remains subject to
 * Better Auth's verification gate; this is only deterministic fixture setup.
 */
export async function signUpVerified(
  auth: ReturnType<typeof betterAuth>,
  raw: Database.Database,
  email: string,
  password: string,
  name = "Test",
): Promise<{ cookie: string; status: number }> {
  const signup = await signUp(auth, email, password, name);
  const updated = raw
    .prepare('UPDATE "user" SET "emailVerified" = 1 WHERE email = ?')
    .run(email);
  if (Number(updated.changes ?? 0) !== 1) {
    throw new Error(`Verified fixture user was not created for ${email}`);
  }
  const signIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  return { cookie: signIn.headers.get("set-cookie") ?? "", status: signup.status };
}

export function headers(cookie: string): Headers {
  return new Headers({ cookie });
}

/** A Cloudflare-D1-shaped adapter over better-sqlite3, for exercising real routes. */
export function d1LikeOver(raw: Database.Database): unknown {
  const mk = (sql: string, bound: unknown[]): unknown => ({
    bind: (...v: unknown[]) => mk(sql, v),
    all: async () => ({ results: raw.prepare(sql).all(...(bound as never[])) }),
    first: async (col?: string) => {
      const r = raw.prepare(sql).get(...(bound as never[])) as Record<string, unknown> | undefined;
      if (!r) return null;
      return col ? (r[col] ?? null) : r;
    },
    run: async () => ({ meta: { changes: raw.prepare(sql).run(...(bound as never[])).changes } }),
  });
  return {
    prepare: (sql: string) => mk(sql, []),
    exec: async (sql: string) => {
      raw.exec(sql);
    },
  };
}
