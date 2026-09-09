import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import type { TenantScope } from "@/db/tenant";
import { hvacCatalog, hvacClient, hvacEvidence } from "./helpers/fixtures";

let db: NodeSqliteDb;
let t: TenantScope;

beforeEach(async () => {
  db = nodeSqliteDb(":memory:");
  await repo.applySchema(db);
  await createWorkspaceForOwner(db, { id: "ws_test", name: "Test", ownerUserId: "u1" });
  t = { db, workspaceId: "ws_test" };
});

afterEach(() => db.close());

describe("tenant repositories", () => {
  it("round-trips services and toggles active", async () => {
    for (const s of hvacCatalog()) await repo.upsertService(t, s);
    expect((await repo.listServices(t)).map((s) => s.id).sort()).toEqual(
      ["svc-brand-refresh", "svc-conversion-fix", "svc-landing-page", "svc-seo-retainer"],
    );

    expect(await repo.setServiceActive(t, "svc-brand-refresh", false)).toBe(true);
    expect((await repo.getService(t, "svc-brand-refresh"))?.active).toBe(false);

    const updated = { ...hvacCatalog()[0]!, priceMax: 1800 };
    await repo.upsertService(t, updated);
    expect((await repo.getService(t, "svc-landing-page"))?.priceMax).toBe(1800);
    expect(await repo.listServices(t)).toHaveLength(4);
  });

  it("saves a reviewed service catalog as one atomic batch", async () => {
    await repo.upsertServicesAtomic(t, hvacCatalog().slice(0, 3));

    expect((await repo.listServices(t)).map((service) => service.id).sort()).toEqual([
      "svc-brand-refresh",
      "svc-landing-page",
      "svc-seo-retainer",
    ]);
  });

  it("does not partially save when any generated service is invalid", async () => {
    const services = hvacCatalog().slice(0, 2);
    services[1] = { ...services[1]!, priceMin: 2000, priceMax: 1000 };

    await expect(repo.upsertServicesAtomic(t, services)).rejects.toThrow(/priceMax/);
    expect(await repo.listServices(t)).toEqual([]);
  });

  it("does not partially save when an id belongs to another workspace", async () => {
    await createWorkspaceForOwner(db, { id: "ws_other", name: "Other", ownerUserId: "u2" });
    const other = { db, workspaceId: "ws_other" };
    await repo.upsertService(other, hvacCatalog()[1]!);

    await expect(repo.upsertServicesAtomic(t, hvacCatalog().slice(0, 2))).rejects.toThrow(
      /another workspace/,
    );
    expect(await repo.listServices(t)).toEqual([]);
  });

  it("round-trips a client and its coverage", async () => {
    for (const s of hvacCatalog()) await repo.upsertService(t, s);
    await repo.upsertClient(t, hvacClient());

    expect(await repo.setCoverage(t, "client-coolbreeze", "svc-landing-page", "retainer")).toBe(true);
    let coverage = await repo.listCoverage(t, "client-coolbreeze");
    expect(coverage).toHaveLength(1);
    expect(coverage[0]?.serviceId).toBe("svc-landing-page");

    expect(await repo.removeCoverage(t, "client-coolbreeze", "svc-landing-page")).toBe(true);
    coverage = await repo.listCoverage(t, "client-coolbreeze");
    expect(coverage).toHaveLength(0);
  });

  it("setCoverage refuses a client or service that is not in the workspace", async () => {
    for (const s of hvacCatalog()) await repo.upsertService(t, s);
    await repo.upsertClient(t, hvacClient());
    expect(await repo.setCoverage(t, "no-such-client", "svc-landing-page")).toBe(false);
    expect(await repo.setCoverage(t, "client-coolbreeze", "no-such-service")).toBe(false);
  });

  it("stores and returns the latest evidence bundle", async () => {
    await repo.upsertClient(t, hvacClient());
    await repo.saveEvidence(t, hvacEvidence());
    const latest = await repo.getLatestEvidence(t, "client-coolbreeze");
    expect(latest?.source).toBe("fixture");
    expect(latest?.site.pages.length).toBe(6);
  });
});
