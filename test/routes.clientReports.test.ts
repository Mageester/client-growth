import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ClientSchema, OpportunitySchema, ServiceSchema, type Opportunity } from "@/core/schema";
import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { saveWorkspaceBranding } from "@/db/proposalShares";
import { SCHEMA_SQL } from "@/db/schema";
import type { RunResult, SqlDb, SqlStatement, SqlValue } from "@/db/sql";
import { __setSessionResolver } from "../app/lib/session.server";
import { d1LikeOver } from "./helpers/testAuth";

import * as reportBuilder from "../app/routes/clients.$id.report";
import * as reportPreview from "../app/routes/reports.$id";
import * as reportShare from "../app/routes/report.share";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const NOW = "2026-09-07T14:00:00.000Z";

let raw: Database.Database;
let db: SqlDb;
let scope: { db: SqlDb; workspaceId: string };
let context: { cloudflare: { env: Record<string, unknown> } };

function sqlDbOver(database: Database.Database): SqlDb {
  const stmt = (sql: string, bound: SqlValue[]): SqlStatement => ({
    bind: (...values: SqlValue[]) => stmt(sql, values),
    all: <T,>() => Promise.resolve(database.prepare(sql).all(...(bound as never[])) as T[]),
    first: <T,>() =>
      Promise.resolve((database.prepare(sql).get(...(bound as never[])) ?? null) as T | null),
    run: (): Promise<RunResult> => {
      const result = database.prepare(sql).run(...(bound as never[]));
      return Promise.resolve({ rowsAffected: Number(result.changes ?? 0) });
    },
  });
  return {
    exec: (sql) => {
      database.exec(sql);
      return Promise.resolve();
    },
    prepare: (sql) => stmt(sql, []),
    batch: async (statements) => {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => {
          const result = database.prepare(statement.sql).run(...((statement.params ?? []) as never[]));
          return { rowsAffected: Number(result.changes ?? 0) };
        });
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function formReq(fields: Record<string, string | string[]>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
  }
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

function call(fn: (args: never) => unknown, args: unknown): Promise<unknown> {
  return Promise.resolve(fn(args as never)).catch((error) => {
    if (error instanceof Response) return error;
    throw error;
  });
}

const client = ClientSchema.parse({
  id: "cli_a",
  name: "Northwind Heating",
  domain: "northwind.example",
  offerings: ["heat pumps", "water heaters"],
  notes: "",
});

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return OpportunitySchema.parse({
    id: "opp_heat",
    dedupeKey: "missing-service-page:heat-pumps",
    clientId: client.id,
    ruleId: "missing-service-page",
    title: "Heat Pump Installation — dedicated service page",
    detected: "The site names heat pumps but has no dedicated page.",
    evidenceRefs: ["page:https://northwind.example/services", "status:200"],
    rationale: "A focused service page gives this offering a clear place to be understood.",
    suggestedServiceId: "svc_page",
    suggestedScope: ["Plan the service page", "Write the service copy"],
    priceMin: 900,
    priceMax: 1800,
    confidence: 0.9,
    billableStatus: "billable",
    status: "new",
    verification: {
      conclusion: "absent",
      inspectedUrls: ["https://northwind.example/services"],
      closeMatches: [],
      reason: "No dedicated page was found.",
    },
    updatedAt: NOW,
    ...overrides,
  });
}

async function fixture() {
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  raw.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  raw.exec(SCHEMA_SQL);
  db = sqlDbOver(raw);
  await createWorkspaceForOwner(db, { id: "ws_a", name: "Axiom North", ownerUserId: "owner_a" });
  raw
    .prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
    )
    .run("ws_a", "member_a", "member", NOW);
  scope = { db, workspaceId: "ws_a" };
  await repo.upsertService(
    scope,
    ServiceSchema.parse({
      id: "svc_page",
      name: "Service landing page",
      description: "",
      priceMin: 900,
      priceMax: 1800,
      tags: ["landing-page"],
      active: true,
    }),
  );
  await repo.upsertClient(scope, client);
  await repo.saveAnalysis(scope, [
    opportunity(),
    opportunity({
      id: "opp_water",
      dedupeKey: "missing-service-page:water-heaters",
      title: "Water Heater Repair — dedicated service page",
      detected: "The site mentions water heaters without a focused service page.",
      priceMin: 1200,
      priceMax: 2400,
    }),
    opportunity({
      id: "opp_title",
      dedupeKey: "missing-title:home",
      ruleId: "missing-title",
      title: "Home page title improvement",
      detected: "The home page is missing a clear title.",
      evidenceRefs: ["page:https://northwind.example/"],
      suggestedScope: ["Review the home page title"],
      priceMin: 150,
      priceMax: 400,
    }),
  ]);
  await repo.recordAnalysisRun(scope, {
    clientId: client.id,
    startedAt: NOW,
    finishedAt: NOW,
    source: "fixture",
    outcome: "findings",
    summary: "Findings are ready for review.",
    limitation: null,
    pagesRead: 3,
    pagesFetched: 3,
    blockedEvents: 0,
    inconclusiveEvents: 0,
    surfaced: 3,
    stats: {},
    trigger: "manual",
    newCount: 3,
    resolvedCount: 0,
    evaluatorCalls: 0,
    evaluatorRejections: 0,
    evaluatorErrors: 0,
  });
  await saveWorkspaceBranding(scope, { logo: null, reportTheme: "editorial" });
  __setSessionResolver(async () => ({
    userId: "owner_a",
    user: { id: "owner_a", email: "owner@axiom.example", name: "Avery Owner" },
  }));
  context = {
    cloudflare: {
      env: {
        DB: d1LikeOver(raw),
        BETTER_AUTH_URL: "https://orbit.example",
        BETTER_AUTH_SECRET: "x".repeat(40),
      },
    },
  };
}

beforeEach(fixture);
afterEach(() => {
  __setSessionResolver(null);
  raw.close();
});

describe("client-facing report routes", () => {
  it("previews deterministic selections, persists a snapshot, and lets the owner create a share", async () => {
    const builder = (await reportBuilder.loader({
      request: new Request("http://localhost/clients/cli_a/report"),
      params: { id: "cli_a" },
      context,
    } as never)) as Awaited<ReturnType<typeof reportBuilder.loader>>;
    expect(builder.candidates.defaultSelectedKeys).toHaveLength(2);
    expect(builder.candidates.health).toHaveLength(1);
    expect(builder.branding.reportTheme).toBe("editorial");

    const commercial = builder.candidates.commercial.map((candidate) => candidate.key);
    const generated = (await call(reportBuilder.action, {
      request: formReq({
        intent: "generate",
        selectedProject: commercial,
        orderedProject: [commercial[1]!, commercial[0]!],
        showUnderlyingValue: "on",
        [`packagePrice:${commercial[1]!}`]: "3100",
        [`confirmPackagePrice:${commercial[1]!}`]: "on",
        agencyNote: "<script>alert('x')</script> Ask about the spring schedule.",
        nextStepNote: "Review the two priorities together.",
      }),
      params: { id: "cli_a" },
      context,
    })) as Response;
    expect(generated.status).toBe(302);
    const reportLocation = generated.headers.get("Location")!;
    expect(reportLocation).toMatch(/^\/reports\/report_/);
    const reportId = reportLocation.split("/").at(-1)!;

    const preview = (await reportPreview.loader({
      request: new Request(`http://localhost${reportLocation}`),
      params: { id: reportId },
      context,
    } as never)) as Awaited<ReturnType<typeof reportPreview.loader>>;
    expect(preview.report.snapshot.public.recommendedProjects[0]?.title).toBe(
      builder.candidates.commercial[1]!.project.title,
    );
    expect(preview.report.snapshot.public.recommendedProjects[0]?.packagePrice).toEqual({
      amount: 3100,
      currency: "USD",
    });
    expect(preview.report.snapshot.public.recommendedProjects[1]?.packagePrice).toBeNull();
    expect(preview.report.snapshot.audit.includedOpportunityIds).toHaveLength(2);

    const created = (await call(reportPreview.action, {
      request: formReq({ intent: "create-share" }),
      params: { id: reportId },
      context,
    })) as { ok: boolean; shareUrl?: string };
    expect(created.ok).toBe(true);
    expect(created.shareUrl).toMatch(/^https:\/\/orbit\.example\/report\/share\?token=/);
  });

  it("keeps report sharing owner-only and serves an escaped, client-safe public snapshot", async () => {
    const builder = (await reportBuilder.loader({
      request: new Request("http://localhost/clients/cli_a/report"),
      params: { id: "cli_a" },
      context,
    } as never)) as Awaited<ReturnType<typeof reportBuilder.loader>>;
    const key = builder.candidates.defaultSelectedKeys[0]!;
    const generated = (await call(reportBuilder.action, {
      request: formReq({
        intent: "generate",
        selectedProject: key,
        orderedProject: key,
        agencyNote: "<script>alert('x')</script>",
      }),
      params: { id: "cli_a" },
      context,
    })) as Response;
    const reportId = generated.headers.get("Location")!.split("/").at(-1)!;

    __setSessionResolver(async () => ({
      userId: "member_a",
      user: { id: "member_a", email: "member@axiom.example", name: "A Member" },
    }));
    const denied = (await call(reportPreview.action, {
      request: formReq({ intent: "create-share" }),
      params: { id: reportId },
      context,
    })) as { ok: boolean; error?: string };
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/owner/i);

    __setSessionResolver(async () => ({
      userId: "owner_a",
      user: { id: "owner_a", email: "owner@axiom.example", name: "Avery Owner" },
    }));
    const created = (await call(reportPreview.action, {
      request: formReq({ intent: "create-share" }),
      params: { id: reportId },
      context,
    })) as { ok: boolean; shareUrl?: string };
    const token = new URL(created.shareUrl!).searchParams.get("token")!;
    const page = (await reportShare.loader({
      request: new Request(`https://orbit.example/report/share?token=${encodeURIComponent(token)}`),
      context,
    } as never)) as Awaited<ReturnType<typeof reportShare.loader>>;
    const html = renderToStaticMarkup(
      createElement(reportShare.default, { loaderData: page } as never),
    );
    expect(html).toContain("Northwind Heating");
    expect(html).toContain('data-report-theme="editorial"');
    expect(html).toContain("&lt;script&gt;alert(&#x27;x&#x27;)&lt;/script&gt;");
    expect(html).not.toContain("opp_heat");
    expect(html).not.toContain("ws_a");
    expect(html).not.toContain("ruleId");
    expect(html).not.toMatch(/DeepSeek|crawler|evaluator|confidence/i);
    expect(html).not.toContain("status:200");
    expect(html).not.toContain("Underlying opportunity value");
    expect(html).toContain("https://northwind.example/services");
    expect(html.match(/client-report-evidence-item/g)?.length).toBe(1);
    expect(JSON.stringify(page)).not.toContain("shareId");
    expect(JSON.stringify(page)).not.toContain("report_");
  });

  it("sets no-store, no-referrer, noindex and a restrictive public CSP", () => {
    const headers = reportShare.headers();
    expect(headers["Cache-Control"]).toContain("no-store");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow");
    expect(headers["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });

  it("has a browser-print document path for both preview and public share", () => {
    const css = readFileSync(new URL("../app/styles/orbit-approved.css", import.meta.url), "utf8");
    expect(css).toMatch(/@media\s+print[\s\S]*\.client-report-cover/);
    expect(css).toMatch(/@media\s+print[\s\S]*\.client-report-project/);
    expect(css).toMatch(/@media\s+print[\s\S]*\.client-report-toolbar/);
    expect(css).toMatch(/page-break-inside:\s*avoid/);
  });
});
