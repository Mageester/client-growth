import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { analyzeClient } from "@/pipeline/analyzeClient";
import { FixtureEvidenceProvider } from "@/adapters/evidence/FixtureEvidenceProvider";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { ClientSchema, type Opportunity } from "@/core/schema";
import type { TenantScope } from "@/db/tenant";
import { coverageNone, hvacCatalog, hvacClient, hvacEvidence } from "./helpers/fixtures";

/**
 * Re-analysis must never un-write a sales decision.
 *
 * The reconcile step rebuilds surfaced findings from fresh evidence. Before the
 * funnel existed the only prior state worth keeping was a proposal; now an
 * accepted, pitched, sold, lost or dismissed finding carries commercial history
 * that a re-run must preserve exactly.
 */

const NOW = new Date("2026-09-07T00:00:00.000Z");
const ACCEPTED_AT = "2026-09-01T00:00:00.000Z";
const PITCHED_AT = "2026-09-02T00:00:00.000Z";

let db: NodeSqliteDb;
let scope: TenantScope;

function analyze(existing: Opportunity[] = [], coverage = coverageNone()) {
  return analyzeClient({
    client: hvacClient(),
    catalog: hvacCatalog(),
    coverage,
    evidenceProvider: new FixtureEvidenceProvider([hvacEvidence()]),
    evaluator: new MockEvaluator(),
    existing,
    now: NOW,
  });
}

beforeEach(async () => {
  db = nodeSqliteDb(":memory:");
  await repo.applySchema(db);
  await createWorkspaceForOwner(db, { id: "ws_a", name: "A", ownerUserId: "u_a" });
  scope = { db, workspaceId: "ws_a" };
});

afterEach(() => db.close());

describe("re-analysis preserves the funnel", () => {
  let surfaced: Opportunity;

  beforeEach(async () => {
    const first = await analyze();
    surfaced = first.opportunities[0] as Opportunity;
  });

  it("keeps an accepted finding accepted on re-detection", async () => {
    const second = await analyze([{ ...surfaced, status: "accepted", acceptedAt: ACCEPTED_AT }]);

    const kept = second.opportunities.find((o) => o.dedupeKey === surfaced.dedupeKey);
    expect(kept).toBeDefined();
    expect(kept!.status).toBe("accepted");
    expect(kept!.acceptedAt).toBe(ACCEPTED_AT);
  });

  it("keeps proposal_prepared with its text and prepared milestone", async () => {
    const second = await analyze([
      {
        ...surfaced,
        status: "proposal_prepared",
        proposalMd: "# The agency's own draft",
        acceptedAt: ACCEPTED_AT,
        proposalPreparedAt: PITCHED_AT,
      },
    ]);

    const kept = second.opportunities.find((o) => o.dedupeKey === surfaced.dedupeKey);
    expect(kept!.status).toBe("proposal_prepared");
    expect(kept!.proposalMd).toBe("# The agency's own draft");
    expect(kept!.acceptedAt).toBe(ACCEPTED_AT);
    expect(kept!.proposalPreparedAt).toBe(PITCHED_AT);
  });

  it("keeps pitched pitched with all milestones", async () => {
    const second = await analyze([
      {
        ...surfaced,
        status: "pitched",
        acceptedAt: ACCEPTED_AT,
        pitchedAt: PITCHED_AT,
      },
    ]);

    const kept = second.opportunities.find((o) => o.dedupeKey === surfaced.dedupeKey);
    expect(kept!.status).toBe("pitched");
    expect(kept!.acceptedAt).toBe(ACCEPTED_AT);
    expect(kept!.pitchedAt).toBe(PITCHED_AT);
  });

  it("never turns accepted or pitched back into new", async () => {
    // lost is terminal and suppressed (see below): it must never re-enter the
    // surfaced queue at all, let alone as new.
    for (const status of ["accepted", "pitched"] as const) {
      const second = await analyze([{ ...surfaced, status, acceptedAt: ACCEPTED_AT }]);
      const kept = second.opportunities.find((o) => o.dedupeKey === surfaced.dedupeKey);
      expect(kept?.status, `status after re-analysis: ${status}`).toBe(status);
      expect(kept?.status).not.toBe("new");
    }
  });

  it("counts an accepted re-detection as stillOpen, not newlyFound", async () => {
    const second = await analyze([{ ...surfaced, status: "accepted", acceptedAt: ACCEPTED_AT }]);
    expect(second.newlyFound.map((o) => o.dedupeKey)).not.toContain(surfaced.dedupeKey);
    expect(second.stillOpen.map((o) => o.dedupeKey)).toContain(surfaced.dedupeKey);
  });

  it("keeps sold, lost and dismissed terminal and suppressed, costing no AI call", async () => {
    for (const status of ["sold", "lost", "dismissed"] as const) {
      const second = await analyze([{ ...surfaced, status, acceptedAt: ACCEPTED_AT }]);
      expect(second.opportunities.map((o) => o.dedupeKey)).not.toContain(surfaced.dedupeKey);
      expect(second.suppressed.map((o) => o.dedupeKey)).toContain(surfaced.dedupeKey);
      expect(second.stats.aiCalls).toBe(0);
    }
  });

  it("keeps lost and dismissed milestones intact in the suppressed row", async () => {
    const second = await analyze([
      { ...surfaced, status: "lost", acceptedAt: ACCEPTED_AT, pitchedAt: PITCHED_AT, lostAt: PITCHED_AT },
    ]);
    const kept = second.suppressed.find((o) => o.dedupeKey === surfaced.dedupeKey);
    expect(kept!.status).toBe("lost");
    expect(kept!.lostAt).toBe(PITCHED_AT);
    expect(kept!.pitchedAt).toBe(PITCHED_AT);
  });

  it("does not let sold be re-classified as resolved by the fix reconciliation", async () => {
    // A sold row that was also covered is still terminal: the reconciliation
    // must only ever close open findings, never commercial history.
    const second = await analyze([{ ...surfaced, status: "sold", soldAmount: 900 }]);
    const resolvedKeys = second.resolved.map((o) => o.dedupeKey);
    expect(resolvedKeys).not.toContain(surfaced.dedupeKey);
  });

  it("does not let coverage rebuild a sold row as already_covered", async () => {
    // Contract coverage is authoritative over OPEN work, but a terminal
    // commercial outcome is history: marking the mapped service covered must
    // not rewrite a recorded sale into an "already covered" finding.
    const soldRow: Opportunity = {
      ...surfaced,
      status: "sold",
      soldAmount: 1800,
      acceptedAt: ACCEPTED_AT,
      pitchedAt: PITCHED_AT,
    };
    const second = await analyze([soldRow], [
      { clientId: soldRow.clientId, serviceId: soldRow.suggestedServiceId, covered: true },
    ]);
    const kept = second.suppressed.find((o) => o.dedupeKey === soldRow.dedupeKey);
    expect(kept!.status).toBe("sold");
    expect(kept!.soldAmount).toBe(1800);
    expect(kept!.pitchedAt).toBe(PITCHED_AT);
    expect(second.suppressed.map((o) => o.status)).not.toContain("already_covered");
  });
});

describe("reappeared resolved finding", () => {
  it("starts a fresh cycle without inheriting old funnel milestones", async () => {
    const first = await analyze();
    const original = first.opportunities[0] as Opportunity;
    // The finding was accepted back in the previous cycle, then the client
    // fixed it and re-analysis resolved the row.
    const resolvedRow: Opportunity = {
      ...original,
      status: "resolved",
      acceptedAt: ACCEPTED_AT,
      updatedAt: "2026-09-03T00:00:00.000Z",
    };

    // The site genuinely shows the gap again.
    const second = await analyze([resolvedRow]);
    const revived = second.opportunities.find((o) => o.dedupeKey === original.dedupeKey);

    expect(revived).toBeDefined();
    expect(revived!.status).toBe("new");
    // The old acceptance belongs to the previous sales cycle, not this one:
    // carrying it in would fabricate a funnel that never happened.
    expect(revived!.acceptedAt).toBeUndefined();
    expect(second.newlyFound.map((o) => o.dedupeKey)).toContain(original.dedupeKey);
  });
});
