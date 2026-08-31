import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import * as repo from "@/db/repositories";
import { hvacCatalog, hvacClient, hvacEvidence } from "./helpers/fixtures";

let db: NodeSqliteDb;

beforeEach(async () => {
  db = nodeSqliteDb(":memory:");
  await repo.applySchema(db);
});

afterEach(() => {
  db.close();
});

describe("service + client + coverage repositories", () => {
  it("round-trips services and toggles active", async () => {
    for (const s of hvacCatalog()) await repo.upsertService(db, s);
    expect((await repo.listServices(db)).map((s) => s.id).sort()).toEqual(
      ["svc-brand-refresh", "svc-conversion-fix", "svc-landing-page", "svc-seo-retainer"],
    );

    await repo.setServiceActive(db, "svc-brand-refresh", false);
    expect((await repo.getService(db, "svc-brand-refresh"))?.active).toBe(false);

    // upsert updates in place
    const updated = { ...hvacCatalog()[0]!, priceMax: 1800 };
    await repo.upsertService(db, updated);
    expect((await repo.getService(db, "svc-landing-page"))?.priceMax).toBe(1800);
    expect(await repo.listServices(db)).toHaveLength(4);
  });

  it("round-trips a client and its coverage", async () => {
    for (const s of hvacCatalog()) await repo.upsertService(db, s);
    await repo.upsertClient(db, hvacClient());

    await repo.setCoverage(db, "client-coolbreeze", "svc-landing-page", "retainer");
    let coverage = await repo.listCoverage(db, "client-coolbreeze");
    expect(coverage).toHaveLength(1);
    expect(coverage[0]?.serviceId).toBe("svc-landing-page");

    await repo.removeCoverage(db, "client-coolbreeze", "svc-landing-page");
    coverage = await repo.listCoverage(db, "client-coolbreeze");
    expect(coverage).toHaveLength(0);
  });

  it("stores and returns the latest evidence bundle", async () => {
    await repo.upsertClient(db, hvacClient());
    await repo.saveEvidence(db, hvacEvidence());
    const latest = await repo.getLatestEvidence(db, "client-coolbreeze");
    expect(latest?.source).toBe("fixture");
    expect(latest?.site.pages.length).toBe(6);
  });
});
