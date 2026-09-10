import { describe, expect, it } from "vitest";

import { ClientSchema, OpportunitySchema, type Opportunity } from "@/core/schema";
import { buildClientReportSnapshot, buildReportCandidates } from "@/core/clientReport";
import {
  CLIENT_REPORT_SHARE_TTL_MS,
  createClientReport,
  createClientReportShare,
  getClientReportById,
  getClientReportShareByToken,
  listActiveClientReportShares,
  listClientReportSummaries,
  revokeClientReportShares,
} from "@/db/clientReports";
import { nodeSqliteDb } from "@/db/nodeSqlite";
import { SCHEMA_SQL } from "@/db/schema";
import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { saveWorkspaceBranding } from "@/db/proposalShares";
import type { TenantScope } from "@/db/tenant";

const NOW = new Date("2026-09-07T14:00:00.000Z");

const clientA = ClientSchema.parse({
  id: "client_a",
  name: "Northwind Heating",
  domain: "northwind.example",
  offerings: ["heat pumps"],
  notes: "",
});

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return OpportunitySchema.parse({
    id: "opp_heat",
    dedupeKey: "missing-service-page:heat pumps",
    clientId: clientA.id,
    ruleId: "missing-service-page",
    title: "Heat Pump Installation — dedicated service page",
    detected: "The site names heat pumps but has no dedicated page.",
    evidenceRefs: ["page:https://northwind.example/services"],
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
    updatedAt: NOW.toISOString(),
    ...overrides,
  });
}

async function fixture() {
  const db = nodeSqliteDb();
  await db.exec(SCHEMA_SQL);
  await createWorkspaceForOwner(db, { id: "ws_a", name: "Axiom North", ownerUserId: "owner_a" });
  await createWorkspaceForOwner(db, { id: "ws_b", name: "Other Agency", ownerUserId: "owner_b" });
  const scopeA: TenantScope = { db, workspaceId: "ws_a" };
  const scopeB: TenantScope = { db, workspaceId: "ws_b" };
  await repo.upsertService(scopeA, {
    id: "svc_page",
    name: "Service landing page",
    description: "",
    priceMin: 900,
    priceMax: 1800,
    tags: ["landing-page"],
    active: true,
  });
  await repo.upsertClient(scopeA, clientA);
  await saveWorkspaceBranding(scopeA, { reportTheme: "editorial" });
  const source = opportunity();
  await repo.saveAnalysis(scopeA, [source]);
  const candidates = buildReportCandidates({
    client: clientA,
    opportunities: [source],
    latestRun: { outcome: "findings", finishedAt: NOW.toISOString(), limitation: null },
  });
  const key = candidates.commercial[0]!.key;
  const snapshot = buildClientReportSnapshot({
    workspaceId: "ws_a",
    createdByUserId: "owner_a",
    client: clientA,
    agency: { name: "Axiom North", logo: null, theme: "editorial" },
    preparedBy: "Avery Owner",
    generatedAt: NOW.toISOString(),
    evidenceReviewedAt: NOW.toISOString(),
    candidates,
    selection: {
      selectedKeys: [key],
      orderedKeys: [key],
      showUnderlyingValue: true,
    },
  });
  return { db, scopeA, scopeB, source, snapshot };
}

describe("client report persistence", () => {
  it("creates a tenant-scoped immutable snapshot and denies cross-tenant creation/read", async () => {
    const { db, scopeA, scopeB, snapshot } = await fixture();
    try {
      const created = await createClientReport(scopeA, {
        clientId: clientA.id,
        createdByUserId: "owner_a",
        snapshot,
      });
      expect(created.snapshot).toEqual(snapshot);
      expect(await getClientReportById(scopeA, created.reportId)).toEqual(created);
      expect(await getClientReportById(scopeB, created.reportId)).toBeNull();
      await expect(
        createClientReport(scopeB, {
          clientId: clientA.id,
          createdByUserId: "owner_b",
          snapshot,
        }),
      ).rejects.toThrow(/not found|workspace/i);
    } finally {
      db.close();
    }
  });

  it("keeps source facts and branding frozen after the source rows change", async () => {
    const { db, scopeA, snapshot } = await fixture();
    try {
      const created = await createClientReport(scopeA, {
        clientId: clientA.id,
        createdByUserId: "owner_a",
        snapshot,
      });
      await repo.saveOpportunityProposalText(scopeA, "opp_heat", "Changed after report");
      await saveWorkspaceBranding(scopeA, {
        logo: "data:image/png;base64,iVBORw0KGgo=",
        reportTheme: "signal",
      });
      await db
        .prepare("UPDATE opportunities SET price_min = ?, price_max = ?, title = ? WHERE id = ?")
        .bind(1, 2, "Changed source", "opp_heat")
        .run();

      const loaded = await getClientReportById(scopeA, created.reportId);
      expect(loaded?.snapshot.public.client.name).toBe("Northwind Heating");
      expect(loaded?.snapshot.public.agency.logo).toBeNull();
      expect(loaded?.snapshot.public.agency.theme).toBe("editorial");
      expect(loaded?.snapshot.public.recommendedProjects[0]?.findings[0]?.title).toContain(
        "Heat Pump",
      );
      expect(loaded?.snapshot.public.recommendedProjects[0]?.underlyingOpportunityValue).toEqual({
        min: 900,
        max: 1800,
      });
      expect(loaded?.snapshot.public.recommendedProjects[0]?.findings[0]?.evidence[0]?.url).toBe(
        "https://northwind.example/services",
      );
      expect(loaded?.snapshot.audit.includedOpportunities[0]?.priceMin).toBe(900);
      expect(loaded?.snapshot.audit.includedOpportunities[0]?.status).toBe("new");
    } finally {
      db.close();
    }
  });

  it("refuses a report when an included source becomes inconclusive before save", async () => {
    const { db, scopeA, snapshot } = await fixture();
    try {
      await db
        .prepare("UPDATE opportunities SET verification = ? WHERE id = ?")
        .bind(
          JSON.stringify({
            conclusion: "inconclusive",
            inspectedUrls: [],
            closeMatches: [],
            reason: "The page could not be checked far enough.",
          }),
          "opp_heat",
        )
        .run();
      await expect(
        createClientReport(scopeA, {
          clientId: clientA.id,
          createdByUserId: "owner_a",
          snapshot,
        }),
      ).rejects.toThrow(/eligible|inconclusive/i);
    } finally {
      db.close();
    }
  });
});

describe("client report share links", () => {
  it("uses a 256-bit token, stores only its digest, and serves only the public projection", async () => {
    const { db, scopeA, snapshot } = await fixture();
    try {
      const report = await createClientReport(scopeA, {
        clientId: clientA.id,
        createdByUserId: "owner_a",
        snapshot,
      });
      const created = await createClientReportShare(scopeA, report.reportId, {
        actingUserId: "owner_a",
        now: NOW,
      });
      expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const stored = await db
        .prepare("SELECT token_hash FROM client_report_shares WHERE id = ?")
        .bind(created.shareId)
        .first<{ token_hash: string }>();
      expect(stored?.token_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(stored?.token_hash).not.toContain(created.token);

      const publicShare = await getClientReportShareByToken(scopeA.db, created.token, NOW);
      expect(publicShare?.snapshot).toEqual(snapshot.public);
      expect(JSON.stringify(publicShare?.snapshot)).not.toContain("opp_heat");
      expect(JSON.stringify(publicShare?.snapshot)).not.toContain("ws_a");
      expect(JSON.stringify(publicShare?.snapshot)).not.toContain("ruleId");
    } finally {
      db.close();
    }
  });

  it("rejects invalid and expired tokens, and revocation is owner-only", async () => {
    const { db, scopeA, snapshot } = await fixture();
    try {
      const report = await createClientReport(scopeA, {
        clientId: clientA.id,
        createdByUserId: "owner_a",
        snapshot,
      });
      const created = await createClientReportShare(scopeA, report.reportId, {
        actingUserId: "owner_a",
        now: NOW,
      });
      expect(await getClientReportShareByToken(scopeA.db, "not-a-token", NOW)).toBeNull();
      expect(
        await getClientReportShareByToken(
          scopeA.db,
          created.token,
          new Date(NOW.getTime() + CLIENT_REPORT_SHARE_TTL_MS),
        ),
      ).toBeNull();
      await expect(
        revokeClientReportShares(scopeA, report.reportId, {
          actingUserId: "member_a",
          now: NOW,
        }),
      ).rejects.toThrow(/owner/i);
      expect(
        await revokeClientReportShares(scopeA, report.reportId, {
          actingUserId: "owner_a",
          now: NOW,
        }),
      ).toBe(1);
      expect(await getClientReportShareByToken(scopeA.db, created.token, NOW)).toBeNull();
    } finally {
      db.close();
    }
  });
});

/**
 * A saved report has to still be there tomorrow.
 *
 * The audit created a report, shared it, refreshed the page, and watched the
 * revoke control disappear — the share callout was rendered from the POST's
 * action data, so the only route to revocation was the browser tab that had
 * created the link. The report itself had no route back at all: client detail
 * offered `Create report` and nothing else, so a saved document was effectively
 * write-only. The public link, meanwhile, stayed live.
 *
 * These projections are the fix, and they are deliberately narrow: what exists,
 * how many links are live, and when the soonest one lapses. The raw token is
 * never persisted and never recoverable — a replacement link is the only way
 * back to a URL, which is the property that makes revocation mean something.
 */
describe("saved report and share projections", () => {
  it("lists a client's saved reports newest first and keeps them inside the workspace", async () => {
    const { db, scopeA, scopeB, snapshot } = await fixture();

    const older = await createClientReport(scopeA, {
      clientId: clientA.id,
      createdByUserId: "owner_a",
      snapshot,
    });
    const newerSnapshot = {
      ...snapshot,
      public: { ...snapshot.public, generatedAt: "2026-09-08T09:30:00.000Z" },
    };
    const newer = await createClientReport(scopeA, {
      clientId: clientA.id,
      createdByUserId: "owner_a",
      snapshot: newerSnapshot,
    });

    const summaries = await listClientReportSummaries(scopeA, clientA.id, NOW);

    expect(summaries.map((report) => report.reportId)).toEqual([newer.reportId, older.reportId]);
    expect(summaries[0]?.generatedAt).toBe("2026-09-08T09:30:00.000Z");
    expect(summaries[0]?.recommendedProjectCount).toBe(
      snapshot.public.recommendedProjects.length,
    );
    expect(summaries[0]?.supportingProjectCount).toBe(snapshot.public.supportingProjects.length);
    expect(summaries[0]?.activeShareCount).toBe(0);
    expect(summaries[0]?.nearestActiveShareExpiresAt).toBeNull();

    // Another agency's workspace can see none of it, by the same scoping the
    // report read itself uses.
    expect(await listClientReportSummaries(scopeB, clientA.id, NOW)).toEqual([]);
    expect(await listActiveClientReportShares(scopeB, newer.reportId, NOW)).toEqual([]);
    expect(db).toBeDefined();
  });

  it("counts only live links, reports the nearest expiry, and never returns a token", async () => {
    const { scopeA, snapshot } = await fixture();
    const report = await createClientReport(scopeA, {
      clientId: clientA.id,
      createdByUserId: "owner_a",
      snapshot,
    });

    // Already lapsed: created 40 days ago, so its 30-day window closed.
    await createClientReportShare(scopeA, report.reportId, {
      actingUserId: "owner_a",
      now: new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000),
    });
    // Live, and the one that lapses first.
    const soonest = await createClientReportShare(scopeA, report.reportId, {
      actingUserId: "owner_a",
      now: new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000),
    });
    // Live, and lapses later.
    const latest = await createClientReportShare(scopeA, report.reportId, {
      actingUserId: "owner_a",
      now: NOW,
    });

    const active = await listActiveClientReportShares(scopeA, report.reportId, NOW);

    expect(active.map((share) => share.shareId)).toEqual([soonest.shareId, latest.shareId]);
    expect(active[0]?.expiresAt).toBe(soonest.expiresAt);
    expect(JSON.stringify(active)).not.toContain(soonest.token);
    expect(JSON.stringify(active)).not.toContain(latest.token);
    expect(JSON.stringify(active)).not.toContain("token_hash");

    const [summary] = await listClientReportSummaries(scopeA, clientA.id, NOW);
    expect(summary?.activeShareCount).toBe(2);
    expect(summary?.nearestActiveShareExpiresAt).toBe(soonest.expiresAt);

    // Revocation empties both projections, which is what the client page and
    // the private report both read to decide what to offer.
    await revokeClientReportShares(scopeA, report.reportId, { actingUserId: "owner_a", now: NOW });
    expect(await listActiveClientReportShares(scopeA, report.reportId, NOW)).toEqual([]);
    const [afterRevoke] = await listClientReportSummaries(scopeA, clientA.id, NOW);
    expect(afterRevoke?.activeShareCount).toBe(0);
    expect(afterRevoke?.nearestActiveShareExpiresAt).toBeNull();
  });
});
