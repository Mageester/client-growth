import { describe, expect, it } from "vitest";

import { ClientSchema, OpportunitySchema, type Opportunity } from "@/core/schema";
import { buildClientReportSnapshot, buildReportCandidates } from "@/core/clientReport";
import {
  CLIENT_REPORT_SHARE_TTL_MS,
  createClientReport,
  createClientReportShare,
  getClientReportById,
  getClientReportShareByToken,
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
