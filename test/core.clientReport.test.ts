import { describe, expect, it } from "vitest";

import { ClientSchema, OpportunitySchema, type Opportunity } from "@/core/schema";
import {
  buildClientReportSnapshot,
  buildReportCandidates,
  isReportableOpportunity,
  type ReportCandidateInput,
} from "@/core/clientReport";

const client = ClientSchema.parse({
  id: "client_tri",
  name: "Tri City Plumbing",
  domain: "tricity.example",
  offerings: ["water heaters", "drain cleaning"],
  notes: "",
});

const run: NonNullable<ReportCandidateInput["latestRun"]> = {
  outcome: "findings",
  finishedAt: "2026-09-07T12:00:00.000Z",
  limitation: null,
};

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return OpportunitySchema.parse({
    id: "opp-water-heater",
    dedupeKey: "missing-service-page:water heater repair",
    clientId: client.id,
    ruleId: "missing-service-page",
    title: "Water Heater Repair — dedicated service page",
    detected: "The site names water heater repair but has no dedicated page.",
    evidenceRefs: ["page:https://tricity.example/services"],
    rationale: "A focused page gives this service a clear place to be understood.",
    suggestedServiceId: "svc-page",
    suggestedScope: ["Plan the service page", "Write the service copy"],
    priceMin: 900,
    priceMax: 1800,
    confidence: 0.9,
    billableStatus: "billable",
    status: "new",
    verification: {
      conclusion: "absent",
      inspectedUrls: ["https://tricity.example/services"],
      closeMatches: [],
      reason: "No dedicated page was found.",
    },
    updatedAt: run.finishedAt,
    ...overrides,
  });
}

function input(opportunities: Opportunity[], latestRun = run): ReportCandidateInput {
  return {
    client,
    opportunities,
    serviceNameById: {
      "svc-page": "Service landing page",
      "svc-health": "Website improvement",
    },
    latestRun,
  };
}

describe("client report candidate selection", () => {
  it("preselects only the strongest active commercial projects and keeps health separate", () => {
    const opportunities = [
      opportunity({ id: "opp-water-heater", priceMax: 1800 }),
      opportunity({
        id: "opp-drain",
        dedupeKey: "missing-service-page:drain cleaning",
        title: "Drain Cleaning — dedicated service page",
        priceMax: 2400,
      }),
      opportunity({
        id: "opp-leak",
        dedupeKey: "missing-service-page:leak detection",
        title: "Leak Detection — dedicated service page",
        priceMax: 2100,
      }),
      opportunity({
        id: "opp-sump",
        dedupeKey: "missing-service-page:sump pump",
        title: "Sump Pump Service — dedicated service page",
        priceMax: 1200,
      }),
      opportunity({
        id: "opp-furnace",
        dedupeKey: "missing-service-page:furnace",
        title: "Furnace Installation — dedicated service page",
        priceMax: 1100,
      }),
      opportunity({
        id: "opp-health",
        dedupeKey: "missing-title:home",
        ruleId: "missing-title",
        title: "Missing page title — home page",
        suggestedServiceId: "svc-health",
        priceMin: 200,
        priceMax: 500,
      }),
      opportunity({ id: "opp-dismissed", status: "dismissed" }),
      opportunity({ id: "opp-lost", status: "lost" }),
      opportunity({ id: "opp-sold", status: "sold", soldAmount: 1500 }),
      opportunity({ id: "opp-snoozed", status: "snoozed", snoozeUntil: "2026-09-30T00:00:00.000Z" }),
      opportunity({ id: "opp-superseded", status: "superseded" }),
      opportunity({
        id: "opp-inconclusive",
        verification: {
          conclusion: "inconclusive",
          inspectedUrls: [],
          closeMatches: [],
          reason: "The site could not be checked far enough.",
        },
      }),
    ];

    const result = buildReportCandidates(input(opportunities));

    expect(result.commercial).toHaveLength(4);
    expect(result.commercial.map((candidate) => candidate.project.title)).toContain(
      "Emergency & Repair Expansion",
    );
    expect(result.health).toHaveLength(1);
    expect(result.defaultSelectedKeys).toEqual(result.commercial.slice(0, 3).map((c) => c.key));
    expect(result.commercial.slice(0, 3).every((candidate) => candidate.defaultSelected)).toBe(true);
    expect(result.commercial[3]?.defaultSelected).toBe(false);
    expect(result.health[0]?.defaultSelected).toBe(false);
    expect(result.eligibleOpportunityIds.sort()).toEqual(
      ["opp-drain", "opp-furnace", "opp-health", "opp-leak", "opp-sump", "opp-water-heater"].sort(),
    );
  });

  it("does not turn an inconclusive review into client recommendations", () => {
    const result = buildReportCandidates(
      input([opportunity()], {
        outcome: "inconclusive",
        finishedAt: "2026-09-07T12:00:00.000Z",
        limitation: "The site could not be read far enough to verify recommendations.",
      }),
    );

    expect(result.commercial).toEqual([]);
    expect(result.health).toEqual([]);
    expect(result.defaultSelectedKeys).toEqual([]);
    expect(result.limitations).toEqual([
      "The site could not be read far enough to verify recommendations.",
    ]);
  });

  it("does not recommend a finding with an inconclusive verification", () => {
    expect(
      isReportableOpportunity(
        opportunity({
          verification: {
            conclusion: "inconclusive",
            inspectedUrls: [],
            closeMatches: [],
            reason: "The relevant page could not be checked.",
          },
        }),
      ),
    ).toBe(false);
  });

  it("includes every selected eligible opportunity once, even when projects are reordered", () => {
    const opportunities = [
      opportunity({
        id: "opp-a",
        dedupeKey: "missing-service-page:a",
        title: "Drain Cleaning — dedicated service page",
        priceMin: 100,
        priceMax: 200,
      }),
      opportunity({
        id: "opp-b",
        dedupeKey: "missing-service-page:b",
        title: "Water Heater Repair — dedicated service page",
        priceMin: 300,
        priceMax: 400,
      }),
      opportunity({ id: "opp-health", dedupeKey: "missing-title:home", ruleId: "missing-title", priceMin: 50, priceMax: 75 }),
    ];
    const candidates = buildReportCandidates(input(opportunities));
    const all = [...candidates.commercial, ...candidates.health];
    const keys = all.map((candidate) => candidate.key);
    const stored = buildClientReportSnapshot({
      workspaceId: "ws_tri",
      createdByUserId: "user_owner",
      client,
      agency: { name: "Axiom Studio", logo: null },
      preparedBy: "Avery Owner",
      generatedAt: "2026-09-07T13:00:00.000Z",
      evidenceReviewedAt: "2026-09-07T12:00:00.000Z",
      candidates,
      selection: {
        selectedKeys: [keys[2]!, keys[0]!, keys[1]!],
        orderedKeys: [keys[1]!, keys[2]!, keys[0]!],
        showUnderlyingValue: true,
      },
    });
    expect(stored.audit.includedOpportunityIds).toHaveLength(3);
    expect(new Set(stored.audit.includedOpportunityIds)).toEqual(
      new Set(opportunities.map((item) => item.id)),
    );
    expect(stored.audit.includedOpportunityIds).toEqual(["opp-a", "opp-health", "opp-b"]);
  });
});

describe("client report snapshots", () => {
  it("preserves selected order, exact arithmetic, optional value visibility, and explicit package price only", () => {
    const candidates = buildReportCandidates(
      input([
        opportunity({
          id: "opp-drain",
          dedupeKey: "missing-service-page:drain cleaning",
          title: "Drain Cleaning — dedicated service page",
          priceMin: 900,
          priceMax: 1800,
        }),
        opportunity({
          id: "opp-water-heater",
          priceMin: 1200,
          priceMax: 2200,
        }),
        opportunity({
          id: "opp-health",
          dedupeKey: "missing-title:home",
          ruleId: "missing-title",
          title: "Missing page title — home page",
          suggestedServiceId: "svc-health",
          priceMin: 200,
          priceMax: 500,
        }),
      ]),
    );
    const commercial = candidates.commercial;
    const health = candidates.health;
    const selectedKeys = [commercial[1]!.key, commercial[0]!.key, health[0]!.key];

    const stored = buildClientReportSnapshot({
      workspaceId: "ws_tri",
      createdByUserId: "user_owner",
      client,
      agency: { name: "Axiom Studio", logo: "data:image/png;base64,iVBORw0KGgo=", theme: "editorial" },
      preparedBy: "Avery Owner",
      generatedAt: "2026-09-07T13:00:00.000Z",
      evidenceReviewedAt: "2026-09-07T12:00:00.000Z",
      candidates,
      selection: {
        selectedKeys,
        orderedKeys: selectedKeys,
        showUnderlyingValue: true,
        packagePrices: { [commercial[1]!.key]: 3200 },
        confirmedPackagePriceKeys: [commercial[1]!.key],
        agencyNote: "Review the two service areas first.",
        nextStepNote: "Let’s confirm priorities together.",
      },
    });

    expect(stored.public.recommendedProjects.map((project) => project.title)).toEqual([
      commercial[1]!.project.title,
      commercial[0]!.project.title,
    ]);
    expect(stored.public.agency.theme).toBe("editorial");
    expect(stored.public.supportingProjects.map((project) => project.title)).toEqual([
      health[0]!.project.title,
    ]);
    expect(stored.public.recommendedProjects[0]?.underlyingOpportunityValue).toEqual({
      min: 900,
      max: 1800,
    });
    expect(stored.public.recommendedProjects[0]?.packagePrice).toEqual({
      amount: 3200,
      currency: "USD",
    });
    expect(stored.public.recommendedProjects[1]?.packagePrice).toBeNull();
    expect(stored.public.executiveSummary.underlyingOpportunityValue).toEqual({
      min: 2300,
      max: 4500,
    });
    expect(stored.audit.includedOpportunityIds).toEqual([
      "opp-drain",
      "opp-water-heater",
      "opp-health",
    ]);
    expect(JSON.stringify(stored.public)).not.toContain("ws_tri");
    expect(JSON.stringify(stored.public)).not.toContain("opp-water-heater");
    expect(JSON.stringify(stored.public)).not.toContain("ruleId");
  });

  it("never publishes an entered package price without an explicit confirmation", () => {
    const source = opportunity();
    const candidates = buildReportCandidates(input([source]));
    const key = candidates.commercial[0]!.key;
    const stored = buildClientReportSnapshot({
      workspaceId: "ws_tri",
      createdByUserId: "user_owner",
      client,
      agency: { name: "Axiom Studio", logo: null },
      preparedBy: "Avery Owner",
      generatedAt: "2026-09-07T13:00:00.000Z",
      evidenceReviewedAt: "2026-09-07T12:00:00.000Z",
      candidates,
      selection: {
        selectedKeys: [key],
        orderedKeys: [key],
        showUnderlyingValue: true,
        packagePrices: { [key]: 3200 },
      },
    });
    expect(stored.public.recommendedProjects[0]?.packagePrice).toBeNull();
  });

  it("never attaches a package price to supporting website work", () => {
    const source = opportunity({
      id: "opp-health",
      dedupeKey: "missing-title:home",
      ruleId: "missing-title",
      title: "Missing page title — home page",
      suggestedServiceId: "svc-health",
      priceMin: 200,
      priceMax: 500,
    });
    const candidates = buildReportCandidates(input([source]));
    const key = candidates.health[0]!.key;
    const stored = buildClientReportSnapshot({
      workspaceId: "ws_tri",
      createdByUserId: "user_owner",
      client,
      agency: { name: "Axiom Studio", logo: null },
      preparedBy: "Avery Owner",
      generatedAt: "2026-09-07T13:00:00.000Z",
      evidenceReviewedAt: "2026-09-07T12:00:00.000Z",
      candidates,
      selection: {
        selectedKeys: [key],
        orderedKeys: [key],
        showUnderlyingValue: true,
        packagePrices: { [key]: 800 },
        confirmedPackagePriceKeys: [key],
      },
    });
    expect(stored.public.supportingProjects[0]?.packagePrice).toBeNull();
  });

  it("keeps unsafe and internal evidence references out of the client document", () => {
    const source = opportunity({
      evidenceRefs: [
        "page:https://tricity.example/services",
        "target:https://tricity.example/private-check",
        "status:404",
        "external:javascript:alert(1)",
      ],
      verification: {
        conclusion: "absent",
        inspectedUrls: ["https://tricity.example/services", "javascript:alert(1)"],
        closeMatches: [],
        reason: "No dedicated page was found.",
      },
    });
    const candidates = buildReportCandidates(input([source]));
    const key = candidates.commercial[0]!.key;
    const stored = buildClientReportSnapshot({
      workspaceId: "ws_tri",
      createdByUserId: "user_owner",
      client,
      agency: { name: "Axiom Studio", logo: null },
      preparedBy: "Avery Owner",
      generatedAt: "2026-09-07T13:00:00.000Z",
      evidenceReviewedAt: "2026-09-07T12:00:00.000Z",
      candidates,
      selection: { selectedKeys: [key], orderedKeys: [key], showUnderlyingValue: false },
    });
    const evidence = stored.public.recommendedProjects[0]?.findings[0]?.evidence ?? [];
    expect(evidence.map((item) => item.url)).toEqual(["https://tricity.example/services"]);
    expect(JSON.stringify(stored.public)).not.toMatch(/target:|status:|javascript:/i);
  });

  it("omits underlying value when hidden and keeps the snapshot immutable", () => {
    const source = opportunity();
    const candidates = buildReportCandidates(input([source]));
    const key = candidates.commercial[0]!.key;
    const stored = buildClientReportSnapshot({
      workspaceId: "ws_tri",
      createdByUserId: "user_owner",
      client,
      agency: { name: "Axiom Studio", logo: null },
      preparedBy: "Avery Owner",
      generatedAt: "2026-09-07T13:00:00.000Z",
      evidenceReviewedAt: "2026-09-07T12:00:00.000Z",
      candidates,
      selection: {
        selectedKeys: [key],
        orderedKeys: [key],
        showUnderlyingValue: false,
      },
    });
    const before = JSON.stringify(stored);

    source.title = "Changed after report";
    source.priceMin = 1;
    source.evidenceRefs = ["page:https://changed.example/secret"];
    client.name = "Changed Client";

    expect(stored.public.recommendedProjects[0]?.title).toBe(
      "Service expansion opportunity",
    );
    expect(stored.public.recommendedProjects[0]?.underlyingOpportunityValue).toBeNull();
    expect(stored.public.recommendedProjects[0]?.findings[0]?.evidence[0]?.url).toBe(
      "https://tricity.example/services",
    );
    expect(JSON.stringify(stored)).toBe(before);
  });
});
