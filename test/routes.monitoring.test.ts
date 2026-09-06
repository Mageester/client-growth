import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CADENCE_INTERVAL_MS } from "@/core/monitoring";
import * as monitoring from "@/db/monitoring";
import * as repo from "@/db/repositories";
import type { TenantScope } from "@/db/tenant";
import { __setSessionResolver } from "../app/lib/session.server";
import { buildPortfolio, portfolioFetch, type Portfolio } from "./helpers/portfolio";

import * as clientDetail from "../app/routes/clients.$id";
import * as monitoringTrigger from "../app/routes/internal.monitoring.run";

const NOW = new Date("2026-09-02T12:00:00.000Z");
const TOKEN = "a".repeat(48);

let portfolio: Portfolio;
let scope: TenantScope;
let ctx: { cloudflare: { env: Record<string, unknown> } };

/** A client in ws_a that starts with monitoring off. */
const offClient = () =>
  portfolio.clients.find((c) => c.workspaceId === "ws_a" && c.cadence === "off")!;

function formReq(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

async function call(fn: (a: never) => unknown, args: unknown): Promise<unknown> {
  try {
    return await fn(args as never);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

beforeEach(async () => {
  // The fixture schedules clients relative to NOW, including some that are
  // deliberately NOT yet due. Freeze the clock to NOW so "due" stays a property
  // of the fixture rather than of the day the suite happens to run: with a real
  // clock, every not-yet-due client silently becomes due once that date passes.
  // Only Date is faked — timers stay real so awaited work still settles.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  portfolio = await buildPortfolio({ workspaces: 2, perWorkspace: 6, now: NOW });
  scope = portfolio.scopeFor("ws_a");
  __setSessionResolver(async () => ({
    userId: "u_ws_a",
    user: { id: "u_ws_a", email: "a@x.example", name: "A" },
  }));
  ctx = {
    cloudflare: {
      env: {
        DB: portfolio.d1 as never,
        AI_PROVIDER: "mock",
        MAX_AI_CALLS_PER_RUN: "10",
      },
    },
  };
  vi.stubGlobal("fetch", portfolioFetch(portfolio.clients));
});

afterEach(() => {
  __setSessionResolver(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  portfolio.close();
});

describe("the monitoring control on a client", () => {
  it("shows monitoring as off for a client nobody has opted in", async () => {
    const data = (await clientDetail.loader({
      params: { id: offClient().clientId },
      request: new Request("http://localhost/"),
      context: ctx,
    } as never)) as { monitoring: { cadence: string; nextDueAt: string | null } };

    expect(data.monitoring.cadence).toBe("off");
    expect(data.monitoring.nextDueAt).toBeNull();
  });

  it("turns monitoring on and schedules the first check", async () => {
    const client = offClient();
    const result = (await clientDetail.action({
      params: { id: client.clientId },
      request: formReq({ intent: "set-monitoring", cadence: "weekly" }),
      context: ctx,
    } as never)) as { ok: boolean; message: string };

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/weekly/i);

    const state = await monitoring.getMonitoring(scope, client.clientId);
    expect(state?.cadence).toBe("weekly");
    expect(state?.nextDueAt).not.toBeNull();
  });

  it("turning it on right after an analysis does not schedule an immediate re-scan", async () => {
    const client = offClient();
    const finishedAt = new Date().toISOString();
    await repo.recordAnalysisRun(scope, {
      clientId: client.clientId,
      startedAt: finishedAt,
      finishedAt,
      source: "http",
      outcome: "clean",
      summary: "clean",
      limitation: null,
      pagesRead: 4,
      pagesFetched: 4,
      blockedEvents: 0,
      inconclusiveEvents: 0,
      surfaced: 0,
      stats: {},
      trigger: "manual",
      newCount: 0,
      resolvedCount: 0,
      evaluatorCalls: 1,
      evaluatorRejections: 0,
      evaluatorErrors: 0,
    });

    await clientDetail.action({
      params: { id: client.clientId },
      request: formReq({ intent: "set-monitoring", cadence: "weekly" }),
      context: ctx,
    } as never);

    const state = await monitoring.getMonitoring(scope, client.clientId);
    const expected = Date.parse(finishedAt) + CADENCE_INTERVAL_MS.weekly;
    expect(Math.abs(Date.parse(state!.nextDueAt!) - expected)).toBeLessThan(2000);
    expect(state!.nextDueAt! > new Date().toISOString()).toBe(true);
  });

  it("turns monitoring off again and unschedules it", async () => {
    const client = offClient();
    await clientDetail.action({
      params: { id: client.clientId },
      request: formReq({ intent: "set-monitoring", cadence: "weekly" }),
      context: ctx,
    } as never);
    const result = (await clientDetail.action({
      params: { id: client.clientId },
      request: formReq({ intent: "set-monitoring", cadence: "off" }),
      context: ctx,
    } as never)) as { ok: boolean; message: string };

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/turned off/i);
    const state = await monitoring.getMonitoring(scope, client.clientId);
    expect(state?.cadence).toBe("off");
    expect(state?.nextDueAt).toBeNull();
  });

  it("rejects a cadence the model does not define", async () => {
    const client = offClient();
    const result = (await clientDetail.action({
      params: { id: client.clientId },
      request: formReq({ intent: "set-monitoring", cadence: "every-minute" }),
      context: ctx,
    } as never)) as { ok: boolean };

    expect(result.ok).toBe(false);
    expect((await monitoring.getMonitoring(scope, client.clientId))?.cadence).toBe("off");
  });

  it("cannot enable monitoring on another workspace's client", async () => {
    const foreign = portfolio.clients.find((c) => c.workspaceId === "ws_b")!;
    const response = await call(clientDetail.action as never, {
      params: { id: foreign.clientId },
      request: formReq({ intent: "set-monitoring", cadence: "weekly" }),
      context: ctx,
    });

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(404);
    const state = await monitoring.getMonitoring(
      portfolio.scopeFor("ws_b"),
      foreign.clientId,
    );
    expect(state?.cadence).toBe(foreign.cadence);
  });
});

describe("the operator monitoring trigger", () => {
  const withToken = (token?: string) => ({
    cloudflare: {
      env: { ...ctx.cloudflare.env, ...(token ? { MONITORING_TRIGGER_TOKEN: token } : {}) },
    },
  });

  const post = (headers: Record<string, string> = {}) =>
    new Request("http://localhost/internal/monitoring/run", { method: "POST", headers });

  it("does not exist unless a trigger token is configured", async () => {
    const response = await call(monitoringTrigger.action as never, {
      request: post({ authorization: `Bearer ${TOKEN}` }),
      context: withToken(),
    });
    expect((response as Response).status).toBe(404);
  });

  it("treats a too-short token as not configured rather than as a weak one", async () => {
    const response = await call(monitoringTrigger.action as never, {
      request: post({ authorization: "Bearer short" }),
      context: withToken("short"),
    });
    expect((response as Response).status).toBe(404);
  });

  it("rejects a missing or wrong token", async () => {
    const cases: Array<Record<string, string>> = [
      {},
      { authorization: "Bearer " + "b".repeat(48) },
    ];
    for (const headers of cases) {
      const response = await call(monitoringTrigger.action as never, {
        request: post(headers),
        context: withToken(TOKEN),
      });
      expect((response as Response).status).toBe(401);
    }
  });

  it("refuses anything but POST, and never runs on a GET", async () => {
    const response = await call(monitoringTrigger.action as never, {
      request: new Request("http://localhost/internal/monitoring/run", {
        method: "PUT",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      context: withToken(TOKEN),
    });
    expect((response as Response).status).toBe(405);
    expect((await call(monitoringTrigger.loader as never, {}) as Response).status).toBe(404);
  });

  it("runs the real scheduled path and reports counts, not client data", async () => {
    const response = (await monitoringTrigger.action({
      request: post({ authorization: `Bearer ${TOKEN}` }),
      context: withToken(TOKEN),
    } as never)) as Response;

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.scanned).toBeGreaterThan(0);
    expect(Array.isArray(body.outcomes)).toBe(true);

    // Counts only: no client id, domain, evidence or provider output.
    const serialized = JSON.stringify(body);
    for (const client of portfolio.clients) {
      expect(serialized).not.toContain(client.clientId);
      expect(serialized).not.toContain(client.domain);
    }
    expect(serialized).not.toContain(TOKEN);
  });

  it("only scans clients that were genuinely due, exactly like the cron does", async () => {
    await monitoringTrigger.action({
      request: post({ authorization: `Bearer ${TOKEN}` }),
      context: withToken(TOKEN),
    } as never);

    for (const client of portfolio.clients) {
      const runs = await repo.listAnalysisRuns(
        portfolio.scopeFor(client.workspaceId),
        client.clientId,
        5,
      );
      const wasDue = client.cadence !== "off" && (client.dueOffsetMs ?? 0) < 0;
      expect(runs.length > 0, client.clientId).toBe(wasDue);
      if (wasDue) expect(runs[0]!.trigger).toBe("scheduled");
    }
  });
});
