import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import Database from "better-sqlite3";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as repo from "@/db/repositories";
import { reserveAnalysisStart } from "@/db/analysisLimits";
import { getWorkspaceForUser } from "@/db/workspaces";
import { SCHEMA_SQL } from "@/db/schema";
import { EvidenceBundleSchema } from "@/core/schema";
import { __setSessionResolver } from "../app/lib/session.server";
import { d1LikeOver } from "./helpers/testAuth";

import * as onboarding from "../app/routes/onboarding";

function renderSetupMarkup() {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: createElement(onboarding.default, {
          loaderData: {
            stage: "setup",
            hasWorkspace: false,
            client: null,
            readFailed: false,
            crawl: null,
            suggestions: [],
          },
          actionData: undefined,
        } as never),
      },
    ],
    { initialEntries: ["/onboarding"] },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function renderConfirmMarkup(loaderData: unknown) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: createElement(onboarding.default, {
          loaderData,
          actionData: undefined,
        } as never),
      },
    ],
    { initialEntries: ["/onboarding?client=client-velvet"] },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/**
 * Onboarding is two stages, and these tests exist to keep it that way.
 *
 * Thirteen of the first fourteen real analysis runs came back inconclusive. The
 * cause was not the engine: it was a single-stage signup that asked an agency
 * owner to type what a client sells from memory, before Axiom Orbit had shown
 * them anything. Four of six real clients were recorded with one offering or
 * none, and the engine needs two before it will claim anything is missing —
 * every one of those runs was structurally guaranteed to fail.
 *
 * The rules being defended here:
 *
 *   1. Stage one reads the site and NOTHING else. No evaluator, no run
 *      recorded, so a first attempt costs nothing and cannot leave a client
 *      looking analyzed.
 *   2. A crawl that fails is carried forward and said out loud, not swallowed.
 *   3. Nothing the crawl proposed is saved because it was proposed. Only the
 *      boxes a person left checked are written to the client.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let raw: Database.Database;
let scope: { db: never; workspaceId: string };
let ctx: { cloudflare: { env: Record<string, unknown> } };

function sqlDbOver(db: Database.Database) {
  const stmt = (sql: string, bound: unknown[]) => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    all: async () => db.prepare(sql).all(...(bound as never[])),
    first: async () => db.prepare(sql).get(...(bound as never[])) ?? null,
    run: async () => ({ rowsAffected: db.prepare(sql).run(...(bound as never[])).changes }),
  });
  return { prepare: (sql: string) => stmt(sql, []), exec: async (s: string) => void db.exec(s) };
}

function formReq(fields: Record<string, string | string[]>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
  }
  return new Request("http://localhost/onboarding", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

async function call(fn: (a: unknown) => unknown, args: unknown): Promise<unknown> {
  try {
    return await fn(args);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

const HOME = `<!doctype html><html><head><title>Northwind Heating</title></head><body>
<nav><a href="/services/heat-pump-installation">Heat Pump Installation</a>
<a href="/services/boiler-repair">Boiler Repair</a>
<a href="/about">About</a></nav>
<h1>Northwind Heating</h1>
<p>${"We keep homes warm across the county all winter long. ".repeat(30)}</p>
</body></html>`;

function servicePage(title: string) {
  return `<!doctype html><html><head><title>${title}</title></head><body>
<h1>${title}</h1><p>${`Book ${title.toLowerCase()} with our engineers today. `.repeat(30)}</p>
</body></html>`;
}

/** A small, deterministic site with a real services section. No network. */
function siteFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/sitemap.xml")) return new Response("", { status: 404 });
    if (url.includes("/services/heat-pump-installation")) {
      return new Response(servicePage("Heat Pump Installation"), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url.includes("/services/boiler-repair")) {
      return new Response(servicePage("Boiler Repair"), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response(HOME, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
}

/** The whole site is unreachable — a DNS failure, not a 404. */
function deadFetch(): typeof fetch {
  return vi.fn(async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  }) as unknown as typeof fetch;
}

const SETUP_FIELDS = {
  workspaceName: "Axiom Web",
  landingOn: "on",
  landingName: "Service Landing Page",
  landingMin: "900",
  landingMax: "1800",
  servicepagesOn: "on",
  servicepagesName: "Service Pages Build",
  servicepagesMin: "2500",
  servicepagesMax: "6000",
  conversionOn: "on",
  conversionName: "Conversion Path Fix",
  conversionMin: "300",
  conversionMax: "900",
  clientName: "Northwind Heating",
  clientDomain: "northwind.example",
};

beforeEach(async () => {
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  raw.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  raw.exec(SCHEMA_SQL);
  scope = { db: sqlDbOver(raw) as never, workspaceId: "" };
  __setSessionResolver(async () => ({
    userId: "u_new",
    user: { id: "u_new", email: "new@x.example", name: "New" },
  }));
  ctx = {
    cloudflare: {
      env: {
        DB: d1LikeOver(raw),
        BETTER_AUTH_SECRET: "x".repeat(40),
        BETTER_AUTH_URL: "http://localhost:8787",
        AI_PROVIDER: "mock",
        MAX_AI_CALLS_PER_RUN: "10",
      },
    },
  };
});

afterEach(() => {
  __setSessionResolver(null);
  vi.unstubAllGlobals();
  raw.close();
});

/** The workspace stage one just created, plus a scope pointing at it. */
async function workspaceScope() {
  const ws = await getWorkspaceForUser(scope.db, "u_new");
  expect(ws).not.toBeNull();
  return { db: scope.db, workspaceId: ws!.id };
}

async function runSetup() {
  return (await call(onboarding.action as never, {
    request: formReq(SETUP_FIELDS),
    context: ctx,
  })) as Response;
}

describe("onboarding stage one: read the site, judge nothing", () => {
  it("puts the client read first and collapses starter pricing until it is needed", () => {
    const html = renderSetupMarkup();

    expect(html).toContain("AI catalog assistant");
    expect(html).toContain("Build my service catalog");
    expect(html).toContain("Review starter pricing");
    expect(html).toContain("starter services with conservative price ranges");
    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]*\bopen(?:=|>)/);
    expect(html.indexOf("Your first client")).toBeLessThan(html.indexOf("Review starter pricing"));
    expect(html.indexOf('name="clientName"')).toBeLessThan(html.indexOf("Review starter pricing"));
    expect(html.indexOf('name="clientDomain"')).toBeLessThan(html.indexOf("Review starter pricing"));
    // The optional AI assistant sat above the one path that has to be walked to
    // finish setup, so the first screen led with the skippable thing.
    expect(html.indexOf("Your first client")).toBeLessThan(html.indexOf("AI catalog assistant"));
    expect(html.indexOf('name="clientDomain"')).toBeLessThan(html.indexOf("AI catalog assistant"));
    expect(html.indexOf("Review starter pricing")).toBeLessThan(html.indexOf("AI catalog assistant"));
    expect(html).toMatch(/Optional/i);
  });

  it("explains the default pricing and the crawl-only confirmation gate", () => {
    const html = renderSetupMarkup();

    expect(html).toMatch(/defaults (?:are )?used to price early findings/i);
    expect(html).toMatch(/reviewed before analysis/i);
    expect(html).toMatch(/first action is a crawl-only read/i);
    expect(html).toMatch(/analysis runs after you confirm/i);
  });

  it("keeps the bare onboarding starter card styled in the generated harness", () => {
    const output = mkdtempSync(join(tmpdir(), "axiom-orbit-onboarding-harness-"));

    try {
      execFileSync(
        process.execPath,
        [join("node_modules", "tsx", "dist", "cli.mjs"), "scripts/design-harness.tsx", output],
        { cwd: process.cwd(), stdio: "pipe" },
      );

      const html = readFileSync(join(output, "onboarding-setup.html"), "utf8");
      const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

      expect(html).toContain('<main class="detail onboarding">');
      expect(html).toContain('<details class="starter-pricing">');
      expect(style).toMatch(
        /:is\(\.onboarding, \.app-frame \.onboarding\) \.starter-pricing\s*\{/,
      );
      expect(style).toMatch(
        /:is\(\.onboarding, \.app-frame \.onboarding\) \.starter-pricing-body \.starter-list\s*\{/,
      );
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });

  it("names every starter price control and keeps it inside the closed setup form", () => {
    const html = renderSetupMarkup();
    const formStart = html.indexOf("<form");
    const formEnd = html.indexOf("</form>");
    const detailsStart = html.indexOf("<details");
    const detailsEnd = html.indexOf("</details>");

    expect(formStart).toBeGreaterThanOrEqual(0);
    expect(formEnd).toBeGreaterThan(formStart);
    expect(detailsStart).toBeGreaterThan(formStart);
    expect(detailsEnd).toBeLessThan(formEnd);
    expect(html.slice(detailsStart, detailsEnd)).not.toMatch(/<details[^>]*\bopen(?:=|>)/);

    const details = html.slice(detailsStart, detailsEnd);
    const starters = [
      "Service Landing Page",
      "Service Pages Build",
      "Competitor Gap Page",
      "Conversion Path Fix",
      "Page Title Repair",
      "Duplicate Title Repair",
      "Thin Service Page",
      "H1 Heading Repair",
      "Internal Link Repair",
      "Meta Description Repair",
      "LocalBusiness or Service Schema",
      "Image Alt Attribute Repair",
    ];
    for (const name of starters) {
      expect(details).toContain(`aria-label="${name} minimum price"`);
      expect(details).toContain(`aria-label="${name} maximum price"`);
    }
  });

  it("updates rendered price-control names when a starter service is renamed", () => {
    const StarterPriceControls = (
      onboarding as {
        StarterPriceControls?: (props: never) => unknown;
      }
    ).StarterPriceControls;
    expect(typeof StarterPriceControls).toBe("function");
    if (typeof StarterPriceControls !== "function") return;

    const service = {
      tag: "landing-page",
      field: "landing",
      name: "Service Landing Page",
      min: 900,
      max: 1800,
      when: "a client sells something their website never gives its own page",
    };
    const renderControls = (serviceName: string) =>
      renderToStaticMarkup(
        createElement(StarterPriceControls as never, { service, serviceName } as never),
      );

    const initial = renderControls("Service Landing Page");
    const renamed = renderControls("Heat Pump Installation");

    expect(initial).toContain('aria-label="Service Landing Page minimum price"');
    expect(initial).toContain('aria-label="Service Landing Page maximum price"');
    expect(renamed).toContain('aria-label="Heat Pump Installation minimum price"');
    expect(renamed).toContain('aria-label="Heat Pump Installation maximum price"');
    expect(renamed).not.toContain('aria-label="Service Landing Page minimum price"');
    expect(renamed).not.toContain('aria-label="Service Landing Page maximum price"');
  });

  it("falls back to the default service name for every label when the current name is blank", () => {
    const StarterIdentityControls = (
      onboarding as {
        StarterIdentityControls?: (props: never) => unknown;
      }
    ).StarterIdentityControls;
    expect(typeof StarterIdentityControls).toBe("function");
    if (typeof StarterIdentityControls !== "function") return;

    const service = {
      tag: "landing-page",
      field: "landing",
      name: "Service Landing Page",
      min: 900,
      max: 1800,
      when: "a client sells something their website never gives its own page",
    };
    for (const currentName of ["", "   "]) {
      const html = renderToStaticMarkup(
        createElement(
          "div",
          null,
          createElement(StarterIdentityControls as never, {
            service,
            serviceName: currentName,
            onNameChange: () => undefined,
          } as never),
          createElement(onboarding.StarterPriceControls as never, {
            service,
            serviceName: currentName,
          } as never),
        ),
      );

      expect(html).toContain('aria-label="Offer Service Landing Page"');
      expect(html).toContain('aria-label="Service Landing Page service name"');
      expect(html).toContain('aria-label="Service Landing Page minimum price"');
      expect(html).toContain('aria-label="Service Landing Page maximum price"');
    }
  });

  it("creates the client with no offerings and hands stage two the crawl", async () => {
    vi.stubGlobal("fetch", siteFetch());
    const res = await runSetup();

    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location).toMatch(/^\/onboarding\?client=client-northwind-heating-/);

    const t = await workspaceScope();
    const clientId = new URL(location, "http://localhost").searchParams.get("client")!;
    const client = await repo.getClient(t, clientId);

    // The offerings box is gone from stage one on purpose: what a business
    // sells is a question the site answers better than its agency's memory.
    expect(client!.offerings).toEqual([]);

    // Evidence, but no verdict. Spending an evaluator call here would judge a
    // client profile that is still empty, and recording a run would make the
    // client look analyzed when nothing was assessed.
    expect(await repo.getLatestEvidence(t, clientId)).not.toBeNull();
    expect(await repo.getLatestAnalysisRun(t, clientId)).toBeNull();
  });

  it("uses a reviewed AI catalog instead of the starter catalog during setup", async () => {
    vi.stubGlobal("fetch", siteFetch());
    const reviewedCatalog = JSON.stringify([
      {
        name: "Conversion Web Design",
        description: "A conversion-focused website designed and built from strategy to launch.",
        priceMin: 3000,
        priceMax: 7000,
      },
      {
        name: "Local SEO Retainer",
        description: "Ongoing local search optimization, reporting, and content improvements.",
        priceMin: 900,
        priceMax: 1800,
      },
    ]);
    const result = (await call(onboarding.action as never, {
      request: formReq({ ...SETUP_FIELDS, reviewedCatalog }),
      context: ctx,
    })) as Response;

    expect(result.status).toBe(302);
    const services = await repo.listServices(await workspaceScope());
    expect(services.map((service) => service.name)).toEqual([
      "Conversion Web Design",
      "Local SEO Retainer",
    ]);
    expect(services).toHaveLength(2);
  });

  it("rejects a tampered reviewed catalog before creating setup state", async () => {
    const result = (await call(onboarding.action as never, {
      request: formReq({ ...SETUP_FIELDS, reviewedCatalog: '[{"name":"Injected"}]' }),
      context: ctx,
    })) as { error?: string };

    expect(result.error).toMatch(/reviewed catalog/i);
    expect(await getWorkspaceForUser(scope.db, "u_new")).toBeNull();
  });

  it("reaches stage two with nothing invented when the site is unreachable", async () => {
    vi.stubGlobal("fetch", deadFetch());
    const res = await runSetup();

    // The workspace, catalog and client all survive — only the reading failed,
    // and stage two says so and offers a retry rather than stranding the user.
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/onboarding\?client=/);

    const t = await workspaceScope();
    const clients = await repo.listClients(t);
    expect(clients).toHaveLength(1);

    // A crawl that reached nothing stores an empty bundle rather than throwing,
    // and an empty bundle must stay empty: no page was read, so no offering can
    // be suggested and no run may be recorded.
    const evidence = await repo.getLatestEvidence(t, clients[0]!.id);
    expect(evidence!.site.pages).toHaveLength(0);
    expect(clients[0]!.offerings).toEqual([]);
    expect(await repo.getLatestAnalysisRun(t, clients[0]!.id)).toBeNull();
  });

  it("carries a transport timeout reason into the confirmation stage", async () => {
    vi.stubGlobal("fetch", siteFetch());
    const res = await runSetup();
    const clientId = new URL(res.headers.get("location")!, "http://localhost").searchParams.get(
      "client",
    )!;
    const t = await workspaceScope();
    const current = await repo.getLatestEvidence(t, clientId);
    expect(current).not.toBeNull();

    await repo.saveEvidence(
      t,
      EvidenceBundleSchema.parse({
        ...current,
        capturedAt: "2099-01-01T00:00:01.000Z",
        site: { ...current!.site, pages: [] },
        networkEvents: [
          {
            url: "https://artfullyyou.ca/",
            outcome: "inconclusive",
            reason: "request timeout",
            code: "timeout",
            stage: "page",
          },
        ],
      }),
    );

    const data = (await call(onboarding.loader as never, {
      request: new Request("http://localhost/onboarding?client=" + clientId),
      context: ctx,
    })) as { crawlFailure?: { title: string; detail: string; retryable: boolean } };

    expect(data.crawlFailure?.title).toBe("The site did not respond to Orbit's request");
    expect(data.crawlFailure?.detail).toMatch(/incomplete read/i);
    expect(data.crawlFailure?.retryable).toBe(true);
  });

  it("requires at least one service, since findings are priced from the catalog", async () => {
    const res = (await call(onboarding.action as never, {
      request: formReq({
        workspaceName: "Axiom Web",
        clientName: "Northwind Heating",
        clientDomain: "northwind.example",
      }),
      context: ctx,
    })) as { error?: string };

    expect(res.error).toMatch(/at least one service/i);
  });

  it("rejects a bad domain before creating any workspace", async () => {
    const res = (await call(onboarding.action as never, {
      request: formReq({ ...SETUP_FIELDS, clientDomain: "not a domain" }),
      context: ctx,
    })) as { error?: string };

    expect(res.error).toMatch(/website address/i);
    expect(await getWorkspaceForUser(scope.db, "u_new")).toBeNull();
  });
});

describe("onboarding stage two: the agency confirms", () => {
  it("makes a blocked read a save-context state with no normal Analyze CTA", () => {
    const html = renderConfirmMarkup({
      stage: "confirm",
      hasWorkspace: true,
      needsAgencySetup: false,
      workspaceName: "Axiom Web",
      client: {
        id: "client-velvet",
        name: "Velvet Nails and Beauty Lounge",
        domain: "velvetnailsandbeautylounge.ca",
        offerings: ["Gel manicures", "Nail extensions"],
      },
      readFailed: false,
      crawl: { readablePages: 0, fetchedPages: 0 },
      crawlFailure: {
        code: "robots",
        stage: "robots",
        title: "The site's crawler instructions limited the read",
        detail: "Robots.txt prevented Orbit from reaching the pages needed to check services.",
        retryable: false,
      },
      suggestions: [],
      coverage: {
        analyzable: false,
        reason: "Insufficient service coverage.",
        limitation: "coverage-limited",
      },
      // Nothing was readable, so every rule is limited by the crawl and the
      // run is refused — by readiness, which is now the only admission voice.
      readiness: {
        state: "site_coverage_limited",
        catalog: { matched: 3, total: 3, unmatchedLabels: [] },
        readyCount: 0,
        total: 3,
        rules: [
          {
            ruleId: "missing-service-page",
            label: "A missing service page",
            state: "site_coverage_limited",
            reason: "The last run could not read any page on this site.",
            actionable: false,
          },
        ],
      },
    });

    expect(html).toMatch(/We couldn(?:&#x27;|&apos;|')t read Velvet Nails and Beauty Lounge yet/);
    expect(html).toContain("Know what they offer?");
    expect(html).toContain("Save client");
    expect(html).toContain("Try reading it again");
    expect(html).toContain('name="intent" value="save"');
    expect(html).not.toContain("Analyze Velvet Nails and Beauty Lounge");
    expect(html).not.toMatch(/at least 2 to confirm/i);
  });

  it("keeps the normal Analyze flow for readable, sufficiently covered evidence", () => {
    const html = renderConfirmMarkup({
      stage: "confirm",
      hasWorkspace: true,
      needsAgencySetup: false,
      workspaceName: "Axiom Web",
      client: {
        id: "client-velvet",
        name: "Velvet Nails and Beauty Lounge",
        domain: "velvetnailsandbeautylounge.ca",
        offerings: [],
      },
      readFailed: false,
      crawl: { readablePages: 5, fetchedPages: 6 },
      crawlFailure: null,
      suggestions: [
        {
          label: "Gel manicures",
          confidence: "high",
          evidence: [{ detail: "Found in the services navigation." }],
        },
      ],
      coverage: {
        analyzable: true,
        reason: "Service coverage confirmed.",
        limitation: null,
      },
      readiness: {
        state: "ready",
        catalog: { matched: 3, total: 3, unmatchedLabels: [] },
        readyCount: 3,
        total: 3,
        rules: [],
      },
    });

    expect(html).toContain("What Velvet Nails and Beauty Lounge sells");
    expect(html).toContain("Analyze Velvet Nails and Beauty Lounge");
    expect(html).toContain('name="intent" value="analyze"');
    expect(html).toContain("Gel manicures");
    expect(html).not.toContain("Save client");
  });

  async function reachStageTwo() {
    vi.stubGlobal("fetch", siteFetch());
    const res = await runSetup();
    const clientId = new URL(res.headers.get("location")!, "http://localhost").searchParams.get(
      "client",
    )!;
    return { t: await workspaceScope(), clientId };
  }

  it("offers what the crawl found, with its provenance, and saves none of it yet", async () => {
    const { t, clientId } = await reachStageTwo();

    const data = (await call(onboarding.loader as never, {
      request: new Request("http://localhost/onboarding?client=" + clientId),
      context: ctx,
    })) as {
      stage: string;
      crawl: { readablePages: number } | null;
      suggestions: Array<{ label: string; evidence: unknown[] }>;
    };

    expect(data.stage).toBe("confirm");
    expect(data.crawl!.readablePages).toBeGreaterThan(0);
    expect(data.suggestions.length).toBeGreaterThan(0);
    // A suggestion with no provenance is something the agency has to verify
    // from scratch anyway, so there is no unattributed line in this list.
    for (const suggestion of data.suggestions) {
      expect(suggestion.evidence.length).toBeGreaterThan(0);
    }

    // Reading stage two changes nothing. Only the confirm post writes.
    expect((await repo.getClient(t, clientId))!.offerings).toEqual([]);
  });

  it("saves only the boxes left checked, and merges what was typed", async () => {
    const { t, clientId } = await reachStageTwo();

    const res = (await call(onboarding.action as never, {
      request: formReq({
        intent: "analyze",
        clientId,
        // One suggestion kept, one dropped — the dropped one must not appear.
        offering: ["Heat Pump Installation"],
        moreOfferings: "boiler servicing\nHEAT PUMP INSTALLATION\n",
      }),
      context: ctx,
    })) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/opportunities?client=" + clientId);

    const client = await repo.getClient(t, clientId);
    // Deduped case-insensitively, keeping the spelling the agency confirmed.
    expect(client!.offerings).toEqual(["Heat Pump Installation", "boiler servicing"]);
    expect(client!.offerings).not.toContain("Boiler Repair");

    // Now, and only now, is a run recorded.
    expect(await repo.getLatestAnalysisRun(t, clientId)).not.toBeNull();
  });

  it("keeps offerings confirmed before a limit rejection visible on reload", async () => {
    const { t, clientId } = await reachStageTwo();
    await reserveAnalysisStart(t, clientId, { now: new Date() });

    const result = (await call(onboarding.action as never, {
      request: formReq({
        intent: "analyze",
        clientId,
        offering: ["Heat Pump Installation"],
        moreOfferings: "boiler servicing",
      }),
      context: ctx,
    })) as { error?: string; limitation?: { code: string } };

    expect(result.limitation?.code).toBe("client-cooldown");
    expect((await repo.getClient(t, clientId))?.offerings).toEqual([
      "Heat Pump Installation",
      "boiler servicing",
    ]);

    const data = (await call(onboarding.loader as never, {
      request: new Request("http://localhost/onboarding?client=" + clientId),
      context: ctx,
    })) as {
      client: { offerings: string[] };
      suggestions: Array<{ label: string }>;
    };
    expect(data.client.offerings).toEqual(["Heat Pump Installation", "boiler servicing"]);
    expect(data.suggestions.map((suggestion) => suggestion.label)).not.toContain(
      "Heat Pump Installation",
    );
  });

  it("will not re-enter onboarding for a client that has been analyzed", async () => {
    const { clientId } = await reachStageTwo();
    await call(onboarding.action as never, {
      request: formReq({
        intent: "analyze",
        clientId,
        offering: ["Heat Pump Installation", "Boiler Repair"],
      }),
      context: ctx,
    });

    const res = (await call(onboarding.loader as never, {
      request: new Request("http://localhost/onboarding?client=" + clientId),
      context: ctx,
    })) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/opportunities?client=" + clientId);
  });

  it("saves blocked client context but rejects a crafted Analyze post", async () => {
    const { t, clientId } = await reachStageTwo();
    const current = await repo.getLatestEvidence(t, clientId);
    expect(current).not.toBeNull();

    await repo.saveEvidence(
      t,
      EvidenceBundleSchema.parse({
        ...current,
        capturedAt: "2099-01-01T00:00:02.000Z",
        site: {
          ...current!.site,
          pages: [],
          links: [],
          nav: [],
          sitemapUrls: [],
          crawlExhaustive: false,
        },
        networkEvents: [
          {
            url: "https://northwind.example/",
            outcome: "inconclusive",
            reason: "request timeout",
            code: "timeout",
            stage: "page",
          },
        ],
      }),
    );

    const saved = (await call(onboarding.action as never, {
      request: formReq({
        intent: "save",
        clientId,
        offering: ["Heat Pump Installation"],
      }),
      context: ctx,
    })) as Response;

    expect(saved.status).toBe(302);
    expect(saved.headers.get("location")).toBe("/clients/" + clientId);
    expect((await repo.getClient(t, clientId))?.offerings).toEqual(["Heat Pump Installation"]);
    expect(await repo.getLatestAnalysisRun(t, clientId)).toBeNull();

    const crafted = (await call(onboarding.action as never, {
      request: formReq({
        intent: "analyze",
        clientId,
        offering: ["Heat Pump Installation", "Boiler Repair"],
      }),
      context: ctx,
    })) as { error?: string };

    // The crafted post is still refused, but for the true reason: this crawl
    // read nothing, so no check of any kind has evidence to work from.
    expect(crafted.error).toMatch(/could not read any page on this site/i);
    expect((await repo.getClient(t, clientId))?.offerings).toEqual([
      "Heat Pump Installation",
      "Boiler Repair",
    ]);
    expect(await repo.getLatestAnalysisRun(t, clientId)).toBeNull();
  });

  it("re-reads the site on request without recording a run", async () => {
    const { t, clientId } = await reachStageTwo();

    const res = (await call(onboarding.action as never, {
      request: formReq({ intent: "reread", clientId }),
      context: ctx,
    })) as Response;

    expect(res.headers.get("location")).toBe("/onboarding?client=" + clientId);
    expect(await repo.getLatestAnalysisRun(t, clientId)).toBeNull();
  });

  it("returns a blocked client to the normal Analyze flow after a successful retry", async () => {
    const { t, clientId } = await reachStageTwo();
    const current = await repo.getLatestEvidence(t, clientId);
    expect(current).not.toBeNull();

    await repo.saveEvidence(
      t,
      EvidenceBundleSchema.parse({
        ...current,
        capturedAt: "2020-01-01T00:00:03.000Z",
        site: {
          ...current!.site,
          pages: [],
          links: [],
          nav: [],
          sitemapUrls: [],
          crawlExhaustive: false,
        },
        networkEvents: [
          {
            url: "https://northwind.example/",
            outcome: "inconclusive",
            reason: "request timeout",
            code: "timeout",
            stage: "page",
          },
        ],
      }),
    );

    vi.stubGlobal("fetch", siteFetch());
    const retry = (await call(onboarding.action as never, {
      request: formReq({ intent: "reread", clientId }),
      context: ctx,
    })) as Response;
    expect(retry.headers.get("location")).toBe("/onboarding?client=" + clientId);

    const data = (await call(onboarding.loader as never, {
      request: new Request("http://localhost/onboarding?client=" + clientId),
      context: ctx,
    })) as {
      coverage: { analyzable: boolean } | null;
      crawl: { readablePages: number } | null;
    };
    expect(data.coverage?.analyzable).toBe(true);
    expect(data.crawl?.readablePages).toBeGreaterThan(0);
    expect(renderConfirmMarkup(data)).toContain("Analyze Northwind Heating");
  });
});

/**
 * A site Orbit read from end to end, which happens to sell nothing on any page.
 *
 * The audit found this exact site being announced as one Orbit "couldn't read",
 * with analysis refused. Both halves were untrue: the crawl was exhaustive, and
 * no-service-pages is the rule whose whole purpose is to say so out loud.
 */
const THIN_HOME = `<!doctype html><html><head><title>Northwind Heating</title></head><body>
<nav><a href="/about">About</a><a href="/team">Our team</a><a href="/contact">Contact</a></nav>
<h1>Northwind Heating</h1>
<p>${"A family business that has looked after this town for thirty years. ".repeat(30)}</p>
</body></html>`;

function plainPage(title: string) {
  return `<!doctype html><html><head><title>${title}</title></head><body>
<h1>${title}</h1><p>${`Some words about ${title.toLowerCase()} and nothing else. `.repeat(30)}</p>
</body></html>`;
}

/** Four readable pages, every link followed, nothing refused. No services. */
function thinSiteFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) {
      return new Response("", { status: 200, headers: { "content-type": "text/plain" } });
    }
    if (url.endsWith("/sitemap.xml")) return new Response("", { status: 404 });
    const html = url.includes("/about")
      ? plainPage("About")
      : url.includes("/team")
        ? plainPage("Our team")
        : url.includes("/contact")
          ? plainPage("Contact")
          : THIN_HOME;
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
}

describe("onboarding admits a site it read in full", () => {
  async function reachStageTwoOnAThinSite() {
    vi.stubGlobal("fetch", thinSiteFetch());
    const res = await runSetup();
    const clientId = new URL(res.headers.get("location")!, "http://localhost").searchParams.get(
      "client",
    )!;
    return { t: await workspaceScope(), clientId };
  }

  it("says the site was read rather than unreadable, and keeps Analyze offered", async () => {
    const { t, clientId } = await reachStageTwoOnAThinSite();

    const evidence = await repo.getLatestEvidence(t, clientId);
    expect(evidence!.site.crawlExhaustive).toBe(true);
    expect(
      evidence!.site.pages.filter((page) => page.status === 200 && page.wordCount > 0).length,
    ).toBeGreaterThanOrEqual(3);

    const data = await call(onboarding.loader as never, {
      request: new Request("http://localhost/onboarding?client=" + clientId),
      context: ctx,
    });
    const html = renderConfirmMarkup(data);

    expect(html).toContain("Axiom Orbit read");
    expect(html).not.toMatch(/We couldn(?:&#x27;|&apos;|')t read Northwind Heating yet/);
    expect(html).toContain('name="intent" value="analyze"');
  });

  it("runs the first analysis instead of refusing it before it starts", async () => {
    const { t, clientId } = await reachStageTwoOnAThinSite();

    const result = await call(onboarding.action as never, {
      request: formReq({
        intent: "analyze",
        clientId,
        offering: ["Boiler repair", "Heat pump installation"],
      }),
      context: ctx,
    });

    // Whatever the run concludes, it must not be refused up-front any more.
    if (!(result instanceof Response)) {
      expect((result as { error?: string }).error ?? "").not.toMatch(
        /cannot check this site for missing service pages/i,
      );
    }
    expect(await repo.getLatestAnalysisRun(t, clientId)).not.toBeNull();
  });
});
