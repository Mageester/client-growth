import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compareWithCompetitors } from "../app/lib/competitors.server";
import {
  addCompetitor,
  listCompetitors,
  removeCompetitor,
  CompetitorError,
  MAX_COMPETITORS_PER_CLIENT,
} from "@/db/competitors";
import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { CrossWorkspaceError, type TenantScope } from "@/db/tenant";
import {
  ClientSchema,
  EvidenceBundleSchema,
  ServiceSchema,
  type EvidenceBundle,
} from "@/core/schema";

const NOW = new Date("2026-09-06T12:00:00.000Z");
const ENV = { AI_PROVIDER: "mock", MAX_AI_CALLS_PER_RUN: "10" };

function siteWith(domain: string, services: string[]): EvidenceBundle {
  const origin = `https://${domain}`;
  const slug = (s: string) => s.toLowerCase().replace(/\s+/g, "-");
  return EvidenceBundleSchema.parse({
    clientId: domain,
    source: "http",
    capturedAt: NOW.toISOString(),
    site: {
      pages: [
        { url: `${origin}/`, status: 200, title: domain, h1s: [domain], headings: [], textExcerpt: "", wordCount: 500 },
        ...services.map((service) => ({
          url: `${origin}/services/${slug(service)}`,
          status: 200,
          title: service,
          h1s: [service],
          headings: [],
          textExcerpt: "",
          wordCount: 500,
        })),
      ],
      links: services.map((service) => ({
        href: `${origin}/services/${slug(service)}`,
        label: service,
        scheme: "http",
        inNav: true,
        foundOn: [`${origin}/`],
      })),
      crawlExhaustive: true,
    },
  });
}

let db: NodeSqliteDb;
let scope: TenantScope;

async function seed(options: { withCatalogTag?: boolean } = {}) {
  await repo.upsertClient(
    scope,
    ClientSchema.parse({
      id: "cli_1",
      name: "Client",
      domain: "client.example",
      offerings: ["Drain cleaning"],
    }),
  );
  if (options.withCatalogTag !== false) {
    await repo.upsertService(
      scope,
      ServiceSchema.parse({
        id: "svc_gap",
        name: "Competitor Gap Page",
        description: "",
        priceMin: 900,
        priceMax: 1800,
        tags: ["competitor-gap"],
        active: true,
      }),
    );
  }
  await repo.saveEvidence(scope, {
    ...siteWith("client.example", ["Drain cleaning"]),
    clientId: "cli_1",
  });
}

/** Crawl stub: every named domain returns a site with the listed services. */
function crawlFrom(map: Record<string, string[] | null>) {
  return async (domain: string) => {
    const services = map[domain];
    return services === null || services === undefined ? null : siteWith(domain, services);
  };
}

beforeEach(async () => {
  db = nodeSqliteDb(":memory:");
  await repo.applySchema(db);
  await createWorkspaceForOwner(db, { id: "ws_a", name: "A", ownerUserId: "u_a" });
  scope = { db, workspaceId: "ws_a" };
});

afterEach(() => db.close());

describe("recording competitors", () => {
  beforeEach(seed);

  it("stores and lists them per client", async () => {
    await addCompetitor(scope, {
      clientId: "cli_1",
      name: "Rival One",
      domain: "Rival-One.example",
      clientDomain: "client.example",
      now: NOW,
    });
    const stored = await listCompetitors(scope, "cli_1");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.domain).toBe("rival-one.example");
  });

  it("refuses the client's own site", async () => {
    await expect(
      addCompetitor(scope, {
        clientId: "cli_1",
        name: "Self",
        domain: "client.example",
        clientDomain: "client.example",
      }),
    ).rejects.toBeInstanceOf(CompetitorError);
  });

  it("refuses a duplicate and refuses to exceed the cap", async () => {
    for (let i = 0; i < MAX_COMPETITORS_PER_CLIENT; i += 1) {
      await addCompetitor(scope, {
        clientId: "cli_1",
        name: `R${i}`,
        domain: `rival-${i}.example`,
        clientDomain: "client.example",
      });
    }
    await expect(
      addCompetitor(scope, {
        clientId: "cli_1",
        name: "One more",
        domain: "rival-extra.example",
        clientDomain: "client.example",
      }),
    ).rejects.toThrow(/at most/i);

    // Remove by domain, not by position: rows created in the same millisecond
    // have no stable order, and the point here is the duplicate check.
    const stored = await listCompetitors(scope, "cli_1");
    const removed = stored.find((competitor) => competitor.domain === "rival-0.example")!;
    await removeCompetitor(scope, "cli_1", removed.id);

    await expect(
      addCompetitor(scope, {
        clientId: "cli_1",
        name: "Dup",
        domain: "rival-1.example",
        clientDomain: "client.example",
      }),
    ).rejects.toThrow(/already on the list/i);
  });

  it("cannot attach a competitor to another workspace's client", async () => {
    await createWorkspaceForOwner(db, { id: "ws_b", name: "B", ownerUserId: "u_b" });
    const foreign: TenantScope = { db, workspaceId: "ws_b" };
    await expect(
      addCompetitor(foreign, {
        clientId: "cli_1",
        name: "Rival",
        domain: "rival.example",
        clientDomain: "client.example",
      }),
    ).rejects.toBeInstanceOf(CrossWorkspaceError);
    expect(await listCompetitors(foreign, "cli_1")).toEqual([]);
  });
});

describe("comparing a client with its competitors", () => {
  beforeEach(async () => {
    await seed();
    for (const domain of ["rival-one.example", "rival-two.example"]) {
      await addCompetitor(scope, {
        clientId: "cli_1",
        name: domain,
        domain,
        clientDomain: "client.example",
        now: NOW,
      });
    }
  });

  it("writes an opportunity for a gap two competitors share", async () => {
    const result = await compareWithCompetitors(scope, ENV, "cli_1", {
      now: NOW,
      crawl: crawlFrom({
        "rival-one.example": ["Drain cleaning", "Emergency callouts"],
        "rival-two.example": ["Drain cleaning", "Emergency callouts"],
      }),
    });

    expect(result.surfaced).toBe(1);
    expect(result.gaps.map((gap) => gap.label)).toEqual(["Emergency callouts"]);

    const stored = await repo.listOpportunities(scope, "cli_1");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.ruleId).toBe("competitor-service-gap");
    expect(stored[0]!.priceMin).toBe(900);
    // The claim names who has it, so the agency can open the page on the call.
    expect(stored[0]!.detected).toContain("rival-one.example");
    expect(stored[0]!.detected).toContain("rival-two.example");
  });

  it("spends a slot from the same daily ledger as an analysis", async () => {
    await expect(
      compareWithCompetitors(scope, ENV, "cli_1", {
        now: NOW,
        dailyLimit: 0,
        crawl: crawlFrom({ "rival-one.example": [], "rival-two.example": [] }),
      }),
    ).rejects.toThrow();
    // Refused before anything was crawled or written.
    expect(await repo.listOpportunities(scope, "cli_1")).toEqual([]);
  });

  it("claims nothing when only one competitor could be read", async () => {
    const result = await compareWithCompetitors(scope, ENV, "cli_1", {
      now: NOW,
      crawl: crawlFrom({
        "rival-one.example": ["Emergency callouts"],
        "rival-two.example": null,
      }),
    });

    expect(result.surfaced).toBe(0);
    expect(result.unreadableCompetitors).toEqual(["rival-two.example"]);
    expect(result.limitation).toMatch(/no comparison is being claimed/i);
    expect(await repo.listOpportunities(scope, "cli_1")).toEqual([]);
  });

  it("says so when the catalog cannot price the work, instead of dropping it", async () => {
    await repo.upsertService(
      scope,
      ServiceSchema.parse({
        id: "svc_gap",
        name: "Competitor Gap Page",
        description: "",
        priceMin: 900,
        priceMax: 1800,
        tags: ["competitor-gap"],
        active: false,
      }),
    );

    const result = await compareWithCompetitors(scope, ENV, "cli_1", {
      now: NOW,
      crawl: crawlFrom({
        "rival-one.example": ["Emergency callouts"],
        "rival-two.example": ["Emergency callouts"],
      }),
    });

    expect(result.gaps).toHaveLength(1);
    expect(result.surfaced).toBe(0);
    expect(result.catalogGap).toMatch(/no active service/i);
  });

  it("tells the agency to record competitors before it charges them for a run", async () => {
    await repo.upsertClient(
      scope,
      ClientSchema.parse({
        id: "cli_2",
        name: "Other",
        domain: "other.example",
        offerings: ["x"],
      }),
    );

    const result = await compareWithCompetitors(scope, ENV, "cli_2", { now: NOW });
    expect(result.limitation).toMatch(/no competitors are recorded/i);
    expect(result.surfaced).toBe(0);
  });

  it("runs every gap past the judgment gate", async () => {
    const result = await compareWithCompetitors(scope, ENV, "cli_1", {
      now: NOW,
      crawl: crawlFrom({
        "rival-one.example": ["Emergency callouts", "Boiler servicing"],
        "rival-two.example": ["Emergency callouts", "Boiler servicing"],
      }),
    });

    // Two gaps, two evaluator calls. The subject came from a competitor's
    // navigation, which is no more trustworthy than an offerings box.
    expect(result.gaps).toHaveLength(2);
    expect(result.evaluatorCalls).toBe(2);
    expect(result.surfaced + result.rejected).toBe(2);
  });

  it("cannot be run against another workspace's client", async () => {
    await createWorkspaceForOwner(db, { id: "ws_b", name: "B", ownerUserId: "u_b" });
    const foreign: TenantScope = { db, workspaceId: "ws_b" };
    await expect(
      compareWithCompetitors(foreign, ENV, "cli_1", { now: NOW }),
    ).rejects.toBeInstanceOf(Response);
  });
});
