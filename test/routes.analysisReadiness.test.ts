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
    // The refusal names the crawler as the limit, because it is: robots.txt
    // refused the read, and no amount of client setup changes that.
    expect(html).toContain("could not read any page on this site");
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
    // Nothing was read at all, so the refusal says that rather than blaming the
    // client's offerings list for a limit the agency cannot act on.
    expect(result.error).toMatch(/could not read any page on this site/i);
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

/**
 * Admission is per rule, and this is the block that proves it.
 *
 * The audit reproduced a site Orbit had read in full — every link followed,
 * nothing blocked, nothing unread — being refused analysis and described to
 * the agency as unreadable. Two untruths at once: the site WAS read, and the
 * one rule whose entire purpose is "this whole site sells nothing on any page"
 * was the rule being denied the chance to say so.
 *
 * The rule that replaces it: a run is admitted when at least one catalog-backed
 * rule is ready. A limited rule suppresses itself and nothing else. Evidence
 * that cannot support an absence claim still cannot make one — that is the
 * pipeline's job, and the negative cases below hold it to it.
 */

/** Every rule has a service, so admission turns only on the site evidence. */
async function fullCatalog() {
  for (const link of RULE_SERVICE_LINKS) await addService([link.tag]);
}

/**
 * A site read to exhaustion that describes no services anywhere: four readable
 * pages, every link followed, nothing refused. This is the strongest evidence
 * the crawler ever holds, and the audit found it being called unreadable.
 */
async function saveExhaustiveNoServicePages() {
  await repo.saveEvidence(
    scope,
    EvidenceBundleSchema.parse({
      clientId: CLIENT_ID,
      source: "http",
      capturedAt: "2026-09-08T00:00:00.000Z",
      site: {
        pages: [
          {
            url: "https://meridiandental.invalid/",
            status: 200,
            title: "Meridian Dental",
            h1s: ["Meridian Dental"],
            headings: ["Welcome"],
            wordCount: 210,
          },
          {
            url: "https://meridiandental.invalid/about",
            status: 200,
            title: "About us",
            h1s: ["About us"],
            headings: ["Our story"],
            wordCount: 180,
          },
          {
            url: "https://meridiandental.invalid/team",
            status: 200,
            title: "The team",
            h1s: ["The team"],
            headings: [],
            wordCount: 160,
          },
          {
            url: "https://meridiandental.invalid/contact",
            status: 200,
            title: "Contact",
            h1s: ["Contact"],
            headings: [],
            wordCount: 140,
          },
        ],
        nav: ["About us", "The team", "Contact"],
        links: [
          {
            href: "https://meridiandental.invalid/about",
            label: "About us",
            scheme: "http",
            inNav: true,
          },
          {
            href: "https://meridiandental.invalid/team",
            label: "The team",
            scheme: "http",
            inNav: true,
          },
          {
            href: "https://meridiandental.invalid/contact",
            label: "Contact",
            scheme: "http",
            inNav: true,
          },
        ],
        sitemapUrls: [],
        crawlExhaustive: true,
      },
      networkEvents: [],
    }),
  );
}

/** Pages came back, but every one of them was an empty JavaScript shell. */
async function saveJsShellEvidence() {
  await repo.saveEvidence(
    scope,
    EvidenceBundleSchema.parse({
      clientId: CLIENT_ID,
      source: "http",
      capturedAt: "2026-09-08T00:00:01.000Z",
      site: {
        pages: [
          {
            url: "https://meridiandental.invalid/",
            status: 200,
            title: "",
            h1s: [],
            headings: [],
            wordCount: 0,
          },
        ],
        nav: [],
        links: [],
        sitemapUrls: [],
        crawlExhaustive: true,
      },
      networkEvents: [
        {
          url: "https://meridiandental.invalid/",
          outcome: "inconclusive",
          reason: "the page rendered no text without JavaScript",
          code: "js-shell",
          stage: "page",
        },
      ],
    }),
  );
}

/** A partial read: real pages, but the crawl never reached a service section. */
async function savePartialRead() {
  await repo.saveEvidence(
    scope,
    EvidenceBundleSchema.parse({
      clientId: CLIENT_ID,
      source: "http",
      capturedAt: "2026-09-08T00:00:02.000Z",
      site: {
        pages: [
          {
            url: "https://meridiandental.invalid/",
            status: 200,
            title: "Meridian Dental",
            h1s: ["Meridian Dental"],
            headings: [],
            wordCount: 220,
          },
        ],
        nav: [],
        links: [],
        sitemapUrls: [],
        // Budget ran out before the links did: this is a fact about the crawl.
        crawlExhaustive: false,
      },
      networkEvents: [
        {
          url: "https://meridiandental.invalid/services",
          outcome: "inconclusive",
          reason: "request budget exhausted",
          code: "request-budget",
          stage: "page",
        },
      ],
    }),
  );
}

/** Serves nothing: no test in this block may reach the network. */
const forbiddenFetch = () =>
  vi.fn(async () => {
    throw new Error("network must not be reached");
  }) as unknown as typeof fetch;

describe("analysis admission follows per-rule readiness", () => {
  it("builds one readiness result from the stored client, catalog and evidence", async () => {
    await addClient(["dental implants", "invisalign"]);
    await fullCatalog();
    await saveExhaustiveNoServicePages();

    const { analysisReadinessForClient } = await import("../app/lib/analysis-readiness.server");
    const client = (await repo.getClient(scope, CLIENT_ID))!;
    const readiness = analysisReadinessForClient({
      client,
      catalog: await repo.listServices(scope),
      evidence: await repo.getLatestEvidence(scope, CLIENT_ID),
    });

    // The site was read in full and sells nothing on any page — exactly the
    // claim no-service-pages exists to make.
    expect(readiness.readyCount).toBeGreaterThan(0);
    expect(readiness.rules.find((rule) => rule.ruleId === "no-service-pages")?.state).toBe("ready");
    // The missing-page rule stays suppressed: it cannot name a page as missing
    // from a site that describes no services at all.
    expect(readiness.rules.find((rule) => rule.ruleId === "missing-service-page")?.state).toBe(
      "site_coverage_limited",
    );
  });

  it("keeps Analyze available for a site read in full that describes no services", async () => {
    await addClient(["dental implants", "invisalign"]);
    await fullCatalog();
    await saveExhaustiveNoServicePages();

    const data = await loadClient();
    expect(data.readiness.readyCount).toBeGreaterThan(0);

    const html = renderClientMarkup(data);
    expect(html).toContain("Analyze site");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Analyze site/s);
  });

  it("does not refuse the analyze post for readable no-service-pages evidence", async () => {
    await addClient(["dental implants", "invisalign"]);
    await fullCatalog();
    await saveExhaustiveNoServicePages();
    vi.stubGlobal("fetch", forbiddenFetch());

    const result = await analyze();

    // The run may still fail for its own reasons in this offline test; what it
    // must never do again is refuse before starting because one rule is limited.
    expect(result.error ?? "").not.toMatch(/cannot check this site for missing service pages/i);
    expect(result.error ?? "").not.toMatch(/enough of the website can be read/i);
  });

  it("still refuses when the last run could not read a single page", async () => {
    await addClient(["dental implants", "invisalign"]);
    await fullCatalog();
    await repo.saveEvidence(
      scope,
      EvidenceBundleSchema.parse({
        clientId: CLIENT_ID,
        source: "http",
        capturedAt: "2026-09-08T00:00:03.000Z",
        site: { pages: [], nav: [], links: [], sitemapUrls: [], crawlExhaustive: false },
        networkEvents: [
          {
            url: "https://meridiandental.invalid/",
            outcome: "blocked",
            reason: "robots.txt prevented the read",
            code: "robots",
            stage: "robots",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", forbiddenFetch());

    const result = await analyze();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/could not read any page/i);
    expect(await repo.listAnalysisRuns(scope, CLIENT_ID, 5)).toHaveLength(0);
  });

  it("still refuses a JavaScript shell that produced no readable text", async () => {
    await addClient(["dental implants", "invisalign"]);
    await fullCatalog();
    await saveJsShellEvidence();
    vi.stubGlobal("fetch", forbiddenFetch());

    const result = await analyze();

    expect(result.ok).toBe(false);
    expect(await repo.listAnalysisRuns(scope, CLIENT_ID, 5)).toHaveLength(0);
    expect(await repo.listOpportunities(scope, CLIENT_ID)).toHaveLength(0);
  });

  it("admits the independent checks after a partial read without claiming an absence", async () => {
    await addClient(["dental implants", "invisalign"]);
    await fullCatalog();
    await savePartialRead();

    const { analysisReadinessForClient } = await import("../app/lib/analysis-readiness.server");
    const client = (await repo.getClient(scope, CLIENT_ID))!;
    const readiness = analysisReadinessForClient({
      client,
      catalog: await repo.listServices(scope),
      evidence: await repo.getLatestEvidence(scope, CLIENT_ID),
    });

    expect(readiness.readyCount).toBeGreaterThan(0);
    expect(readiness.rules.find((rule) => rule.ruleId === "broken-conversion-path")?.state).toBe(
      "ready",
    );
    // Both absence rules stay closed: a truncated crawl cannot prove a silence.
    expect(readiness.rules.find((rule) => rule.ruleId === "missing-service-page")?.state).toBe(
      "site_coverage_limited",
    );
    expect(readiness.rules.find((rule) => rule.ruleId === "no-service-pages")?.state).toBe(
      "site_coverage_limited",
    );
  });
});
