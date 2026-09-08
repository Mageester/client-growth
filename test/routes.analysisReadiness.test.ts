import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { SCHEMA_SQL } from "@/db/schema";
import { ClientSchema, EvidenceBundleSchema, ServiceSchema } from "@/core/schema";
import { __setSessionResolver } from "../app/lib/session.server";
import { d1LikeOver } from "./helpers/testAuth";

import { RULE_SERVICE_LINKS } from "@/core/rules/registry";
import * as clientDetail from "../app/routes/clients.$id";

/**
 * Readiness is shown BEFORE a run, not explained afterwards.
 *
 * The failure this guards against is a brand-new workspace pressing "Analyze
 * site" with a catalog that cannot match anything, waiting for a crawl, and
 * being told the site is clean. The button is disabled for that, but a form post
 * must not be able to start the run either.
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

function formReq(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

const CLIENT_ID = "client-meridian";

async function addClient(offerings: string[]) {
  await repo.upsertClient(
    scope,
    ClientSchema.parse({
      id: CLIENT_ID,
      name: "Meridian Dental",
      // Not a resolvable host: nothing in this file may reach the network.
      domain: "meridiandental.invalid",
      offerings,
      notes: "",
    }),
  );
}

async function addService(tags: string[]) {
  await repo.upsertService(
    scope,
    ServiceSchema.parse({
      id: "svc-" + (tags[0] ?? "none"),
      name: "A service",
      description: "",
      priceMin: 300,
      priceMax: 1000,
      tags,
      active: true,
    }),
  );
}

const loadClient = () =>
  clientDetail.loader({
    params: { id: CLIENT_ID },
    request: new Request("http://localhost/clients/" + CLIENT_ID),
    context: ctx,
  } as never) as Promise<{
    readiness: {
      state: string;
      rules: Array<{ ruleId: string; label: string; state: string; reason: string; actionable: boolean }>;
      catalog: { matched: number; total: number; unmatchedLabels: string[] };
      readyCount: number;
      total: number;
    };
    suggestions: Array<{ label: string; confidence: string; evidence: Array<{ detail: string }> }>;
  }>;

/** The readiness entry for one rule, by id. */
const ruleOf = (
  readiness: { rules: Array<{ ruleId: string; state: string; reason: string; actionable: boolean }> },
  ruleId: string,
) => readiness.rules.find((r) => r.ruleId === ruleId)!;

const analyze = () =>
  clientDetail.action({
    params: { id: CLIENT_ID },
    request: formReq({ intent: "analyze" }),
    context: ctx,
  } as never) as Promise<{ ok: boolean; error?: string }>;

function renderClientMarkup(loaderData: unknown) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: createElement(clientDetail.default, {
          loaderData,
          actionData: undefined,
        } as never),
      },
    ],
    { initialEntries: ["/clients/" + CLIENT_ID] },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

beforeEach(async () => {
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  raw.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  raw.exec(SCHEMA_SQL);
  const db = sqlDbOver(raw) as never;
  await createWorkspaceForOwner(db, { id: "ws_a", name: "A", ownerUserId: "u_a" });
  scope = { db, workspaceId: "ws_a" };
  __setSessionResolver(async () => ({
    userId: "u_a",
    user: { id: "u_a", email: "a@x.example", name: "A" },
  }));
  ctx = {
    cloudflare: {
      env: {
        DB: d1LikeOver(raw),
        BETTER_AUTH_SECRET: "x".repeat(40),
        BETTER_AUTH_URL: "http://localhost:8787",
        AI_PROVIDER: "mock",
      },
    },
  };
});

afterEach(() => {
  __setSessionResolver(null);
  vi.unstubAllGlobals();
  raw.close();
});

describe("pre-analysis readiness", () => {
  it("refuses the Opportunities analyze action before crawl or cooldown when the catalog cannot produce a finding", async () => {
    await addClient(["hair extensions", "balayage"]);
    const fetchSpy = vi.fn(async () => {
      throw new Error("network must not be reached");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const opportunities = await import("../app/routes/opportunities._index");
    const result = (await opportunities.action({
      request: formReq({ clientId: CLIENT_ID }),
      context: ctx,
    } as never)) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no active service is offered/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await repo.listAnalysisRuns(scope, CLIENT_ID, 5)).toHaveLength(0);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM analysis_limit_reservations").get()).toEqual({ count: 0 });
  });

  it("refuses to start a run when no service is offered for any gap", async () => {
    await addClient(["dental implants", "invisalign"]);

    const result = await analyze();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no active service is offered/i);
    // Nothing was crawled and nothing was recorded, so the client page cannot
    // later present this as a run that happened.
    expect(await repo.listAnalysisRuns(scope, CLIENT_ID, 5)).toHaveLength(0);
  });

  it("refuses when the only service answers no kind of gap", async () => {
    await addClient(["dental implants", "invisalign"]);
    await addService(["seo", "retainer"]);

    const result = await analyze();

    expect(result.ok).toBe(false);
    expect(await repo.listAnalysisRuns(scope, CLIENT_ID, 5)).toHaveLength(0);
  });

  it("refuses when the only matching service has been deactivated", async () => {
    await addClient(["dental implants", "invisalign"]);
    await addService(["landing-page"]);
    await repo.setServiceActive(scope, "svc-landing-page", false);

    const result = await analyze();

    expect(result.ok).toBe(false);
    expect(await repo.listAnalysisRuns(scope, CLIENT_ID, 5)).toHaveLength(0);
  });

  it("tells the client page nothing can be checked yet", async () => {
    await addClient(["dental implants", "invisalign"]);

    const { readiness } = await loadClient();

    expect(readiness.catalog.matched).toBe(0);
    expect(readiness.total).toBe(RULE_SERVICE_LINKS.length);
    expect(readiness.catalog.unmatchedLabels).toEqual(RULE_SERVICE_LINKS.map((l) => l.label));
    expect(readiness.readyCount).toBe(0);
    expect(readiness.rules.every((r) => r.state === "not_ready")).toBe(true);
  });

  it("reports a partly-set-up catalog so the skipped rule is visible", async () => {
    await addClient(["dental implants", "invisalign"]);
    await addService(["landing-page"]);

    const { readiness } = await loadClient();

    expect(readiness.catalog.matched).toBe(1);
    expect(readiness.catalog.unmatchedLabels).toEqual(
      RULE_SERVICE_LINKS.filter((l) => l.tag !== "landing-page").map((l) => l.label),
    );
    expect(ruleOf(readiness, "broken-conversion-path").state).toBe("not_ready");
  });

  it("reports a thin client so the likely inconclusive run is warned about first", async () => {
    await addClient(["dental implants"]);
    for (const link of RULE_SERVICE_LINKS) await addService([link.tag]);

    const { readiness } = await loadClient();

    expect(readiness.catalog.matched).toBe(RULE_SERVICE_LINKS.length);
    expect(readiness.catalog.unmatchedLabels).toEqual([]);

    // One offering: missing-service-page will almost never be able to prove the
    // crawl reached the service section, so the page says so before the run.
    const missingPage = ruleOf(readiness, "missing-service-page");
    expect(missingPage.state).toBe("needs_client_setup");
    expect(missingPage.actionable).toBe(true);

    // Per-rule semantics: a thin offerings list has nothing to do with whether
    // a call-to-action is broken, and must not be reported as though it does.
    expect(ruleOf(readiness, "broken-conversion-path").state).toBe("ready");
    expect(readiness.state).toBe("ready");
  });

  it("disables the normal Analyze CTA when stored website coverage is blocked", async () => {
    await addClient(["gel manicures", "nail extensions"]);
    await addService(["landing-page"]);
    await repo.saveEvidence(
      scope,
      EvidenceBundleSchema.parse({
        clientId: CLIENT_ID,
        source: "http",
        capturedAt: "2026-09-07T00:00:00.000Z",
        site: {
          pages: [],
          nav: [],
          links: [],
          sitemapUrls: [],
          crawlExhaustive: false,
        },
        networkEvents: [
          {
            url: "https://meridiandental.invalid/",
            outcome: "inconclusive",
            reason: "robots.txt prevented the read",
            code: "robots",
            stage: "robots",
          },
        ],
      }),
    );

    const data = await clientDetail.loader({
      params: { id: CLIENT_ID },
      request: new Request("http://localhost/clients/" + CLIENT_ID),
      context: ctx,
    } as never);
    const html = renderClientMarkup(data);

    expect(html).toContain("Know what they offer?");
    expect(html).toContain("Try reading it again");
    expect(html).toContain("The site has not provided enough readable evidence for analysis yet");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Analyze site/s);
  });

  it("refuses a crafted detail Analyze post when manual offerings cannot fix coverage", async () => {
    await addClient(["gel manicures", "nail extensions"]);
    await addService(["landing-page"]);
    await repo.saveEvidence(
      scope,
      EvidenceBundleSchema.parse({
        clientId: CLIENT_ID,
        source: "http",
        capturedAt: "2026-09-07T00:00:01.000Z",
        site: { pages: [], nav: [], links: [], sitemapUrls: [], crawlExhaustive: false },
        networkEvents: [
          {
            url: "https://meridiandental.invalid/",
            outcome: "inconclusive",
            reason: "request timeout",
            code: "timeout",
            stage: "page",
          },
        ],
      }),
    );

    const result = await analyze();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cannot check this site for missing service pages/i);
    expect(await repo.listAnalysisRuns(scope, CLIENT_ID, 5)).toHaveLength(0);
  });

  it("has nothing to warn about once the workspace is properly set up", async () => {
    await addClient(["dental implants", "invisalign", "teeth whitening"]);
    for (const link of RULE_SERVICE_LINKS) await addService([link.tag]);

    const { readiness } = await loadClient();

    expect(readiness.catalog.matched).toBe(readiness.total);
    expect(readiness.catalog.unmatchedLabels).toEqual([]);
    expect(readiness.readyCount).toBe(readiness.total);
    expect(readiness.state).toBe("ready");
  });
});
