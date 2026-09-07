import { describe, expect, it } from "vitest";

import { buildActionCenter, buildRecentActivity } from "../app/lib/actionCenter";
import type { AnalysisRun } from "@/db/repositories";
import type { Client, Opportunity } from "@/core/schema";

const client = (id: string, name = id): Client => ({
  id,
  name,
  domain: `${id}.example`,
  offerings: [],
  notes: "",
});

const opportunity = (overrides: Partial<Opportunity> = {}): Opportunity => ({
  id: "opp-1",
  dedupeKey: "missing-service-page:drain-cleaning",
  clientId: "client-1",
  ruleId: "missing-service-page",
  title: "Drain cleaning page",
  detected: "A service page is missing.",
  evidenceRefs: ["https://example.com/services"],
  suppressedEvidenceRefs: [],
  rationale: "A dedicated service page gives demand somewhere useful to land.",
  suggestedServiceId: "service-1",
  suggestedScope: ["Write the service page"],
  priceMin: 900,
  priceMax: 1800,
  confidence: 0.9,
  billableStatus: "billable",
  status: "new",
  updatedAt: "2026-09-07T00:00:00.000Z",
  ...overrides,
});

const run = (overrides: Partial<AnalysisRun> = {}): AnalysisRun => ({
  id: 1,
  clientId: "client-1",
  startedAt: "2026-09-06T00:00:00.000Z",
  finishedAt: "2026-09-06T00:01:00.000Z",
  source: "manual",
  outcome: "clean",
  summary: "No new opportunity findings.",
  limitation: null,
  pagesRead: 4,
  pagesFetched: 4,
  blockedEvents: 0,
  inconclusiveEvents: 0,
  surfaced: 0,
  stats: {},
  trigger: "manual",
  newCount: 0,
  resolvedCount: 0,
  evaluatorCalls: 0,
  evaluatorRejections: 0,
  evaluatorErrors: 0,
  crawlExhaustive: true,
  suggestedOfferings: [],
  offeringDrift: [],
  ...overrides,
});

function center(
  clients: Client[],
  rows: Opportunity[],
  runs: Array<[string, AnalysisRun]> = [],
) {
  return buildActionCenter({
    clients,
    opportunitiesByClient: new Map(
      clients.map((c) => [c.id, rows.filter((row) => row.clientId === c.id)]),
    ),
    latestRunsByClient: new Map(runs),
  });
}

describe("agency action center", () => {
  it("returns a quiet empty workspace without manufacturing work", () => {
    const result = center([], []);

    expect(result.queue).toEqual([]);
    expect(result.pipeline).toMatchObject({
      newCount: 0,
      soldCount: 0,
      lostCount: 0,
      closeRate: null,
      openCount: 0,
    });
  });

  it("does not turn a successfully checked zero-finding client into an action", () => {
    const result = center([client("clean")], [], [["clean", run({ clientId: "clean" })]]);

    expect(result.queue).toEqual([]);
    expect(result.pipeline.openCount).toBe(0);
  });

  it("ranks commercial work above site-health-only work", () => {
    const result = center(
      [client("health"), client("commercial")],
      [
        opportunity({
          id: "health-opportunity",
          clientId: "health",
          ruleId: "missing-meta-description",
          title: "Meta description repair",
          priceMax: 5000,
        }),
        opportunity({ id: "commercial-opportunity", clientId: "commercial", priceMax: 900 }),
      ],
    );

    expect(result.queue.map((item) => item.kind)).toEqual(["commercial", "site-health"]);
    expect(result.queue[0]?.client.name).toBe("commercial");
  });

  it("keeps accepted, proposal-ready, and pitched work actionable", () => {
    const result = center(
      [client("accepted"), client("proposal"), client("pitched")],
      [
        opportunity({ clientId: "accepted", status: "accepted" }),
        opportunity({ clientId: "proposal", status: "proposal_prepared" }),
        opportunity({ clientId: "pitched", status: "pitched" }),
      ],
    );

    expect(result.queue.map((item) => item.client.id)).toEqual(["pitched", "proposal", "accepted"]);
    expect(result.queue[0]?.action).toMatch(/record the outcome/i);
    expect(result.queue[1]?.action).toMatch(/send the draft/i);
    expect(result.queue[2]?.action).toMatch(/prepare a proposal/i);
    expect(result.pipeline.newCount).toBe(0);
    expect(result.pipeline.acceptedCount).toBe(3);
    expect(result.pipeline.pitchedCount).toBe(1);
  });

  it("uses the most advanced stage when one family has mixed open rows", () => {
    const result = center(
      [client("mixed")],
      [
        opportunity({ id: "new-high-value", clientId: "mixed", priceMax: 9000, status: "new" }),
        opportunity({ id: "accepted", clientId: "mixed", priceMax: 900, status: "accepted" }),
      ],
    );

    expect(result.queue[0]?.stage).toBe("accepted");
    expect(result.queue[0]?.action).toMatch(/prepare a proposal/i);
  });

  it("does not turn sold, lost, or dismissed rows into new action items", () => {
    const result = center(
      [client("outcomes")],
      [
        opportunity({ id: "sold", clientId: "outcomes", status: "sold", soldAmount: 1200 }),
        opportunity({ id: "lost", clientId: "outcomes", status: "lost" }),
        opportunity({ id: "dismissed", clientId: "outcomes", status: "dismissed" }),
      ],
      [["outcomes", run({ clientId: "outcomes" })]],
    );

    expect(result.queue).toHaveLength(0);
    expect(result.pipeline.soldCount).toBe(1);
    expect(result.pipeline.lostCount).toBe(1);
    expect(result.pipeline.closeRate).toBe(0.5);
    expect(result.pipeline.soldRevenue).toBe(1200);
  });

  it("shows an inconclusive analysis as retry attention, never as a finding", () => {
    const result = center(
      [client("artfully", "Artfully You")],
      [],
      [[
        "artfully",
        run({ clientId: "artfully", outcome: "inconclusive", summary: "The origin timed out." }),
      ]],
    );

    expect(result.queue).toHaveLength(1);
    expect(result.queue[0]).toMatchObject({ kind: "analysis", client: { id: "artfully" } });
    expect(result.queue[0]?.title).toMatch(/analysis/i);
    expect(result.queue[0]?.action).toMatch(/retry/i);
    expect(result.pipeline.openCount).toBe(0);
  });

  it("keeps a never-analyzed client useful without inventing an opportunity", () => {
    const result = center([client("new-client", "New Client")], []);

    expect(result.queue).toHaveLength(1);
    expect(result.queue[0]).toMatchObject({ kind: "analysis", client: { id: "new-client" } });
    expect(result.queue[0]?.action).toMatch(/first analysis/i);
    expect(result.pipeline.openCount).toBe(0);
  });

  it("groups related family rows while retaining every underlying opportunity", () => {
    const result = center(
      [client("tri-city", "Tri City Plumbing")],
      [
        opportunity({ id: "service-1", clientId: "tri-city", title: "Drain page" }),
        opportunity({ id: "service-2", clientId: "tri-city", title: "Boiler page" }),
      ],
    );

    expect(result.queue).toHaveLength(1);
    expect(result.queue[0]?.count).toBe(2);
    expect(result.queue[0]?.opportunityIds).toEqual(["service-2", "service-1"]);
    expect(result.queue[0]?.priceMax).toBe(3600);
  });

  it("returns a null close rate until a client has decided", () => {
    const result = center(
      [client("pending")],
      [opportunity({ clientId: "pending" }), opportunity({ id: "accepted", clientId: "pending", status: "accepted" })],
    );

    expect(result.pipeline.closeRate).toBeNull();
    expect(result.pipeline.lostCount).toBe(0);
  });

  it("builds recent activity only from persisted run and funnel milestones", () => {
    const activity = buildRecentActivity({
      runs: [
        {
          id: 7,
          clientId: "client-1",
          clientName: "Cambridge Heating",
          finishedAt: "2026-09-07T10:00:00.000Z",
          outcome: "findings",
          summary: "One opportunity found.",
          newCount: 1,
          resolvedCount: 0,
          offeringDrift: ["Heat pumps"],
        },
      ],
      findings: [
        {
          id: "opp-1",
          title: "Heat pump page",
          clientId: "client-1",
          clientName: "Cambridge Heating",
          acceptedAt: "2026-09-07T09:00:00.000Z",
          proposalPreparedAt: null,
          pitchedAt: null,
          soldAt: null,
          lostAt: null,
        },
      ],
    });

    expect(activity.map((item) => item.label)).toEqual([
      "Analysis completed",
      "Opportunity accepted",
    ]);
    expect(activity[0]?.detail).toContain("Heat pumps");
  });
});
