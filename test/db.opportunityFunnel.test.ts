import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import * as repo from "@/db/repositories";
import { applySchema } from "@/db/repositories";
import { SCHEMA_SQL } from "@/db/schema";
import {
  applyFunnelTransition,
  salesStageOf,
  type FunnelAction,
} from "@/db/opportunityFunnel";
import { createWorkspaceForOwner } from "@/db/workspaces";
import {
  ClientSchema,
  OpportunitySchema,
  ServiceSchema,
  type Opportunity,
} from "@/core/schema";
import type { TenantScope } from "@/db/tenant";

/**
 * The durable sales funnel.
 *
 * Status alone loses history: once a finding reads "sold" nothing remembers it
 * passed through accepted and pitched. These tests pin the milestone
 * timestamps — first-time-only writes, implied upstream milestones, terminal
 * integrity, and the strict separation between an internal dismissal and a
 * client loss.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const NOW = new Date("2026-09-07T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();

let db: NodeSqliteDb;
let scope: TenantScope;

beforeEach(async () => {
  db = nodeSqliteDb(":memory:");
  await repo.applySchema(db);
  await createWorkspaceForOwner(db, { id: "ws_a", name: "A", ownerUserId: "u_a" });
  scope = { db, workspaceId: "ws_a" };
  await repo.upsertService(
    scope,
    ServiceSchema.parse({
      id: "svc_a",
      name: "Service A",
      description: "",
      priceMin: 900,
      priceMax: 1800,
      tags: ["landing-page"],
      active: true,
    }),
  );
  await repo.upsertClient(
    scope,
    ClientSchema.parse({ id: "cli_a", name: "A", domain: "a.example", offerings: [], notes: "" }),
  );
});

afterEach(() => db.close());

function opp(over: Partial<Opportunity> = {}): Opportunity {
  return OpportunitySchema.parse({
    id: "opp_1",
    dedupeKey: "k1",
    clientId: "cli_a",
    ruleId: "missing-service-page",
    title: "No page for X",
    detected: "detected",
    evidenceRefs: [],
    rationale: "why",
    suggestedServiceId: "svc_a",
    suggestedScope: [],
    priceMin: 900,
    priceMax: 1800,
    confidence: 0.8,
    billableStatus: "billable",
    status: "new",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  });
}

async function save(row: Opportunity): Promise<void> {
  await repo.saveAnalysis(scope, [row]);
}

async function stored(): Promise<Opportunity> {
  const row = await repo.getOpportunity(scope, "opp_1");
  expect(row).not.toBeNull();
  return row as Opportunity;
}

const act = (action: FunnelAction) =>
  applyFunnelTransition(scope, "opp_1", action, { now: NOW });

// ---------------------------------------------------------------------------
// domain status transitions and first-time milestones
// ---------------------------------------------------------------------------

describe("applyFunnelTransition", () => {
  it("accept sets status accepted and records acceptedAt", async () => {
    await save(opp());
    expect(await act({ kind: "accept" })).toBe(true);

    const row = await stored();
    expect(row.status).toBe("accepted");
    expect(row.acceptedAt).toBe(NOW_ISO);
    expect(row.pitchedAt).toBeUndefined();
    expect(row.lostAt).toBeUndefined();
  });

  it("repeated acceptance does not rewrite acceptedAt", async () => {
    await save(opp());
    await act({ kind: "accept" });
    const first = (await stored()).acceptedAt;

    const later = new Date(NOW.getTime() + 86_400_000);
    await applyFunnelTransition(scope, "opp_1", { kind: "accept" }, { now: later });

    const row = await stored();
    expect(row.acceptedAt).toBe(first);
    expect(row.acceptedAt).not.toBe(later.toISOString());
  });

  it("preparing the first proposal implies acceptance and proposal milestone", async () => {
    await save(opp());
    expect(await act({ kind: "prepare-proposal", proposalMd: "# draft" })).toBe(true);

    const row = await stored();
    expect(row.status).toBe("proposal_prepared");
    expect(row.acceptedAt).toBe(NOW_ISO);
    expect(row.proposalPreparedAt).toBe(NOW_ISO);
    expect(row.proposalMd).toBe("# draft");
  });

  it("new -> proposal_prepared keeps distinct acceptedAt and proposalPreparedAt order", async () => {
    await save(opp());
    // Accept on day one, propose on day two: both milestones stand.
    await act({ kind: "accept" });
    const dayTwo = new Date(NOW.getTime() + 86_400_000);
    await applyFunnelTransition(
      scope,
      "opp_1",
      { kind: "prepare-proposal", proposalMd: "# later draft" },
      { now: dayTwo },
    );

    const row = await stored();
    expect(row.acceptedAt).toBe(NOW_ISO);
    expect(row.proposalPreparedAt).toBe(dayTwo.toISOString());
  });

  it("editing or re-reviewing the proposal does not reset proposalPreparedAt", async () => {
    await save(opp());
    await act({ kind: "prepare-proposal", proposalMd: "# v1" });
    const prepared = (await stored()).proposalPreparedAt;

    const later = new Date(NOW.getTime() + 86_400_000);
    await applyFunnelTransition(
      scope,
      "opp_1",
      { kind: "prepare-proposal", proposalMd: "# v2 rewritten" },
      { now: later },
    );

    const row = await stored();
    expect(row.proposalPreparedAt).toBe(prepared);
    expect(row.proposalMd).toBe("# v2 rewritten");
    expect(row.status).toBe("proposal_prepared");
  });

  it("pitch sets pitchedAt and implies acceptedAt when it was never set", async () => {
    await save(opp());
    expect(await act({ kind: "pitch" })).toBe(true);

    const row = await stored();
    expect(row.status).toBe("pitched");
    expect(row.pitchedAt).toBe(NOW_ISO);
    expect(row.acceptedAt).toBe(NOW_ISO);
  });

  it("pitch from accepted keeps the earlier acceptedAt and adds pitchedAt", async () => {
    await save(opp());
    await act({ kind: "accept" });
    const dayTwo = new Date(NOW.getTime() + 86_400_000);
    await applyFunnelTransition(scope, "opp_1", { kind: "pitch" }, { now: dayTwo });

    const row = await stored();
    expect(row.acceptedAt).toBe(NOW_ISO);
    expect(row.pitchedAt).toBe(dayTwo.toISOString());
    expect(row.status).toBe("pitched");
  });

  it("sold from pitched preserves accepted and pitched milestones", async () => {
    await save(opp());
    await act({ kind: "pitch" });
    const dayTwo = new Date(NOW.getTime() + 86_400_000);
    await applyFunnelTransition(
      scope,
      "opp_1",
      { kind: "sold", soldAmount: 1800 },
      { now: dayTwo },
    );

    const row = await stored();
    expect(row.status).toBe("sold");
    expect(row.acceptedAt).toBe(NOW_ISO);
    expect(row.pitchedAt).toBe(NOW_ISO);
    expect(row.soldAt).toBe(dayTwo.toISOString());
    expect(row.soldAmount).toBe(1800);
  });

  it("sold straight from new implies acceptedAt and pitchedAt", async () => {
    await save(opp());
    expect(await act({ kind: "sold" })).toBe(true);

    const row = await stored();
    expect(row.status).toBe("sold");
    expect(row.acceptedAt).toBe(NOW_ISO);
    expect(row.pitchedAt).toBe(NOW_ISO);
    expect(row.soldAt).toBe(NOW_ISO);
  });

  it("lost from pitched records lostAt without touching pitchedAt", async () => {
    await save(opp());
    await act({ kind: "pitch" });
    const dayTwo = new Date(NOW.getTime() + 86_400_000);
    await applyFunnelTransition(scope, "opp_1", { kind: "lost" }, { now: dayTwo });

    const row = await stored();
    expect(row.status).toBe("lost");
    expect(row.pitchedAt).toBe(NOW_ISO);
    expect(row.lostAt).toBe(dayTwo.toISOString());
    expect(row.acceptedAt).toBe(NOW_ISO);
  });

  it("marking lost from an earlier state records pitchedAt because the client saw it", async () => {
    await save(opp());
    expect(await act({ kind: "lost" })).toBe(true);

    const row = await stored();
    expect(row.status).toBe("lost");
    // "Lost" semantically means the client saw it, so pitchedAt must exist.
    expect(row.pitchedAt).toBe(NOW_ISO);
    expect(row.lostAt).toBe(NOW_ISO);
    expect(row.acceptedAt).toBe(NOW_ISO);
  });

  it("dismiss records dismissedAt and is distinct from lost", async () => {
    await save(opp());
    expect(await act({ kind: "dismiss" })).toBe(true);

    const row = await stored();
    expect(row.status).toBe("dismissed");
    expect(row.dismissedAt).toBe(NOW_ISO);
    // An internal rejection is not a client loss: no pitchedAt, no lostAt.
    expect(row.pitchedAt).toBeUndefined();
    expect(row.lostAt).toBeUndefined();
  });

  it("dismiss from accepted is allowed and stays an internal rejection", async () => {
    await save(opp());
    await act({ kind: "accept" });
    const dayTwo = new Date(NOW.getTime() + 86_400_000);
    await applyFunnelTransition(scope, "opp_1", { kind: "dismiss" }, { now: dayTwo });

    const row = await stored();
    expect(row.status).toBe("dismissed");
    expect(row.acceptedAt).toBe(NOW_ISO);
    expect(row.dismissedAt).toBe(dayTwo.toISOString());
    expect(row.lostAt).toBeUndefined();
  });

  it("repeated pitch does not rewrite pitchedAt", async () => {
    await save(opp());
    await act({ kind: "pitch" });
    const first = (await stored()).pitchedAt;

    const later = new Date(NOW.getTime() + 86_400_000);
    await applyFunnelTransition(scope, "opp_1", { kind: "pitch" }, { now: later });

    expect((await stored()).pitchedAt).toBe(first);
  });

  it("snooze and cover remain operational states with no funnel milestones", async () => {
    await save(opp());
    await act({ kind: "snooze", snoozeUntil: "2026-10-01T00:00:00.000Z" });
    let row = await stored();
    expect(row.status).toBe("snoozed");
    expect(row.acceptedAt).toBeUndefined();
    expect(row.pitchedAt).toBeUndefined();

    await save(opp({ id: "opp_2", dedupeKey: "k2" }));
    await applyFunnelTransition(scope, "opp_2", { kind: "cover" }, { now: NOW });
    row = (await repo.getOpportunity(scope, "opp_2")) as Opportunity;
    expect(row.status).toBe("already_covered");
    expect(row.acceptedAt).toBeUndefined();
  });

  it("returns false and changes nothing for a missing or foreign opportunity", async () => {
    await save(opp());
    await createWorkspaceForOwner(db, { id: "ws_b", name: "B", ownerUserId: "u_b" });
    const foreign: TenantScope = { db, workspaceId: "ws_b" };

    expect(await applyFunnelTransition(foreign, "opp_1", { kind: "accept" }, { now: NOW })).toBe(
      false,
    );
    expect(await applyFunnelTransition(scope, "missing", { kind: "accept" }, { now: NOW })).toBe(
      false,
    );
    expect((await stored()).status).toBe("new");
    expect((await stored()).acceptedAt).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // reopen semantics: dismissed/snoozed/resolved may return to new;
  // sold/lost are client-decided history and never reopen.
  // ------------------------------------------------------------------

  it("reopen returns a dismissed finding to new as a fresh cycle", async () => {
    await save(opp());
    await act({ kind: "dismiss" });
    const dayTwo = new Date(NOW.getTime() + 86_400_000);

    expect(await applyFunnelTransition(scope, "opp_1", { kind: "reopen" }, { now: dayTwo })).toBe(
      true,
    );
    const row = await stored();
    expect(row.status).toBe("new");
    // Stale funnel milestones are cleared: the rejection belonged to the
    // previous cycle, and a new cycle must not inherit its history.
    expect(row.dismissedAt).toBeUndefined();
    expect(row.acceptedAt).toBeUndefined();
  });

  it("reopen clears an active snooze and stale milestones", async () => {
    await save(opp());
    await act({ kind: "accept" });
    await act({ kind: "snooze", snoozeUntil: "2026-10-01T00:00:00.000Z" });

    expect(await act({ kind: "reopen" })).toBe(true);
    const row = await stored();
    expect(row.status).toBe("new");
    expect(row.snoozeUntil).toBeUndefined();
    expect(row.acceptedAt).toBeUndefined();
  });

  it("reopen of a resolved finding clears proposalMd and every stale milestone", async () => {
    await save(
      opp({
        status: "resolved",
        acceptedAt: "2026-08-01T00:00:00.000Z",
        proposalPreparedAt: "2026-08-02T00:00:00.000Z",
        pitchedAt: "2026-08-03T00:00:00.000Z",
        proposalMd: "# draft from the fixed cycle",
        snoozeUntil: "2026-10-01T00:00:00.000Z",
      }),
    );

    expect(await act({ kind: "reopen" })).toBe(true);
    const row = await stored();
    expect(row.status).toBe("new");
    // A resolved row is a closed cycle: the reopened cycle starts clean.
    expect(row.acceptedAt).toBeUndefined();
    expect(row.proposalPreparedAt).toBeUndefined();
    expect(row.pitchedAt).toBeUndefined();
    expect(row.lostAt).toBeUndefined();
    expect(row.dismissedAt).toBeUndefined();
    expect(row.proposalMd).toBeUndefined();
    expect(row.snoozeUntil).toBeUndefined();
    // Stable identity is preserved.
    expect(row.id).toBe("opp_1");
    expect(row.dedupeKey).toBe("k1");
  });

  it("reopen of a dismissed finding keeps the draft but starts at new", async () => {
    await save(
      opp({
        status: "dismissed",
        dismissedAt: "2026-08-01T00:00:00.000Z",
        proposalMd: "# draft worth reconsidering",
      }),
    );

    expect(await act({ kind: "reopen" })).toBe(true);
    const row = await stored();
    expect(row.status).toBe("new");
    // Same sales opportunity reconsidered: the draft may be reused.
    expect(row.proposalMd).toBe("# draft worth reconsidering");
    // But the stale milestones do not read as this cycle's history.
    expect(row.dismissedAt).toBeUndefined();
    expect(row.acceptedAt).toBeUndefined();
  });

  it("reopen of a snoozed finding keeps the draft", async () => {
    await save(
      opp({
        status: "snoozed",
        snoozeUntil: "2026-10-01T00:00:00.000Z",
        acceptedAt: "2026-08-01T00:00:00.000Z",
        proposalMd: "# draft waiting out the snooze",
      }),
    );

    expect(await act({ kind: "reopen" })).toBe(true);
    const row = await stored();
    expect(row.status).toBe("new");
    expect(row.proposalMd).toBe("# draft waiting out the snooze");
    expect(row.snoozeUntil).toBeUndefined();
    expect(row.acceptedAt).toBeUndefined();
  });

  it("sold and lost can never be reopened", async () => {
    await save(opp({ status: "sold", soldAt: "2026-08-01T00:00:00.000Z", soldAmount: 900 }));
    expect(await act({ kind: "reopen" })).toBe(false);
    let row = await stored();
    expect(row.status).toBe("sold");
    expect(row.soldAmount).toBe(900);
    expect(row.soldAt).toBe("2026-08-01T00:00:00.000Z");

    await save(opp({ id: "opp_3", dedupeKey: "k3", status: "lost", pitchedAt: NOW_ISO, lostAt: NOW_ISO }));
    expect(await applyFunnelTransition(scope, "opp_3", { kind: "reopen" }, { now: NOW })).toBe(
      false,
    );
    row = (await repo.getOpportunity(scope, "opp_3")) as Opportunity;
    expect(row.status).toBe("lost");
    expect(row.lostAt).toBe(NOW_ISO);
  });

  it("can explicitly correct a terminal outcome back to pitched while retaining its history", async () => {
    await save(opp({
      status: "sold",
      acceptedAt: "2026-07-30T00:00:00.000Z",
      pitchedAt: "2026-07-31T00:00:00.000Z",
      soldAt: "2026-08-01T00:00:00.000Z",
      soldAmount: 900,
    }));
    expect(await act({ kind: "correct-outcome" })).toBe(true);
    const row = await stored();
    expect(row.status).toBe("pitched");
    expect(row.soldAt).toBe("2026-08-01T00:00:00.000Z");
    expect(row.soldAmount).toBe(900);
    expect(row.pitchedAt).toBe("2026-07-31T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// coverage must never rewrite terminal or closed rows
// ---------------------------------------------------------------------------

describe("coverage vs terminal rows", () => {
  it("setCoverage leaves sold, lost, dismissed, resolved and superseded rows untouched", async () => {
    const cases = [
      { status: "sold", soldAt: NOW_ISO, soldAmount: 1200 },
      { status: "lost", pitchedAt: NOW_ISO, lostAt: NOW_ISO },
      { status: "dismissed", dismissedAt: NOW_ISO },
      { status: "resolved" },
      { status: "superseded" },
    ] as const;
    let n = 0;
    for (const c of cases) {
      n += 1;
      const id = `opp_c${n}`;
      await save(
        opp({
          id,
          dedupeKey: `kc${n}`,
          status: c.status,
          ...("soldAt" in c ? { soldAt: c.soldAt } : {}),
          ...("soldAmount" in c ? { soldAmount: c.soldAmount } : {}),
          ...("pitchedAt" in c ? { pitchedAt: c.pitchedAt } : {}),
          ...("lostAt" in c ? { lostAt: c.lostAt } : {}),
          ...("dismissedAt" in c ? { dismissedAt: c.dismissedAt } : {}),
        }),
      );
      await repo.setCoverage(scope, "cli_a", "svc_a", "covered later");
      if (c.status === "superseded") {
        // Superseded rows are deliberately invisible to getOpportunity;
        // verify via raw SQL that coverage did not rewrite it either way.
        const raw = await db
          .prepare("SELECT status FROM opportunities WHERE id = ?")
          .bind(id)
          .first<{ status: string }>();
        expect(raw?.status).toBe("superseded");
        continue;
      }
      const row = (await repo.getOpportunity(scope, id)) as Opportunity;
      expect(row.status, `status for ${c.status}`).toBe(c.status);
    }
  });

  it("setCoverage still reconciles genuinely open work", async () => {
    await save(opp({ id: "opp_open", dedupeKey: "kopen" }));
    await repo.setCoverage(scope, "cli_a", "svc_a");
    const row = (await repo.getOpportunity(scope, "opp_open")) as Opportunity;
    expect(row.status).toBe("already_covered");
    expect(row.billableStatus).toBe("already_covered");
  });

  it.each([
    {
      priorStatus: "proposal_prepared" as const,
      history: {
        acceptedAt: "2026-09-01T00:00:00.000Z",
        proposalPreparedAt: "2026-09-02T00:00:00.000Z",
        proposalMd: "# The reviewed proposal",
      },
    },
    {
      priorStatus: "pitched" as const,
      history: {
        acceptedAt: "2026-09-01T00:00:00.000Z",
        pitchedAt: "2026-09-02T00:00:00.000Z",
        soldAt: "2026-09-03T00:00:00.000Z",
        soldAmount: 1800,
      },
    },
    {
      priorStatus: "dismissed" as const,
      history: { dismissedAt: "2026-09-02T00:00:00.000Z" },
    },
  ])("restores $priorStatus and its history when coverage is removed", async ({ priorStatus, history }) => {
    await save(opp({ status: priorStatus, ...history }));
    await act({ kind: "cover" });
    await repo.setCoverage(scope, "cli_a", "svc_a", "covered during review");

    const covered = await stored();
    expect(covered.status).toBe("already_covered");
    const result = await repo.removeCoverageAndReopen(scope, "cli_a", "svc_a");
    expect(result).toEqual({ removed: true, reopened: 1 });

    expect(await stored()).toMatchObject({
      status: priorStatus,
      billableStatus: "billable",
      ...history,
    });
  });
});

// ---------------------------------------------------------------------------
// stage classification for a reopened fresh cycle
// ---------------------------------------------------------------------------

describe("salesStageOf", () => {
  it("a reopened new row with a surviving draft reads as found, not proposal", () => {
    expect(
      salesStageOf({ status: "new", acceptedAt: undefined, proposalPreparedAt: undefined, pitchedAt: undefined, proposalMd: "# old draft" }),
    ).toBe("found");
  });

  it("a snoozed row with a draft still reads as proposal stage", () => {
    expect(
      salesStageOf({ status: "snoozed", acceptedAt: undefined, proposalPreparedAt: undefined, pitchedAt: undefined, proposalMd: "# draft" }),
    ).toBe("proposal");
  });
});

// ---------------------------------------------------------------------------
// persistence round-trip and legacy rows
// ---------------------------------------------------------------------------

describe("funnel persistence", () => {
  it("round-trips every milestone through DB -> domain -> DB", async () => {
    const original = opp({
      status: "sold",
      acceptedAt: "2026-09-01T00:00:00.000Z",
      proposalPreparedAt: "2026-09-02T00:00:00.000Z",
      pitchedAt: "2026-09-03T00:00:00.000Z",
      soldAt: "2026-09-04T00:00:00.000Z",
      soldAmount: 2400,
      proposalMd: "# full journey",
    });
    await save(original);
    const row = await stored();

    expect(row.acceptedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(row.proposalPreparedAt).toBe("2026-09-02T00:00:00.000Z");
    expect(row.pitchedAt).toBe("2026-09-03T00:00:00.000Z");
    expect(row.soldAt).toBe("2026-09-04T00:00:00.000Z");
    expect(row.soldAmount).toBe(2400);
    expect(row.proposalMd).toBe("# full journey");
  });

  it("parses legacy rows with no milestone columns as undefined, not invented", async () => {
    await save(opp({ status: "sold", soldAmount: 500 }));
    const row = await stored();

    expect(row.status).toBe("sold");
    expect(row.soldAmount).toBe(500);
    // No soldAt was given, so none is invented on the round trip.
    expect(row.soldAt).toBeUndefined();
    expect(row.acceptedAt).toBeUndefined();
    expect(row.proposalPreparedAt).toBeUndefined();
    expect(row.pitchedAt).toBeUndefined();
    expect(row.lostAt).toBeUndefined();
    expect(row.dismissedAt).toBeUndefined();
  });

  it("keeps an existing sold row's soldAmount and soldAt untouched by funnel writes", async () => {
    await save(opp({ status: "sold", soldAt: "2026-08-01T00:00:00.000Z", soldAmount: 900 }));
    // An accidental re-accept attempt must not clobber the recorded sale.
    await act({ kind: "accept" });
    const row = await stored();
    expect(row.soldAt).toBe("2026-08-01T00:00:00.000Z");
    expect(row.soldAmount).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// migration
// ---------------------------------------------------------------------------

describe("sales funnel migration", () => {
  it("is the next migration number and applies to a populated database", async () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    expect(files.some((f) => f.startsWith("0022_"))).toBe(true);

    // Build from raw migrations, insert data at the 0021 shape, then apply 0022.
    const raw = nodeSqliteDb(":memory:");
    try {
      for (const file of files.filter((f) => !f.startsWith("0022_"))) {
        await raw.exec(readFileSync(join(migrationsDir, file), "utf8"));
      }
      await createWorkspaceForOwner(raw, { id: "ws_m", name: "M", ownerUserId: "u_m" });
      // Parents first: the opportunity row references its client.
      await raw
        .prepare(
          `INSERT INTO clients (id, workspace_id, name, domain, updated_at)
           VALUES ('cli_m','ws_m','M','m.example','2026-01-01T00:00:00.000Z')`,
        )
        .run();
      await raw
        .prepare(
          `INSERT INTO services (id, workspace_id, name, price_min, price_max, updated_at)
           VALUES ('svc','ws_m','S',1,2,'2026-01-01T00:00:00.000Z')`,
        )
        .run();
      await raw
        .prepare(
          `INSERT INTO opportunities (id, workspace_id, dedupe_key, client_id, rule_id, title,
             detected, rationale, suggested_service_id, price_min, price_max, confidence,
             billable_status, status, sold_amount, sold_at, updated_at)
           VALUES ('legacy_1','ws_m','k1','cli_m','missing-service-page','T','d','r','svc',1,2,0.5,
                   'billable','sold',1800,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`,
        )
        .run();

      const migration = files.find((f) => f.startsWith("0022_"));
      await raw.exec(readFileSync(join(migrationsDir, migration!), "utf8"));

      // Existing rows keep their meaning; no milestone is invented.
      const legacy = await raw
        .prepare(`SELECT * FROM opportunities WHERE id = 'legacy_1'`)
        .first<Record<string, unknown>>();
      expect(legacy?.sold_amount).toBe(1800);
      expect(legacy?.sold_at).toBe("2026-01-01T00:00:00.000Z");
      expect(legacy?.accepted_at).toBeNull();
      expect(legacy?.proposal_prepared_at).toBeNull();
      expect(legacy?.pitched_at).toBeNull();
      expect(legacy?.lost_at).toBeNull();
      expect(legacy?.dismissed_at).toBeNull();

      expect(await raw.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
    } finally {
      raw.close();
    }
  });
});
