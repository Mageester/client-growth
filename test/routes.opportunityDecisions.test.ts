import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { SCHEMA_SQL } from "@/db/schema";
import { ClientSchema, OpportunitySchema, ServiceSchema, type Opportunity } from "@/core/schema";
import { __setSessionResolver } from "../app/lib/session.server";
import { d1LikeOver } from "./helpers/testAuth";

import * as oppDetail from "../app/routes/opportunities.$id";
import * as oppIndex from "../app/routes/opportunities._index";
import * as clientDetail from "../app/routes/clients.$id";
import * as clientsIndex from "../app/routes/clients._index";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let raw: Database.Database;
let ctx: { cloudflare: { env: Record<string, unknown> } };
let scope: { db: never; workspaceId: string };

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
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
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

function opp(over: Partial<Opportunity> = {}): Opportunity {
  return OpportunitySchema.parse({
    id: "opp_1",
    dedupeKey: "k1",
    clientId: "cli_a",
    ruleId: "missing-service-page",
    title: "No page for heat pumps",
    detected: "detected",
    evidenceRefs: ["https://cli-a.example/services"],
    rationale: "why it matters",
    suggestedServiceId: "svc_a",
    suggestedScope: ["Build the page"],
    priceMin: 900,
    priceMax: 1800,
    confidence: 0.85,
    billableStatus: "billable",
    status: "new",
    updatedAt: "2026-08-31T00:00:00.000Z",
    ...over,
  });
}

beforeEach(async () => {
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  raw.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  raw.exec(SCHEMA_SQL);

  const db = sqlDbOver(raw) as never;
  await createWorkspaceForOwner(db, { id: "ws_a", name: "A", ownerUserId: "u_a" });
  scope = { db, workspaceId: "ws_a" };
  await repo.upsertService(
    scope,
    ServiceSchema.parse({
      id: "svc_a",
      name: "Service Landing Page",
      description: "A page for one service line.",
      priceMin: 900,
      priceMax: 1800,
      tags: ["landing-page"],
      active: true,
    }),
  );
  await repo.upsertClient(
    scope,
    ClientSchema.parse({
      id: "cli_a",
      name: "Client A",
      domain: "cli-a.example",
      offerings: ["heat pumps"],
      notes: "",
    }),
  );

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
  raw.close();
});

const act = (intent: string, extra: Record<string, string> = {}, id = "opp_1") =>
  call(oppDetail.action as never, {
    request: formReq({ intent, ...extra }),
    params: { id },
    context: ctx,
  });

describe("preparing a proposal", () => {
  it("drafts and marks the opportunity ready when it is open", async () => {
    await repo.saveAnalysis(scope, [opp()]);
    const res = (await act("prepare-proposal")) as Response;
    expect(res.status).toBe(302);
    const saved = await repo.getOpportunity(scope, "opp_1");
    expect(saved?.status).toBe("proposal_prepared");
    expect(saved?.proposalMd).toContain("No page for heat pumps");
    expect(saved?.proposalMd).toContain("Client A");
  });

  // "resolved" is set by a re-analysis that confirmed the client fixed the work.
  // Drafting a proposal for it would put a price on work that no longer exists.
  for (const status of ["dismissed", "snoozed", "already_covered", "resolved"] as const) {
    it(`refuses to draft for a ${status} finding and leaves its status alone`, async () => {
      await repo.saveAnalysis(scope, [opp({ status })]);
      const res = (await act("prepare-proposal")) as { error?: string };
      expect(res.error).toMatch(/closed/i);
      const saved = await repo.getOpportunity(scope, "opp_1");
      expect(saved?.status).toBe(status);
      expect(saved?.proposalMd).toBeUndefined();
    });
  }

  it("refuses to draft for work already covered by contract", async () => {
    await repo.saveAnalysis(scope, [opp({ billableStatus: "already_covered" })]);
    const res = (await act("prepare-proposal")) as { error?: string };
    expect(res.error).toMatch(/closed/i);
    expect((await repo.getOpportunity(scope, "opp_1"))?.proposalMd).toBeUndefined();
  });

  it("does not resurrect a dismissed finding even at the repository layer", async () => {
    await repo.saveAnalysis(scope, [opp({ status: "dismissed" })]);
    const applied = await repo.setOpportunityProposal(scope, "opp_1", "# draft");
    expect(applied).toBe(false);
    const saved = await repo.getOpportunity(scope, "opp_1");
    expect(saved?.status).toBe("dismissed");
    expect(saved?.proposalMd).toBeUndefined();
  });

  it("prepares a proposal after a snooze has expired", async () => {
    await repo.saveAnalysis(
      scope,
      [opp({ status: "snoozed", snoozeUntil: "2000-01-01T00:00:00.000Z" })],
    );

    const res = (await act("prepare-proposal")) as Response;

    expect(res.status).toBe(302);
    const saved = await repo.getOpportunity(scope, "opp_1");
    expect(saved?.status).toBe("proposal_prepared");
    expect(saved?.proposalMd).toContain("No page for heat pumps");
  });

  it("saves an edited draft without changing the agency's decision", async () => {
    await repo.saveAnalysis(scope, [opp({ status: "snoozed", proposalMd: "# old" })]);
    await act("save-proposal", { proposalMd: "# edited" });
    const saved = await repo.getOpportunity(scope, "opp_1");
    expect(saved?.proposalMd).toBe("# edited");
    expect(saved?.status).toBe("snoozed");
  });

  it("rejects an empty draft rather than blanking a saved one", async () => {
    await repo.saveAnalysis(scope, [opp({ proposalMd: "# keep me" })]);
    const res = (await act("save-proposal", { proposalMd: "   " })) as { error?: string };
    expect(res.error).toMatch(/empty/i);
    expect((await repo.getOpportunity(scope, "opp_1"))?.proposalMd).toBe("# keep me");
  });
});

describe("reopening", () => {
  it("returns a dismissed finding to the feed", async () => {
    await repo.saveAnalysis(scope, [opp({ status: "dismissed" })]);
    await act("reopen");
    expect((await repo.getOpportunity(scope, "opp_1"))?.status).toBe("new");
  });

  it("refuses to reopen contract-covered work as billable", async () => {
    await repo.saveAnalysis(scope, [opp({ billableStatus: "already_covered", status: "already_covered" })]);
    const res = (await act("reopen")) as { error?: string };
    expect(res.error).toMatch(/covered by the client's contract/i);
    expect((await repo.getOpportunity(scope, "opp_1"))?.status).toBe("already_covered");
  });
});

describe("snoozing", () => {
  it("stores a future return date", async () => {
    await repo.saveAnalysis(scope, [opp()]);
    await act("snooze", { days: "14" });
    const saved = await repo.getOpportunity(scope, "opp_1");
    expect(saved?.status).toBe("snoozed");
    expect(new Date(saved!.snoozeUntil!).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a nonsensical duration instead of silently defaulting", async () => {
    await repo.saveAnalysis(scope, [opp()]);
    for (const days of ["0", "-5", "9999", "abc"]) {
      const res = (await act("snooze", { days })) as { error?: string };
      expect(res.error).toMatch(/1 and 365/);
    }
    expect((await repo.getOpportunity(scope, "opp_1"))?.status).toBe("new");
  });
});

describe("marking covered", () => {
  it("records coverage so the same gap is never resold", async () => {
    await repo.saveAnalysis(scope, [opp()]);
    await act("cover");
    const saved = await repo.getOpportunity(scope, "opp_1");
    expect(saved?.status).toBe("already_covered");
    const coverage = await repo.listCoverage(scope, "cli_a");
    expect(coverage.map((c) => c.serviceId)).toContain("svc_a");
  });
});

describe("counts agree across every surface", () => {
  beforeEach(async () => {
    await repo.saveAnalysis(scope, [
      opp({ id: "o_open", dedupeKey: "k_open", priceMin: 900, priceMax: 1800 }),
      opp({ id: "o_dismissed", dedupeKey: "k_dis", status: "dismissed", priceMin: 500, priceMax: 900 }),
      opp({ id: "o_snoozed", dedupeKey: "k_snz", status: "snoozed", priceMin: 300, priceMax: 400 }),
    ]);
  });

  it("the feed, the client list and the client page report the same open count", async () => {
    const feed = (await oppIndex.loader({ request: new Request("http://localhost/opportunities"), context: ctx } as never)) as {
      groups: Array<{ totals: { open: number; priceMax: number } }>;
    };
    const list = (await clientsIndex.loader({ request: new Request("http://localhost/clients"), context: ctx } as never)) as {
      clients: Array<{ totals: { open: number; priceMax: number } }>;
    };
    const detail = (await clientDetail.loader({
      request: new Request("http://localhost/clients/cli_a"),
      params: { id: "cli_a" },
      context: ctx,
    } as never)) as { totals: { open: number; priceMax: number } };

    expect(feed.groups[0]!.totals.open).toBe(1);
    expect(list.clients[0]!.totals.open).toBe(1);
    expect(detail.totals.open).toBe(1);
  });

  it("groups every opportunity by client in one query, scoped to the workspace", async () => {
    const grouped = await repo.listOpportunitiesByClient(scope);
    expect(grouped.get("cli_a")).toHaveLength(3);
    expect([...grouped.keys()]).toEqual(["cli_a"]);

    // A second workspace sees none of it.
    const { createWorkspaceForOwner } = await import("@/db/workspaces");
    await createWorkspaceForOwner(scope.db, { id: "ws_b", name: "B", ownerUserId: "u_b" });
    const other = await repo.listOpportunitiesByClient({ db: scope.db, workspaceId: "ws_b" });
    expect(other.size).toBe(0);
  });

  it("closed findings never inflate potential value on any surface", async () => {
    const detail = (await clientDetail.loader({
      request: new Request("http://localhost/clients/cli_a"),
      params: { id: "cli_a" },
      context: ctx,
    } as never)) as { totals: { priceMin: number; priceMax: number } };
    expect(detail.totals.priceMin).toBe(900);
    expect(detail.totals.priceMax).toBe(1800);
  });
});

describe("opportunity queue presentation", () => {
  it("explains the actual tier, win-rate, value, and confidence ordering", () => {
    const page = createElement(oppIndex.default, {
      loaderData: {
        groups: [
          {
            client: { id: "cli_a", name: "Client A", domain: "cli-a.example" },
            opportunities: [opp()],
            totals: { open: 1, closed: 0, priceMin: 900, priceMax: 1800 },
            run: null,
            monitoring: { cadence: "off", nextDueAt: null },
            state: "attention",
          },
        ],
        serviceName: { svc_a: "Service Landing Page" },
        winRates: [],
        monitoring: {
          monitored: 0,
          due: 0,
          checks: 0,
          unhealthy: 0,
          newFindings: 0,
          resolvedFindings: 0,
        },
      },
      actionData: undefined,
    } as never);
    const router = createMemoryRouter([{ path: "*", element: page }], {
      initialEntries: ["/opportunities"],
    });
    const html = renderToStaticMarkup(
      createElement(RouterProvider, { router }),
    );

    expect(html).toContain("commercial fit");
    expect(html).toContain("what your agency converts");
    expect(html).toContain("potential value");
    expect(html).toContain("confidence");
    expect(html).not.toContain("recency");
  });

  it("presents related service findings as a project without inventing a package price", () => {
    const rows = [
      opp({ id: "water_repair", title: "Water Heater Repair — dedicated service page" }),
      opp({ id: "water_replace", title: "Water Heater Replacement — dedicated service page" }),
      opp({ id: "tankless", title: "Tankless Water Heater — dedicated service page" }),
    ];
    const page = createElement(oppIndex.default, {
      loaderData: {
        groups: [
          {
            client: { id: "cli_a", name: "Tri City Plumbing", domain: "cli-a.example" },
            opportunities: rows,
            totals: { open: 3, closed: 0, priceMin: 2700, priceMax: 5400 },
            run: null,
            monitoring: { cadence: "off", nextDueAt: null },
            state: "attention",
          },
        ],
        serviceName: { svc_a: "Service Landing Page" },
        winRates: [],
        monitoring: {
          monitored: 0,
          due: 0,
          checks: 0,
          unhealthy: 0,
          newFindings: 0,
          resolvedFindings: 0,
        },
      },
      actionData: undefined,
    } as never);
    const router = createMemoryRouter([{ path: "*", element: page }], {
      initialEntries: ["/opportunities"],
    });
    const html = renderToStaticMarkup(createElement(RouterProvider, { router }));

    expect(html).toContain("Water Heater Service Expansion");
    expect(html).toContain("Underlying opportunity value");
    expect(html).toContain("$2,700 – $5,400");
    expect(html).toContain("Package price");
    expect(html).toContain("Not set");
  });
});

// ---------------------------------------------------------------------------
// sales funnel routes: accept / pitched / lost and terminal integrity
// ---------------------------------------------------------------------------

describe("sales funnel routes", () => {
  it("accept marks a NEW finding accepted and stamps acceptedAt", async () => {
    await repo.saveAnalysis(scope, [opp()]);
    const res = (await act("accept")) as Response;
    expect(res.status).toBe(302);
    const saved = await repo.getOpportunity(scope, "opp_1");
    expect(saved?.status).toBe("accepted");
    expect(saved?.acceptedAt).toBeTruthy();
  });

  it("pitch stamps acceptedAt and pitchedAt together when never accepted", async () => {
    await repo.saveAnalysis(scope, [opp()]);
    const res = (await act("pitch")) as Response;
    expect(res.status).toBe(302);
    const saved = await repo.getOpportunity(scope, "opp_1");
    expect(saved?.status).toBe("pitched");
    expect(saved?.acceptedAt).toBeTruthy();
    expect(saved?.pitchedAt).toBeTruthy();
  });

  it("lost records lostAt and pitchedAt (the client saw it), distinct from dismissed", async () => {
    await repo.saveAnalysis(scope, [opp({ status: "pitched", pitchedAt: "2026-09-01T00:00:00.000Z" })]);
    const res = (await act("lost")) as Response;
    expect(res.status).toBe(302);
    const saved = await repo.getOpportunity(scope, "opp_1");
    expect(saved?.status).toBe("lost");
    expect(saved?.lostAt).toBeTruthy();
    expect(saved?.pitchedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("sold through the funnel route preserves accepted and pitched milestones", async () => {
    await repo.saveAnalysis(
      scope,
      [opp({ status: "pitched", acceptedAt: "2026-09-01T00:00:00.000Z", pitchedAt: "2026-09-02T00:00:00.000Z" })],
    );
    const res = (await act("sold", { soldAmount: "1800" })) as Response;
    expect(res.status).toBe(302);
    const saved = await repo.getOpportunity(scope, "opp_1");
    expect(saved?.status).toBe("sold");
    expect(saved?.soldAmount).toBe(1800);
    expect(saved?.acceptedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(saved?.pitchedAt).toBe("2026-09-02T00:00:00.000Z");
  });

  it("proposal creation implies acceptance and stamps proposalPreparedAt once", async () => {
    await repo.saveAnalysis(scope, [opp()]);
    await act("prepare-proposal");
    const first = await repo.getOpportunity(scope, "opp_1");
    expect(first?.status).toBe("proposal_prepared");
    expect(first?.acceptedAt).toBeTruthy();
    expect(first?.proposalPreparedAt).toBeTruthy();

    // Editing the draft later must not reset the milestone.
    await act("save-proposal", { proposalMd: "# rewritten" });
    const second = await repo.getOpportunity(scope, "opp_1");
    expect(second?.proposalMd).toBe("# rewritten");
    expect(second?.proposalPreparedAt).toBe(first?.proposalPreparedAt);
    expect(second?.acceptedAt).toBe(first?.acceptedAt);
  });

  it("terminal outcomes cannot be reopened", async () => {
    await repo.saveAnalysis(scope, [opp({ status: "sold", soldAt: "2026-09-01T00:00:00.000Z", soldAmount: 900 })]);
    const res = (await act("reopen")) as { error?: string };
    expect(res.error).toBeTruthy();
    const saved = await repo.getOpportunity(scope, "opp_1");
    expect(saved?.status).toBe("sold");
    expect(saved?.soldAmount).toBe(900);
  });

  it("dismissed stays an internal rejection with dismissedAt and no lostAt", async () => {
    await repo.saveAnalysis(scope, [opp()]);
    await act("dismiss");
    const saved = await repo.getOpportunity(scope, "opp_1");
    expect(saved?.status).toBe("dismissed");
    expect(saved?.dismissedAt).toBeTruthy();
    expect(saved?.lostAt).toBeUndefined();
    expect(saved?.pitchedAt).toBeUndefined();
  });

  it("lost from dismissed is refused (an internal rejection never grew a client conversation)", async () => {
    await repo.saveAnalysis(scope, [opp({ status: "dismissed" })]);
    const res = (await act("lost")) as { error?: string };
    expect(res.error).toBeTruthy();
    const saved = await repo.getOpportunity(scope, "opp_1");
    expect(saved?.status).toBe("dismissed");
    expect(saved?.lostAt).toBeUndefined();
  });

  it("detail page renders lost differently from dismissed", async () => {
    await repo.saveAnalysis(scope, [opp({ status: "lost", pitchedAt: "2026-09-01T00:00:00.000Z", lostAt: "2026-09-03T00:00:00.000Z" })]);
    const lostLoader = await call(oppDetail.loader as never, {
      request: new Request("http://localhost/opportunities/opp_1"),
      params: { id: "opp_1" },
      context: ctx,
    });
    const lostHtml = renderToStaticMarkup(
      createElement(
        RouterProvider,
        {
          router: createMemoryRouter(
            [{ path: "*", element: createElement(oppDetail.default, { loaderData: lostLoader } as never) }],
            { initialEntries: ["/opportunities/opp_1"] },
          ),
        },
      ),
    );
    expect(lostHtml).toContain("Not closed");
    expect(lostHtml).not.toContain("Dismissed");
    expect(lostHtml).toContain("client decision");
  });
});
