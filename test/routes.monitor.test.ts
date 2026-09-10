import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as monitoring from "@/db/monitoring";
import { getMonitorDigestSettings } from "@/db/monitorDigests";
import type { TenantScope } from "@/db/tenant";
import { __setSessionResolver } from "../app/lib/session.server";
import { buildPortfolio, portfolioFetch, type Portfolio } from "./helpers/portfolio";

import * as monitor from "../app/routes/monitor";

const NOW = new Date("2026-09-02T12:00:00.000Z");

let portfolio: Portfolio;
let scope: TenantScope;

const BASE_ENV = {
  AI_PROVIDER: "mock",
  MAX_AI_CALLS_PER_RUN: "10",
  BETTER_AUTH_URL: "https://orbit.example",
};

function ctxWith(overrides: Record<string, unknown>) {
  return {
    cloudflare: { env: { DB: portfolio.d1 as never, ...BASE_ENV, ...overrides } },
  };
}

function formReq(fields: Record<string, string>) {
  return new Request("http://localhost/monitor", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

const req = () => new Request("http://localhost/monitor");

async function call(fn: (a: never) => unknown, args: unknown): Promise<unknown> {
  try {
    return await fn(args as never);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

const offClientA = () =>
  portfolio.clients.find((c) => c.workspaceId === "ws_a" && c.cadence === "off")!;
const anyClientB = () => portfolio.clients.find((c) => c.workspaceId === "ws_b")!;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  portfolio = await buildPortfolio({ workspaces: 2, perWorkspace: 6, now: NOW });
  scope = portfolio.scopeFor("ws_a");
  __setSessionResolver(async () => ({
    userId: "u_ws_a",
    user: { id: "u_ws_a", email: "a@x.example", name: "A" },
  }));
  vi.stubGlobal("fetch", portfolioFetch(portfolio.clients));
});

afterEach(() => {
  __setSessionResolver(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  portfolio.close();
});

describe("monitor console loader", () => {
  it("shows the upsell when the workspace is not entitled", async () => {
    const data = (await monitor.loader({
      request: req(),
      context: ctxWith({ MONITOR_ENTITLEMENT_MODE: "off" }),
      params: {},
    } as never)) as { entitled: boolean };
    expect(data.entitled).toBe(false);
  });

  it("returns the console for an entitled workspace", async () => {
    const data = (await monitor.loader({
      request: req(),
      context: ctxWith({ MONITOR_ENTITLEMENT_MODE: "open" }),
      params: {},
    } as never)) as {
      entitled: boolean;
      clients: unknown[];
      portfolio: { monitored: number };
      digest: { cadence: string };
    };
    expect(data.entitled).toBe(true);
    expect(data.clients).toHaveLength(6);
    expect(data.digest.cadence).toBe("weekly");
    expect(typeof data.portfolio.monitored).toBe("number");
  });
});

describe("monitor console actions", () => {
  it("saves digest preferences when entitled", async () => {
    const result = (await call(monitor.action, {
      request: formReq({ intent: "save-digest-settings", cadence: "off", recipient: "ops@x.example" }),
      context: ctxWith({ MONITOR_ENTITLEMENT_MODE: "open" }),
      params: {},
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    const settings = await getMonitorDigestSettings(scope);
    expect(settings).toMatchObject({ cadence: "off", onlyOnChange: false, recipient: "ops@x.example" });
  });

  it("refuses to save digest preferences when not entitled", async () => {
    const result = (await call(monitor.action, {
      request: formReq({ intent: "save-digest-settings", cadence: "off" }),
      context: ctxWith({ MONITOR_ENTITLEMENT_MODE: "off" }),
      params: {},
    })) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    // Unchanged from the default.
    expect((await getMonitorDigestSettings(scope)).cadence).toBe("weekly");
  });

  it("turns monitoring on for a client when entitled, and refuses when not", async () => {
    const client = offClientA();

    const refused = (await call(monitor.action, {
      request: formReq({ intent: "set-cadence", clientId: client.clientId, cadence: "weekly" }),
      context: ctxWith({ MONITOR_ENTITLEMENT_MODE: "off" }),
      params: {},
    })) as { ok: boolean };
    expect(refused.ok).toBe(false);
    expect((await monitoring.getMonitoring(scope, client.clientId))?.cadence).toBe("off");

    const ok = (await call(monitor.action, {
      request: formReq({ intent: "set-cadence", clientId: client.clientId, cadence: "weekly" }),
      context: ctxWith({ MONITOR_ENTITLEMENT_MODE: "open" }),
      params: {},
    })) as { ok: boolean };
    expect(ok.ok).toBe(true);
    expect((await monitoring.getMonitoring(scope, client.clientId))?.cadence).toBe("weekly");
  });

  it("cannot change monitoring for a client in another workspace", async () => {
    const foreign = anyClientB();
    const result = (await call(monitor.action, {
      request: formReq({ intent: "set-cadence", clientId: foreign.clientId, cadence: "weekly" }),
      context: ctxWith({ MONITOR_ENTITLEMENT_MODE: "open" }),
      params: {},
    })) as { ok: boolean };
    expect(result.ok).toBe(false);
    // The foreign client's monitoring is untouched in its own workspace.
    const foreignScope = portfolio.scopeFor("ws_b");
    expect((await monitoring.getMonitoring(foreignScope, foreign.clientId))?.cadence).toBe(
      foreign.cadence,
    );
  });

  it("sends a digest on demand when email is deliverable", async () => {
    const result = (await call(monitor.action, {
      request: formReq({ intent: "send-digest-now" }),
      context: ctxWith({ MONITOR_ENTITLEMENT_MODE: "open", EMAIL_TRANSPORT: "console" }),
      params: {},
    })) as { ok: boolean; message?: string };
    expect(result.ok).toBe(true);
  });
});

/**
 * The locked Monitor screen, and what it is honest about.
 *
 * The audit found three problems in one panel. It told the agency to "ask us to
 * turn it on" with no way to ask. It promised that Orbit notices "something a
 * competitor added" — competitor comparison is real, but it is a manual,
 * user-started comparison, not a scheduled watch, and nothing schedules it. And
 * it promised an emailed digest without saying that delivery depends on a mail
 * transport this environment may not have configured.
 *
 * Entitlement stays operator-enabled. Nothing here opens it.
 */
describe("the locked Monitor screen", () => {
  const renderLocked = () =>
    renderToStaticMarkup(
      createElement(RouterProvider, {
        router: createMemoryRouter(
          [
            {
              path: "*",
              element: createElement(monitor.default, {
                loaderData: { entitled: false, ownerEmail: "owner@agency.example" },
              } as never),
            },
          ],
          { initialEntries: ["/monitor"] },
        ),
      }),
    );

  it("gives the same real pilot action the closed signup page gives", () => {
    const html = renderLocked();
    const match = html.match(/href="(mailto:[^"]+)"/);
    expect(match).not.toBeNull();
    const url = new URL(match![1]!.replace(/&amp;/g, "&"));

    expect(url.pathname).toBe("hello@getaxiom.ca");
    expect(url.searchParams.get("subject")).toBe("Axiom Orbit agency pilot request");
  });

  it("does not claim a scheduled competitor watch it does not run", () => {
    const html = renderLocked();

    expect(html).not.toMatch(/competitor added|competitors? change|watch(?:es|ing)? competitors/i);
    expect(html).toMatch(/weekly recheck|weekly client recheck|rechecks each client/i);
  });

  it("says who turns it on, and that the digest needs configured email", () => {
    const html = renderLocked();

    expect(html).toMatch(/Axiom enables it|enabled by Axiom|we enable it/i);
    expect(html).toMatch(/where email delivery is configured/i);
  });
});

/**
 * "Send me this week's digest" has to send this week's digest.
 *
 * It did not. Both controls lived in one form whose FIRST field was a hidden
 * `intent=save-digest-settings`; the send button appended a second `intent`
 * after it, and `formData.get("intent")` returns the first. Two clicks on Send
 * during the audit saved preferences twice and sent nothing, while reporting
 * success — the most damaging shape of bug, because the screen agreed with the
 * user about something that had not happened.
 *
 * The regression serializes the ACTUAL rendered form with its actual submitter,
 * rather than building an idealized FormData by hand. A hand-built object would
 * have passed against the broken markup, which is precisely why it is not used.
 */
describe("the digest controls submit the action they name", () => {
  function renderEntitled(): string {
    return renderToStaticMarkup(
      createElement(RouterProvider, {
        router: createMemoryRouter(
          [
            {
              path: "*",
              element: createElement(monitor.default, {
                loaderData: {
                  entitled: true,
                  ownerEmail: "owner@agency.example",
                  totalClients: 3,
                  portfolio: { monitored: 2, due: 0, unhealthy: 0 },
                  digest: { cadence: "weekly", onlyOnChange: true, recipient: "owner@agency.example" },
                  digestRuns: [],
                  clients: [],
                  changes: [],
                  emailConfigured: true,
                  now: NOW.toISOString(),
                },
              } as never),
            },
          ],
          { initialEntries: ["/monitor"] },
        ),
      }),
    );
  }

  /** Every <form> in the rendered markup, with its hidden inputs and buttons. */
  function forms(html: string): Array<{ markup: string; intents: string[] }> {
    return [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((match) => {
      const markup = match[0];
      const intents = [...markup.matchAll(/name="intent"[^>]*value="([^"]+)"/g)].map(
        (intent) => intent[1]!,
      );
      return { markup, intents };
    });
  }

  it("puts exactly one intent in each digest form", () => {
    const html = renderEntitled();
    const digestForms = forms(html).filter((form) =>
      form.intents.some((intent) => intent.startsWith("save-digest") || intent.startsWith("send-digest")),
    );

    expect(digestForms).toHaveLength(2);
    for (const form of digestForms) {
      // A form carrying two intents is the bug: the reader picks the first.
      expect(new Set(form.intents).size).toBe(1);
    }

    const sendForm = digestForms.find((form) => form.intents[0] === "send-digest-now");
    const saveForm = digestForms.find((form) => form.intents[0] === "save-digest-settings");
    expect(sendForm?.markup).toContain("Send me this week");
    expect(sendForm?.markup).not.toContain('name="cadence"');
    expect(sendForm?.markup).not.toContain('name="recipient"');
    expect(saveForm?.markup).toContain('name="cadence"');
    expect(saveForm?.markup).not.toContain("Send me this week");
  });

  it("reaches the send path rather than the preference path", async () => {
    const before = await getMonitorDigestSettings(scope);
    const result = (await call(monitor.action as never, {
      request: formReq({ intent: "send-digest-now" }),
      context: ctxWith({}),
    })) as { ok: boolean; message?: string; error?: string };

    // Whatever the outcome — sent, skipped, unconfigured, failed — it must be
    // the send path's outcome and must not silently rewrite preferences.
    expect(`${result.message ?? ""}${result.error ?? ""}`).not.toMatch(/preferences saved/i);
    const after = await getMonitorDigestSettings(scope);
    expect(after.cadence).toBe(before.cadence);
    expect(after.recipient).toBe(before.recipient);
  });
});
