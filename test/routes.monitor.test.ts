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

function renderedSubmission(html: string, submitLabel: string): URLSearchParams {
  const buttonText = (value: string) =>
    value
      .replace(/<[^>]+>/g, "")
      .replaceAll("&#x27;", "'")
      .replaceAll("&apos;", "'")
      .replaceAll("&amp;", "&")
      .trim();
  const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
  const form = forms.find((candidate) =>
    [...candidate.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].some(
      (match) => buttonText(match[1]!) === submitLabel,
    ),
  );
  if (!form) throw new Error(`Rendered form for ${submitLabel} was not found`);

  const params = new URLSearchParams();
  for (const match of form.matchAll(/<input\b[^>]*>/g)) {
    const tag = match[0];
    const name = tag.match(/\bname="([^"]*)"/)?.[1];
    if (!name || /\bdisabled(?:="")?/.test(tag)) continue;
    params.append(name, tag.match(/\bvalue="([^"]*)"/)?.[1] ?? "");
  }

  const clicked = [...form.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(
    (match) => buttonText(match[2]!) === submitLabel,
  );
  const clickedAttributes = clicked?.[1] ?? "";
  const clickedName = clickedAttributes.match(/\bname="([^"]*)"/)?.[1];
  if (clickedName) {
    params.append(clickedName, clickedAttributes.match(/\bvalue="([^"]*)"/)?.[1] ?? "");
  }
  return params;
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
  it("gives a locked workspace the same prefilled pilot handoff without implying automatic enrollment", () => {
    const router = createMemoryRouter([
      {
        path: "/monitor",
        element: createElement(monitor.default, {
          loaderData: { entitled: false, ownerEmail: "owner@agency.example" },
        } as never),
      },
    ], { initialEntries: ["/monitor"] });
    const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
    const hrefs = [...html.matchAll(/href="(mailto:[^"]+)"/g)].map((match) =>
      match[1]!.replaceAll("&amp;", "&"),
    );

    expect(hrefs).toHaveLength(1);
    const url = new URL(hrefs[0]!);
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe("hello@getaxiom.ca");
    expect(url.searchParams.get("subject")).toBe("Axiom Orbit agency pilot request");
    expect(url.searchParams.get("body")).toContain("Agency name:");
    expect(url.searchParams.get("body")).toContain("Client sites managed:");
    expect(html).toContain("14-day assisted review");
    expect(html).toContain("up to ten client sites");
    expect(html).toContain("within two business days");
    expect(html).toContain("weekly client rechecks");
    expect(html).toContain("configured email transport");
    expect(html).toContain("manual and separate");
  });

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

  it("serializes one unambiguous intent from each rendered digest form", async () => {
    const loaderData = await monitor.loader({
      request: req(),
      context: ctxWith({ MONITOR_ENTITLEMENT_MODE: "open", EMAIL_TRANSPORT: "console" }),
      params: {},
    } as never);
    const router = createMemoryRouter(
      [
        {
          path: "/monitor",
          element: createElement(monitor.default, { loaderData } as never),
        },
      ],
      { initialEntries: ["/monitor"] },
    );
    const html = renderToStaticMarkup(createElement(RouterProvider, { router }));

    expect(renderedSubmission(html, "Save").getAll("intent")).toEqual([
      "save-digest-settings",
    ]);
    expect(
      renderedSubmission(html, "Send me this week's digest").getAll("intent"),
    ).toEqual(["send-digest-now"]);
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
