import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as repo from "@/db/repositories";
import * as monitoringRepo from "@/db/monitoring";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { SCHEMA_SQL } from "@/db/schema";
import { ClientSchema, EvidenceBundleSchema, ServiceSchema } from "@/core/schema";
import { __setSessionResolver } from "../app/lib/session.server";
import { d1LikeOver } from "./helpers/testAuth";

import * as clientDetail from "../app/routes/clients.$id";

/**
 * The first-value path: a client that cannot be analyzed because Axiom Orbit
 * was told about one of the six things the business sells.
 *
 * The rule this file exists to enforce is that suggestions are NEVER applied
 * without a person. Everything else here — the evidence, the readiness copy —
 * is in service of making that confirmation a good decision rather than a
 * blind one.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const CLIENT_ID = "client-northshore";

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

function formReq(fields: Array<[string, string]>) {
  const body = new URLSearchParams();
  for (const [k, v] of fields) body.append(k, v);
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

/** A crawl that read a real services section but only one recorded offering. */
async function saveEvidenceWithServices() {
  await repo.saveEvidence(
    scope,
    EvidenceBundleSchema.parse({
      clientId: CLIENT_ID,
      source: "http",
      capturedAt: "2026-09-02T00:00:00.000Z",
      site: {
        pages: [
          { url: "https://northshore.invalid/", status: 200, title: "Home", h1s: [], headings: [], textExcerpt: "", wordCount: 300, forms: [] },
          {
            url: "https://northshore.invalid/services/gutter-cleaning",
            status: 200,
            title: "Gutter Cleaning",
            h1s: ["Gutter Cleaning"],
            headings: [],
            textExcerpt: "",
            wordCount: 300,
            forms: [],
          },
        ],
        nav: ["Services", "Gutter Cleaning", "Fully Insured", "Free Quotes"],
        links: [
          {
            href: "https://northshore.invalid/services/gutter-cleaning",
            label: "Gutter Cleaning",
            inNav: true,
            scheme: "http",
            foundOn: ["https://northshore.invalid/"],
          },
          {
            href: "https://northshore.invalid/services/roof-repair",
            label: "Roof Repair",
            inNav: true,
            scheme: "http",
            foundOn: ["https://northshore.invalid/"],
          },
          {
            href: "https://northshore.invalid/services/fully-insured",
            label: "Fully Insured",
            inNav: true,
            scheme: "http",
            foundOn: ["https://northshore.invalid/"],
          },
        ],
        sitemapUrls: [],
      },
      networkEvents: [],
    }),
  );
}

const loadClient = () =>
  clientDetail.loader({
    params: { id: CLIENT_ID },
    request: new Request("http://localhost/clients/" + CLIENT_ID),
    context: ctx,
  } as never) as Promise<{
    suggestions: Array<{ label: string; confidence: string; evidence: Array<{ detail: string; url?: string }> }>;
    readiness: { rules: Array<{ ruleId: string; state: string; reason: string; actionable: boolean }> };
  }>;

/** Whether the client page is offering to read the site for suggestions. */
const promptsToReadSite = async () => {
  const data = (await loadClient()) as unknown as {
    hasEvidence: boolean;
    suggestions: unknown[];
  };
  return data.hasEvidence === false && data.suggestions.length === 0;
};

const accept = (offerings: string[]) =>
  clientDetail.action({
    params: { id: CLIENT_ID },
    request: formReq([
      ["intent", "accept-suggestions"],
      ...offerings.map((o) => ["offering", o] as [string, string]),
    ]),
    context: ctx,
  } as never) as Promise<{ ok: boolean; message?: string; error?: string }>;

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

  await repo.upsertClient(
    scope,
    ClientSchema.parse({
      id: CLIENT_ID,
      name: "North Shore Exteriors",
      // Not a resolvable host: nothing in this file may reach the network.
      domain: "northshore.invalid",
      offerings: ["Gutter cleaning"],
      notes: "",
    }),
  );
  for (const tag of ["landing-page", "conversion-fix"]) {
    await repo.upsertService(
      scope,
      ServiceSchema.parse({
        id: `svc-${tag}`,
        name: tag,
        description: "",
        priceMin: 500,
        priceMax: 1500,
        tags: [tag],
        active: true,
      }),
    );
  }
});

afterEach(() => {
  __setSessionResolver(null);
  raw.close();
});

describe("suggested services", () => {
  it("suggests nothing before the client has ever been crawled", async () => {
    const { suggestions } = await loadClient();
    expect(suggestions).toEqual([]);
  });

  it("proposes services found on the site, with evidence, and excludes trust claims", async () => {
    await saveEvidenceWithServices();

    const { suggestions } = await loadClient();
    const labels = suggestions.map((s) => s.label);

    expect(labels).toContain("Roof Repair");
    // Already recorded, so not proposed again.
    expect(labels).not.toContain("Gutter Cleaning");
    // A claim about the business, not work anyone buys.
    expect(labels).not.toContain("Fully Insured");

    for (const suggestion of suggestions) {
      expect(suggestion.evidence.length).toBeGreaterThan(0);
    }
  });

  it("changes nothing until a person confirms", async () => {
    await saveEvidenceWithServices();

    // Loading the page is not consent. Reading suggestions must not write.
    await loadClient();

    expect((await repo.getClient(scope, CLIENT_ID))!.offerings).toEqual(["Gutter cleaning"]);
  });

  it("appends confirmed services and never rewrites what was already there", async () => {
    await saveEvidenceWithServices();

    const result = await accept(["Roof Repair", "Soffit and Fascia"]);

    expect(result.ok).toBe(true);
    const client = await repo.getClient(scope, CLIENT_ID);
    expect(client!.offerings).toEqual(["Gutter cleaning", "Roof Repair", "Soffit and Fascia"]);
  });

  it("does not duplicate an offering the client already has", async () => {
    await saveEvidenceWithServices();

    await accept(["gutter cleaning", "Roof Repair"]);

    const client = await repo.getClient(scope, CLIENT_ID);
    expect(client!.offerings).toEqual(["Gutter cleaning", "Roof Repair"]);
  });

  it("refuses an empty confirmation rather than saving a no-op", async () => {
    const result = await accept([]);
    expect(result.ok).toBe(false);
  });

  it("leaves monitoring, history and opportunities untouched", async () => {
    await saveEvidenceWithServices();
    await monitoringRepo.setMonitoringCadence(scope, CLIENT_ID, "weekly", {
      lastAnalyzedAt: "2026-09-01T00:00:00.000Z",
    });
    const before = await monitoringRepo.getMonitoring(scope, CLIENT_ID);
    await repo.recordAnalysisRun(scope, {
      clientId: CLIENT_ID,
      startedAt: "2026-09-01T00:00:00.000Z",
      finishedAt: "2026-09-01T00:01:00.000Z",
      source: "http",
      outcome: "inconclusive",
      summary: "The crawl never reached this site's service pages.",
      limitation: "Insufficient service coverage.",
      pagesRead: 2,
      pagesFetched: 2,
      blockedEvents: 0,
      inconclusiveEvents: 0,
      surfaced: 0,
      stats: {},
      trigger: "scheduled",
      newCount: 0,
      resolvedCount: 0,
      evaluatorCalls: 0,
      evaluatorRejections: 0,
      evaluatorErrors: 0,
    });

    await accept(["Roof Repair"]);

    // Confirming setup is not a reset. The client keeps its id, its schedule,
    // and every inconclusive run it has already recorded.
    const after = await monitoringRepo.getMonitoring(scope, CLIENT_ID);
    expect(after?.cadence).toBe("weekly");
    expect(after?.nextDueAt).toBe(before?.nextDueAt);

    const runs = await repo.listAnalysisRuns(scope, CLIENT_ID, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.outcome).toBe("inconclusive");
  });
});

describe("readiness copy tells setup apart from crawler limits", () => {
  it("points at the offerings list when the site was read and the profile is thin", async () => {
    await saveEvidenceWithServices();

    const { readiness } = await loadClient();
    const missingPage = readiness.rules.find((r) => r.ruleId === "missing-service-page")!;

    expect(missingPage.actionable).toBe(true);
    expect(missingPage.state).not.toBe("site_coverage_limited");
  });

  it("blames the crawler, not the agency, when nothing could be read", async () => {
    await repo.saveEvidence(
      scope,
      EvidenceBundleSchema.parse({
        clientId: CLIENT_ID,
        source: "http",
        capturedAt: "2026-09-02T00:00:00.000Z",
        site: {
          pages: [
            { url: "https://northshore.invalid/", status: 403, title: "", h1s: [], headings: [], textExcerpt: "", wordCount: 0, forms: [] },
          ],
          nav: [],
          links: [],
          sitemapUrls: [],
        },
        networkEvents: [],
      }),
    );

    const { readiness, suggestions } = await loadClient();
    const missingPage = readiness.rules.find((r) => r.ruleId === "missing-service-page")!;

    expect(missingPage.state).toBe("site_coverage_limited");
    expect(missingPage.actionable).toBe(false);
    // Nothing was readable, so there is nothing honest to suggest.
    expect(suggestions).toEqual([]);
  });
});

/**
 * Reading the site to fill the offerings list.
 *
 * Suggestions come from the last crawl, so before one exists a new client gets
 * no help with the very list every analysis is compared against. Four of six
 * real production clients were recorded with one offering or none, which made
 * every run against them inconclusive before it started.
 */
describe("reading the site for offerings", () => {
  it("offers to read the site for a client with nothing recorded", async () => {
    expect(await promptsToReadSite()).toBe(true);
  });

  it("does not offer once evidence already exists", async () => {
    await saveEvidenceWithServices();
    expect(await promptsToReadSite()).toBe(false);
  });

  it("reports the client's offerings as unchanged by reading alone", async () => {
    await saveEvidenceWithServices();

    // Evidence exists and suggestions are computed, but a crawl is not consent.
    const before = (await repo.getClient(scope, CLIENT_ID))!.offerings;
    await loadClient();

    expect((await repo.getClient(scope, CLIENT_ID))!.offerings).toEqual(before);
  });
});
