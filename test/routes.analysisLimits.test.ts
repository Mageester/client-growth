import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { renderToStaticMarkup } from "react-dom/server";

import { ClientSchema } from "@/core/schema";
import { reserveAnalysisStart } from "@/db/analysisLimits";
import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { SCHEMA_SQL } from "@/db/schema";
import type { TenantScope } from "@/db/tenant";
import { __setSessionResolver } from "../app/lib/session.server";
import { d1Db } from "../app/lib/d1.server";
import { d1LikeOver } from "./helpers/testAuth";
import * as onboarding from "../app/routes/onboarding";
import OpportunitiesIndex from "../app/routes/opportunities._index";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let raw: Database.Database;
let scope: TenantScope;
let ctx: { cloudflare: { env: Record<string, unknown> } };

function formReq(fields: Record<string, string | string[]>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
  }
  return new Request("http://localhost/onboarding", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

async function call(fn: (args: unknown) => unknown, args: unknown): Promise<unknown> {
  try {
    return await fn(args);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

beforeEach(async () => {
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  raw.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  raw.exec(SCHEMA_SQL);
  const db = d1Db(d1LikeOver(raw) as never);
  await createWorkspaceForOwner(db, { id: "ws_a", name: "A", ownerUserId: "u_a" });
  await repo.upsertClient(
    { db, workspaceId: "ws_a" },
    ClientSchema.parse({
      id: "client_a",
      name: "Client A",
      domain: "client-a.example",
      offerings: ["one", "two"],
      notes: "",
    }),
  );
  scope = { db, workspaceId: "ws_a" };
  __setSessionResolver(async () => ({
    userId: "u_a",
    user: { id: "u_a", email: "a@example.test", name: "A" },
  }));
  ctx = {
    cloudflare: {
      env: {
        DB: d1LikeOver(raw),
        AI_PROVIDER: "mock",
        MAX_AI_CALLS_PER_RUN: "10",
      },
    },
  };
});

afterEach(() => {
  __setSessionResolver(null);
  raw.close();
});

describe("analysis limit route handling", () => {
  it("returns a normal limit result from the opportunities action", async () => {
    await reserveAnalysisStart(scope, "client_a", { now: new Date() });

    const result = (await call(
      (await import("../app/routes/opportunities._index")).action as never,
      {
        request: formReq({ clientId: "client_a" }),
        context: ctx,
      },
    )) as { ok: boolean; error?: string; limitation?: { code: string; retryAt: string } };

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/analyzed recently|daily analysis limit/i);
    expect(result.limitation?.code).toBe("client-cooldown");
    expect(Date.parse(result.limitation!.retryAt)).not.toBeNaN();
  });

  it("returns a normal limit result from onboarding confirmation", async () => {
    await reserveAnalysisStart(scope, "client_a", { now: new Date() });

    const result = (await call(onboarding.action as never, {
      request: formReq({
        intent: "analyze",
        clientId: "client_a",
        offering: ["one", "two"],
      }),
      context: ctx,
    })) as { error?: string; limitation?: { code: string; retryAt: string } };

    expect(result.error).toMatch(/analyzed recently|daily analysis limit/i);
    expect(result.limitation?.code).toBe("client-cooldown");
    expect(Date.parse(result.limitation!.retryAt)).not.toBeNaN();
  });

  it("renders a limit as a status notice rather than an error alert", () => {
    const limitation = {
      code: "client-cooldown" as const,
      reason: "This client was analyzed recently. Try again after 2026-09-04T12:05:00.000Z.",
      retryAt: "2026-09-04T12:05:00.000Z",
      retryAfterMs: 300_000,
    };
    const loaderData = {
      groups: [
        {
          client: { id: "client_a", name: "Client A", domain: "client-a.example", offerings: [], notes: "" },
          opportunities: [],
          totals: { open: 0, priceMin: 0, priceMax: 0 },
          run: null,
          monitoring: { cadence: "off", nextDueAt: null, lastAttemptAt: null, lastSuccessAt: null, lastOutcome: null, consecutiveFailures: 0, claimedAt: null },
          state: "never",
        },
      ],
      serviceName: {},
      monitoring: { monitored: 0, due: 0, unhealthy: 0, newFindings: 0, resolvedFindings: 0, checks: 0 },
    };
    const html = renderToStaticMarkup(
      createElement(
        RouterProvider,
        {
          router: createMemoryRouter(
            [
              {
                path: "/opportunities",
                element: createElement(OpportunitiesIndex, {
                  loaderData,
                  actionData: {
                    ok: false,
                    clientId: "client_a",
                    error: limitation.reason,
                    limitation,
                  },
                } as never),
              },
            ],
            { initialEntries: ["/opportunities"] },
          ),
        } as never,
      ),
    );

    expect(html).toContain('class="notice"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Try again after");
    expect(html).not.toContain('class="notice err"');
  });

  it("renders persisted onboarding offerings as checked after a limit rejection", async () => {
    const limitation = {
      code: "client-cooldown" as const,
      reason: "This client was analyzed recently. Try again after 2026-09-04T12:05:00.000Z.",
      retryAt: "2026-09-04T12:05:00.000Z",
      retryAfterMs: 300_000,
    };
    const loaderData = await onboarding.loader({
      request: new Request("http://localhost/onboarding?client=client_a"),
      context: ctx,
    } as never);
    const html = renderToStaticMarkup(
      createElement(
        RouterProvider,
        {
          router: createMemoryRouter(
            [
              {
                path: "/onboarding",
                element: createElement(onboarding.default, {
                  loaderData,
                  actionData: { error: limitation.reason, limitation },
                } as never),
              },
            ],
            { initialEntries: ["/onboarding?client=client_a"] },
          ),
        } as never,
      ),
    );

    expect(html).toContain('value="one"');
    expect(html).toContain('value="two"');
    expect(html.match(/name="offering"/g)?.length).toBe(2);
    expect(html).toContain('role="status"');
  });
});
