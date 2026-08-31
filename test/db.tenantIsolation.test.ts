import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { CrossWorkspaceError, type TenantScope } from "@/db/tenant";
import {
  ClientSchema,
  EvidenceBundleSchema,
  OpportunitySchema,
  ServiceSchema,
  type EvidenceBundle,
  type Opportunity,
} from "@/core/schema";

let db: NodeSqliteDb;
let A: TenantScope;
let B: TenantScope;

const svc = (id: string) =>
  ServiceSchema.parse({
    id,
    name: id,
    description: "",
    priceMin: 100,
    priceMax: 200,
    tags: ["landing-page"],
    active: true,
  });
const cli = (id: string) =>
  ClientSchema.parse({ id, name: id, domain: `${id}.example`, offerings: ["x"], notes: "" });

function bundleFor(clientId: string): EvidenceBundle {
  return EvidenceBundleSchema.parse({
    clientId,
    source: "fixture",
    capturedAt: "2026-08-31T00:00:00.000Z",
    site: { pages: [], nav: [], links: [], sitemapUrls: [] },
  });
}

function oppFor(clientId: string, serviceId: string, id = "opp_x"): Opportunity {
  return OpportunitySchema.parse({
    id,
    dedupeKey: `${clientId}-k`,
    clientId,
    ruleId: "missing-service-page",
    title: "T",
    detected: "d",
    evidenceRefs: [],
    rationale: "r",
    suggestedServiceId: serviceId,
    suggestedScope: [],
    priceMin: 100,
    priceMax: 200,
    confidence: 0.8,
    billableStatus: "billable",
    status: "new",
    updatedAt: "2026-08-31T00:00:00.000Z",
  });
}

async function dump(t: TenantScope) {
  return {
    services: await repo.listServices(t),
    clients: await repo.listClients(t),
    coverage: await repo.listCoverage(t, "cli_b"),
    evidence: await repo.getLatestEvidence(t, "cli_b"),
    opps: await repo.listOpportunities(t, "cli_b"),
  };
}

beforeEach(async () => {
  db = nodeSqliteDb(":memory:");
  await repo.applySchema(db);
  await createWorkspaceForOwner(db, { id: "ws_a", name: "A", ownerUserId: "u_a" });
  await createWorkspaceForOwner(db, { id: "ws_b", name: "B", ownerUserId: "u_b" });
  A = { db, workspaceId: "ws_a" };
  B = { db, workspaceId: "ws_b" };

  await repo.upsertService(A, svc("svc_a"));
  await repo.upsertClient(A, cli("cli_a"));
  await repo.upsertService(B, svc("svc_b"));
  await repo.upsertClient(B, cli("cli_b"));
  await repo.setCoverage(B, "cli_b", "svc_b", "B note");
  await repo.saveEvidence(B, bundleFor("cli_b"));
  await repo.saveAnalysis(B, [oppFor("cli_b", "svc_b", "opp_b")]);
});

afterEach(() => db.close());

describe("tenant isolation — reads", () => {
  it("list* only ever returns the caller's workspace", async () => {
    expect((await repo.listServices(A)).map((s) => s.id)).toEqual(["svc_a"]);
    expect((await repo.listClients(A)).map((c) => c.id)).toEqual(["cli_a"]);
    expect(await repo.listOpportunities(A, "cli_b")).toEqual([]);
    expect(await repo.listCoverage(A, "cli_b")).toEqual([]);
  });

  it("get* returns null for another workspace's id (indistinguishable from absent)", async () => {
    expect(await repo.getService(A, "svc_b")).toBeNull();
    expect(await repo.getClient(A, "cli_b")).toBeNull();
    expect(await repo.getOpportunity(A, "opp_b")).toBeNull();
    expect(await repo.getLatestEvidence(A, "cli_b")).toBeNull();
  });
});

describe("tenant isolation — writes leave B untouched and create no invalid A-side row", () => {
  it("upsertService with B's id throws and does not touch B's service", async () => {
    const before = await dump(B);
    await expect(repo.upsertService(A, { ...svc("svc_b"), name: "hijacked" })).rejects.toBeInstanceOf(
      CrossWorkspaceError,
    );
    expect((await repo.getService(B, "svc_b"))?.name).toBe("svc_b");
    expect(await dump(B)).toEqual(before);
    expect((await repo.listServices(A)).map((s) => s.id)).toEqual(["svc_a"]);
  });

  it("upsertClient with B's id throws and does not touch B's client", async () => {
    await expect(repo.upsertClient(A, { ...cli("cli_b"), name: "hijacked" })).rejects.toBeInstanceOf(
      CrossWorkspaceError,
    );
    expect((await repo.getClient(B, "cli_b"))?.name).toBe("cli_b");
    expect((await repo.listClients(A)).map((c) => c.id)).toEqual(["cli_a"]);
  });

  it("setServiceActive on B's service is a no-op and returns false", async () => {
    expect(await repo.setServiceActive(A, "svc_b", false)).toBe(false);
    expect((await repo.getService(B, "svc_b"))?.active).toBe(true);
  });

  it("setCoverage(A, bClientId, ...) rejected; no A-side coverage row created", async () => {
    const before = await dump(B);
    expect(await repo.setCoverage(A, "cli_b", "svc_a")).toBe(false);
    expect(await dump(B)).toEqual(before);
    const rows = await db
      .prepare("SELECT count(*) AS c FROM client_coverage WHERE client_id = 'cli_b'")
      .first<{ c: number }>();
    expect(rows?.c).toBe(1); // still just B's own row
  });

  it("setCoverage(A, aClientId, bServiceId) rejected (service not in A)", async () => {
    expect(await repo.setCoverage(A, "cli_a", "svc_b")).toBe(false);
    const rows = await db
      .prepare(
        "SELECT count(*) AS c FROM client_coverage WHERE client_id = 'cli_a' OR workspace_id = 'ws_a'",
      )
      .first<{ c: number }>();
    expect(rows?.c).toBe(0); // nothing created on A's side
    expect(await repo.listCoverage(A, "cli_a")).toEqual([]);
  });

  it("removeCoverage on B's coverage from A is a no-op and returns false", async () => {
    expect(await repo.removeCoverage(A, "cli_b", "svc_b")).toBe(false);
    expect(await repo.listCoverage(B, "cli_b")).toHaveLength(1);
  });

  it("saveEvidence(A, evidenceForBClient) throws; B's evidence unchanged; no A-side row", async () => {
    await expect(repo.saveEvidence(A, bundleFor("cli_b"))).rejects.toBeInstanceOf(CrossWorkspaceError);
    expect((await repo.getLatestEvidence(B, "cli_b"))?.clientId).toBe("cli_b");
    const rows = await db
      .prepare("SELECT count(*) AS c FROM evidence_bundles WHERE client_id = 'cli_b'")
      .first<{ c: number }>();
    expect(rows?.c).toBe(1);
  });

  it("saveAnalysis(A, opportunityForBClient) throws; B's opportunity unchanged; no A-side row", async () => {
    const before = await dump(B);
    await expect(repo.saveAnalysis(A, [oppFor("cli_b", "svc_a", "opp_hijack")])).rejects.toBeInstanceOf(
      CrossWorkspaceError,
    );
    expect(await dump(B)).toEqual(before);
    const rows = await db
      .prepare("SELECT count(*) AS c FROM opportunities WHERE client_id = 'cli_b'")
      .first<{ c: number }>();
    expect(rows?.c).toBe(1);
  });

  it("setOpportunityStatus / setOpportunityProposal on B's opp from A -> false, unchanged", async () => {
    expect(await repo.setOpportunityStatus(A, "opp_b", "dismissed")).toBe(false);
    expect(await repo.setOpportunityProposal(A, "opp_b", "hi")).toBe(false);
    const stored = await repo.getOpportunity(B, "opp_b");
    expect(stored?.status).toBe("new");
    expect(stored?.proposalMd).toBeUndefined();
  });
});

describe("workspace lookup", () => {
  it("getWorkspaceForUser returns only the caller's workspace", async () => {
    const { getWorkspaceForUser } = await import("@/db/workspaces");
    expect((await getWorkspaceForUser(db, "u_a"))?.id).toBe("ws_a");
    expect((await getWorkspaceForUser(db, "u_b"))?.id).toBe("ws_b");
    expect(await getWorkspaceForUser(db, "u_nobody")).toBeNull();
  });
});
