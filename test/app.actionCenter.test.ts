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

    // Unreviewed site health is upkeep, however large its catalog range: the
    // 5000 here is what the agency charges for the work, not a reason to call.
    expect(result.primary.map((item) => item.kind)).toEqual(["commercial"]);
    expect(result.primary[0]?.client.name).toBe("commercial");
    expect(result.maintenance.map((item) => item.kind)).toEqual(["site-health"]);
    expect(result.contactValue.max).toBe(900);
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

  it("groups related service rows into a sellable project while retaining every underlying opportunity", () => {
    const result = center(
      [client("tri-city", "Tri City Plumbing")],
      [
        opportunity({ id: "service-1", clientId: "tri-city", title: "Water Heater Repair — dedicated service page" }),
        opportunity({ id: "service-2", clientId: "tri-city", title: "Water Heater Replacement — dedicated service page" }),
        opportunity({ id: "service-3", clientId: "tri-city", title: "Tankless Water Heater — dedicated service page" }),
      ],
    );

    expect(result.primary).toHaveLength(1);
    expect(result.primary[0]?.title).toBe("Water Heater Service Expansion");
    expect(result.primary[0]?.count).toBe(3);
    expect(new Set(result.primary[0]?.opportunityIds)).toEqual(
      new Set(["service-1", "service-2", "service-3"]),
    );
    expect(result.primary[0]?.priceMax).toBe(5400);
    // Nobody has quoted this yet, so the range is named as what it is: the
    // agency's own catalog price for the work, an input to a quote.
    expect(result.primary[0]?.valueLabel).toBe("Potential quote input");
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

/**
 * A missing H1 is not a reason to call a client.
 *
 * The deployed home page led with "Clients worth contacting" and the top card
 * was a missing H1 — a fifty-dollar fix presented as the next commercial
 * conversation, with a catalog price range beside it reading as value the
 * agency could expect. An agency owner who acts on that once looks unserious to
 * their client; the audit scored it as the single most credibility-damaging
 * defect in the product.
 *
 * The boundary is the human decision that already exists. A `new` health
 * finding is maintenance. The moment the agency uses the existing positive
 * action on it — accepted, proposal prepared, pitched, sold — they have decided
 * it is worth raising, and it joins the contact queue. Nothing about how it is
 * stored changes; only where an unreviewed one is shown.
 */
describe("reviewed recommendations come before maintenance", () => {
  const healthOpportunity = (overrides: Partial<Opportunity> = {}) =>
    opportunity({
      id: "opp-h1",
      dedupeKey: "missing-h1:home",
      ruleId: "missing-h1",
      title: "Home page has no H1",
      detected: "The home page has no non-empty H1 heading.",
      priceMin: 150,
      priceMax: 400,
      ...overrides,
    });

  const centerWith = (opportunities: Opportunity[]) =>
    buildActionCenter({
      clients: [client("client-1", "Northwind Heating")],
      opportunitiesByClient: new Map([["client-1", opportunities]]),
      latestRunsByClient: new Map([["client-1", run()]]),
    });

  it("keeps an unreviewed health finding out of the contact queue", () => {
    const center = centerWith([healthOpportunity()]);

    expect(center.primary.map((item) => item.title)).not.toContain("Home page has no H1");
    expect(center.maintenance.map((item) => item.title)).toContain("Home page has no H1");
    // The queue projection stays complete for non-UI consumers.
    expect(center.queue.some((item) => item.title === "Home page has no H1")).toBe(true);
  });

  it("promotes the same finding once the agency has decided to raise it", () => {
    const center = centerWith([healthOpportunity({ status: "proposal_prepared" })]);

    expect(center.primary.map((item) => item.title)).toContain("Home page has no H1");
    expect(center.maintenance).toHaveLength(0);
  });

  it("excludes unreviewed maintenance from the prominent contact value", () => {
    const center = centerWith([
      healthOpportunity(),
      opportunity({ id: "opp-drain", priceMin: 900, priceMax: 1800 }),
    ]);

    // The commercial finding is the whole of the contact-worthy value.
    expect(center.contactValue).toEqual({ min: 900, max: 1800 });
    const maintenance = center.maintenance[0];
    // Still shown, but labelled as what it is: an input to a quote, not value.
    expect(maintenance?.valueLabel).toBe("Potential quote input");
  });

  it("labels a single finding with the finding, not a family wrapper", () => {
    const center = centerWith([healthOpportunity()]);

    expect(center.maintenance[0]?.title).toBe("Home page has no H1");
    expect(center.maintenance[0]?.title).not.toBe("Site health improvement");
  });
});
