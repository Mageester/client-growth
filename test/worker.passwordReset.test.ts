import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SCHEMA_SQL } from "@/db/schema";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const RESET_MESSAGE =
  "If this email exists in our system, check your email for the reset link";

function d1LikeOverWithMetadata(raw: Database.Database): unknown {
  const statement = (sql: string, bound: unknown[]): Record<string, unknown> => ({
    bind: (...values: unknown[]) => statement(sql, values),
    all: async () => {
      const prepared = raw.prepare(sql);
      if (!prepared.reader) {
        const result = prepared.run(...(bound as never[]));
        return {
          results: [],
          meta: {
            changes: Number(result.changes),
            last_row_id: Number(result.lastInsertRowid),
          },
        };
      }
      return {
        results: prepared.all(...(bound as never[])),
        meta: { changes: 0, last_row_id: 0 },
      };
    },
    first: async (column?: string) => {
      const row = raw.prepare(sql).get(...(bound as never[])) as
        | Record<string, unknown>
        | undefined;
      if (!row) return null;
      return column ? (row[column] ?? null) : row;
    },
    run: async () => {
      const result = raw.prepare(sql).run(...(bound as never[]));
      return {
        results: [],
        meta: {
          changes: Number(result.changes),
          last_row_id: Number(result.lastInsertRowid),
        },
      };
    },
  });

  return {
    prepare: (sql: string) => statement(sql, []),
    batch: async (statements: Array<{ all(): Promise<unknown> }>) =>
      Promise.all(statements.map((item) => item.all())),
    exec: async (sql: string) => {
      raw.exec(sql);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Worker password-reset email path", () => {
  it("uses one outbound transport for a known user and none for an unknown user", async () => {
    const raw = new Database(":memory:");
    raw.pragma("foreign_keys = ON");
    raw.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
    raw.exec(SCHEMA_SQL);

    const outbound = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 202 }),
    );
    vi.stubGlobal("fetch", outbound);

    try {
      // Simulate the Worker entry importing the context bridge once, then the
      // generated server bundle importing its own copy of that module.
      vi.resetModules();
      const workerBridge = await import("../app/lib/workerContext.server");
      vi.resetModules();
      const { getAuth } = await import("../app/lib/auth.server");

      const tasks: Promise<unknown>[] = [];
      const context = {
        waitUntil(promise: Promise<unknown>) {
          tasks.push(promise);
        },
      };
      const auth = getAuth({
        DB: d1LikeOverWithMetadata(raw),
        BETTER_AUTH_SECRET: "test-secret-".padEnd(48, "x"),
        BETTER_AUTH_URL: "http://localhost:8787",
        RESEND_API_KEY: "test-resend-key",
        RESEND_FROM_EMAIL: "Client Growth <noreply@getaxiom.ca>",
      });

      await auth.api.signUpEmail({
        body: {
          email: "known@example.com",
          password: "old-correct-password",
          name: "Known",
        },
        asResponse: true,
      });

      const known = await workerBridge.runWithWorkerExecutionContext(
        context,
        () =>
          auth.api.requestPasswordReset({
            body: {
              email: "known@example.com",
              redirectTo: "http://localhost:8787/reset-password",
            },
            asResponse: true,
          }),
      );
      const unknown = await workerBridge.runWithWorkerExecutionContext(
        context,
        () =>
          auth.api.requestPasswordReset({
            body: {
              email: "unknown@example.com",
              redirectTo: "http://localhost:8787/reset-password",
            },
            asResponse: true,
          }),
      );

      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(await known.json()).toEqual({ status: true, message: RESET_MESSAGE });
      expect(await unknown.json()).toEqual({ status: true, message: RESET_MESSAGE });
      expect(tasks).toHaveLength(1);
      expect(outbound).toHaveBeenCalledTimes(1);
      expect(outbound).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({ method: "POST" }),
      );
      await Promise.all(tasks);
    } finally {
      raw.close();
    }
  });
});
