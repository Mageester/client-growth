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
  now = "2026-09-07T00:00:00.000Z",
) {
  return buildActionCenter(
    {
      clients,
      opportunitiesByClient: new Map(
        clients.map((c) => [c.id, rows.filter((row) => row.clientId === c.id)]),
      ),
      latestRunsByClient: new Map(runs),
    },
    new Date(now),
  );
}

describe("agency action center", () => {
  it("returns a quiet empty workspace without manufacturing work", () => {
    const result = center([], []);

    expect(result.primary).toEqual([]);
    expect(result.attention).toEqual([]);
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

    expect(result.primary).toEqual([]);
    expect(result.attention).toEqual([]);
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

    expect(result.primary.map((item) => item.kind)).toEqual(["commercial", "site-health"]);
    expect(result.primary[0]?.client.name).toBe("commercial");
  });

  it("keeps progressed site-health work below commercial work without hiding it", () => {
    const result = center(
      [client("health"), client("commercial")],
      [
        opportunity({
          id: "health-accepted",
          clientId: "health",
          ruleId: "missing-meta-description",
          title: "Meta description repair",
          status: "accepted",
        }),
        opportunity({ id: "commercial-new", clientId: "commercial", priceMax: 900 }),
      ],
    );

    expect(result.primary.map((item) => item.client.id)).toEqual(["commercial", "health"]);
    expect(result.primary[1]?.stage).toBe("accepted");
  });

  it("puts proposal-ready and accepted revenue work ahead of an analysis retry", () => {
    const result = center(
      [client("accepted"), client("proposal"), client("retry")],
      [
        opportunity({ clientId: "accepted", status: "accepted" }),
        opportunity({ clientId: "proposal", status: "proposal_prepared" }),
      ],
      [[
        "retry",
        run({ clientId: "retry", outcome: "inconclusive", summary: "The site timed out." }),
      ]],
    );

    expect(result.primary.map((item) => item.client.id)).toEqual(["proposal", "accepted"]);
    expect(result.attention.map((item) => item.client.id)).toEqual(["retry"]);
    expect(result.primary[0]?.action).toMatch(/send the draft/i);
    expect(result.primary[1]?.action).toMatch(/prepare a proposal/i);
    expect(result.pipeline.newCount).toBe(0);
    expect(result.pipeline.acceptedCount).toBe(2);
  });

  it("places a sufficiently old unresolved pitch after current revenue actions", () => {
    const result = center(
      [client("accepted"), client("pitched")],
      [
        opportunity({ clientId: "accepted", status: "accepted" }),
        opportunity({
          clientId: "pitched",
          status: "pitched",
          pitchedAt: "2026-09-03T00:00:00.000Z",
        }),
      ],
    );

    expect(result.primary.map((item) => item.client.id)).toEqual(["accepted", "pitched"]);
    expect(result.primary[1]?.stage).toBe("pitched");
    expect(result.primary[1]?.action).toMatch(/follow up with client/i);
    expect(result.pipeline.pitchedCount).toBe(1);
  });

  it("does not present a freshly pitched opportunity as follow-up due", () => {
    const result = center(
      [client("fresh")],
      [
        opportunity({
          clientId: "fresh",
          status: "pitched",
          pitchedAt: "2026-09-06T00:00:00.000Z",
        }),
      ],
    );

    expect(result.primary).toEqual([]);
    expect(result.attention).toEqual([]);
  });

  it("does not present sold or lost pitched work as follow-up due", () => {
    const result = center(
      [client("closed")],
      [
        opportunity({
          id: "sold-pitched",
          clientId: "closed",
          status: "sold",
          pitchedAt: "2026-08-20T00:00:00.000Z",
          soldAmount: 1200,
        }),
        opportunity({
          id: "lost-pitched",
          clientId: "closed",
          status: "lost",
          pitchedAt: "2026-08-20T00:00:00.000Z",
        }),
      ],
      [["closed", run({ clientId: "closed" })]],
    );

    expect(result.primary).toEqual([]);
    expect(result.attention).toEqual([]);
  });

  it("uses the most advanced stage when one family has mixed open rows", () => {
    const result = center(
      [client("mixed")],
      [
        opportunity({ id: "new-high-value", clientId: "mixed", priceMax: 9000, status: "new" }),
        opportunity({ id: "accepted", clientId: "mixed", priceMax: 900, status: "accepted" }),
      ],
    );

    expect(result.primary[0]?.stage).toBe("accepted");
    expect(result.primary[0]?.action).toMatch(/prepare a proposal/i);
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

    expect(result.primary).toHaveLength(0);
    expect(result.attention).toHaveLength(0);
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

    expect(result.primary).toHaveLength(0);
    expect(result.attention).toHaveLength(1);
    expect(result.attention[0]).toMatchObject({ kind: "analysis", client: { id: "artfully" } });
    expect(result.attention[0]?.title).toMatch(/analysis/i);
    expect(result.attention[0]?.action).toMatch(/retry/i);
    expect(result.pipeline.openCount).toBe(0);
  });

  it("keeps a never-analyzed client useful without inventing an opportunity", () => {
    const result = center([client("new-client", "New Client")], []);

    expect(result.primary).toHaveLength(0);
    expect(result.attention).toHaveLength(1);
    expect(result.attention[0]).toMatchObject({ kind: "analysis", client: { id: "new-client" } });
    expect(result.attention[0]?.action).toMatch(/first analysis/i);
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

    expect(result.primary).toHaveLength(1);
    expect(result.primary[0]?.count).toBe(2);
    expect(result.primary[0]?.opportunityIds).toEqual(["service-2", "service-1"]);
    expect(result.primary[0]?.priceMax).toBe(3600);
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
