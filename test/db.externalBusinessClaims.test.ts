import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { importOfficialBusinessProfile } from "@/core/externalBusinessEvidence";
import { ClientSchema } from "@/core/schema";
import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import type { TenantScope } from "@/db/tenant";

let db: NodeSqliteDb;
let a: TenantScope;
let b: TenantScope;

beforeEach(async () => {
  db = nodeSqliteDb(":memory:");
  await repo.applySchema(db);
  await createWorkspaceForOwner(db, { id: "ws-a", name: "A", ownerUserId: "u-a" });
  await createWorkspaceForOwner(db, { id: "ws-b", name: "B", ownerUserId: "u-b" });
  a = { db, workspaceId: "ws-a" };
  b = { db, workspaceId: "ws-b" };
  await repo.upsertClient(
    a,
    ClientSchema.parse({ id: "client-a", name: "A", domain: "a.example", offerings: [] }),
  );
  await repo.upsertClient(
    b,
    ClientSchema.parse({ id: "client-b", name: "B", domain: "b.example", offerings: [] }),
  );
});

afterEach(() => db.close());

describe("external business claim persistence", () => {
  it("stores claims with tenant scope and never exposes another workspace's rows", async () => {
    const imported = importOfficialBusinessProfile(
      { workspaceId: "ws-a", clientId: "client-a" },
      {
        provider: "google-business-profile-export",
        sourceRecordId: "location-a",
        sourceUrl: "https://business.google.com/locations/location-a",
        authorization: "owner-authorized-export",
        sourceField: "services",
        observedAt: "2026-09-07T12:00:00.000Z",
        retrievedAt: "2026-09-07T12:05:00.000Z",
        services: ["Drain Cleaning"],
      },
      new Date("2026-09-07T13:00:00.000Z"),
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    await repo.saveExternalBusinessClaims(a, imported.claims);

    expect(await repo.listExternalBusinessClaims(a, "client-a")).toHaveLength(1);
    expect(await repo.listExternalBusinessClaims(b, "client-a")).toEqual([]);
    expect(await repo.listExternalBusinessClaims(a, "client-b")).toEqual([]);
  });

  it("rejects a cross-workspace write", async () => {
    const imported = importOfficialBusinessProfile(
      { workspaceId: "ws-a", clientId: "client-a" },
      {
        provider: "google-business-profile-export",
        sourceRecordId: "location-a",
        sourceUrl: "https://business.google.com/locations/location-a",
        authorization: "owner-authorized-export",
        sourceField: "services",
        observedAt: "2026-09-07T12:00:00.000Z",
        retrievedAt: "2026-09-07T12:05:00.000Z",
        services: ["Drain Cleaning"],
      },
      new Date("2026-09-07T13:00:00.000Z"),
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    await expect(repo.saveExternalBusinessClaims(b, imported.claims)).rejects.toThrow(
      /cross-workspace/i,
    );
  });

  it("revalidates official provenance at the repository boundary", async () => {
    const imported = importOfficialBusinessProfile(
      { workspaceId: "ws-a", clientId: "client-a" },
      {
        provider: "google-business-profile-export",
        sourceRecordId: "location-a",
        sourceUrl: "https://business.google.com/locations/location-a",
        authorization: "owner-authorized-export",
        sourceField: "services",
        observedAt: "2026-09-07T12:00:00.000Z",
        retrievedAt: "2026-09-07T12:05:00.000Z",
        services: ["Drain Cleaning"],
      },
      new Date("2026-09-07T13:00:00.000Z"),
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    const forged = { ...imported.claims[0]!, sourceUrl: "https://example.com/profile" };
    await expect(repo.saveExternalBusinessClaims(a, [forged])).rejects.toThrow(/official profile/i);
  });

  it("is idempotent for the same claim but rejects a generated-ID collision", async () => {
    const first = importOfficialBusinessProfile(
      { workspaceId: "ws-a", clientId: "client-a" },
      {
        provider: "google-business-profile-export",
        sourceRecordId: "location-a",
        sourceUrl: "https://business.google.com/locations/location-a",
        authorization: "owner-authorized-export",
        sourceField: "services",
        observedAt: "2026-09-07T12:00:00.000Z",
        retrievedAt: "2026-09-07T12:05:00.000Z",
        services: ["Drain Cleaning"],
      },
      new Date("2026-09-07T13:00:00.000Z"),
    );
    const second = importOfficialBusinessProfile(
      { workspaceId: "ws-a", clientId: "client-a" },
      {
        provider: "google-business-profile-export",
        sourceRecordId: "location-a",
        sourceUrl: "https://business.google.com/locations/location-a",
        authorization: "owner-authorized-export",
        sourceField: "services",
        observedAt: "2026-09-07T12:00:00.000Z",
        retrievedAt: "2026-09-07T12:05:00.000Z",
        services: ["Boiler Repair"],
      },
      new Date("2026-09-07T13:00:00.000Z"),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    await repo.saveExternalBusinessClaims(a, first.claims);
    await repo.saveExternalBusinessClaims(a, first.claims);
    const collision = { ...second.claims[0]!, id: first.claims[0]!.id };
    await expect(repo.saveExternalBusinessClaims(a, [collision])).rejects.toThrow(/collision/i);
  });
});
