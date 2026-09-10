import { describe, expect, it } from "vitest";

import { buildProjectViews, formatProjectStatusSummary } from "@/core/projectPackaging";
import type { Client, Opportunity } from "@/core/schema";

const client: Pick<Client, "id" | "name" | "domain"> = {
  id: "client-tri-city",
  name: "Tri City Plumbing",
  domain: "tricity.example",
};

function opportunity(id: string, subject: string): Opportunity {
  return {
    id,
    dedupeKey: `missing-service-page:${subject.toLowerCase().replaceAll(" ", "-")}`,
    clientId: client.id,
    ruleId: "missing-service-page",
    title: `${subject} — dedicated service page`,
    detected: `No dedicated page for ${subject}.`,
    evidenceRefs: [`https://tricity.example/services/${id}`],
    suppressedEvidenceRefs: [],
    rationale: "Customers need a clear page for this service.",
    suggestedServiceId: "service-page",
    suggestedScope: ["Write a dedicated service page"],
    priceMin: 900,
    priceMax: 1800,
    confidence: 0.9,
    billableStatus: "billable",
    status: "new",
    updatedAt: "2026-09-07T00:00:00.000Z",
  };
}

describe("derived project packaging", () => {
  it("clusters related water-heater services without creating or changing opportunities", () => {
    const entries = [
      { client, opportunity: opportunity("repair", "Water Heater Repair"), serviceName: "Service Landing Page" },
      { client, opportunity: opportunity("replacement", "Water Heater Replacement"), serviceName: "Service Landing Page" },
      { client, opportunity: opportunity("tankless", "Tankless Water Heater"), serviceName: "Service Landing Page" },
    ];
    const before = entries.map(({ opportunity: row }) => ({ ...row }));

    const projects = buildProjectViews(entries);

    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      title: "Water Heater Service Expansion",
      opportunityIds: ["repair", "replacement", "tankless"],
      underlyingPriceMin: 2700,
      underlyingPriceMax: 5400,
      pricingBasis: "not-set",
    });
    expect(projects[0]?.packagePriceMin).toBeUndefined();
    expect(projects[0]?.packagePriceMax).toBeUndefined();
    expect(entries.map(({ opportunity: row }) => row)).toEqual(before);
  });

  it("keeps unrelated service scopes in separate projects", () => {
    const entries = [
      { client, opportunity: opportunity("water", "Water Heater Repair"), serviceName: "Service Landing Page" },
      { client, opportunity: opportunity("roof", "Roof Repair"), serviceName: "Service Landing Page" },
      { client, opportunity: opportunity("heating", "Furnace Installation"), serviceName: "Service Landing Page" },
    ];

    const projects = buildProjectViews(entries);

    expect(projects.map((project) => project.opportunityIds)).toEqual([
      ["water"],
      ["roof"],
      ["heating"],
    ]);
  });

  it("keeps a single service project summary specific to the underlying service", () => {
    const projects = buildProjectViews([
      { client, opportunity: opportunity("drain", "Drain Cleaning"), serviceName: "Service Landing Page" },
    ]);

    expect(projects[0]?.title).toBe("Drain Cleaning service page");
    expect(projects[0]?.summary).toBe(
      "A dedicated page for drain cleaning, with the scope and price reviewed by the agency.",
    );
  });

  it("falls back to deterministic projects when a semantic proposal names an unknown row", () => {
    const entries = [
      { client, opportunity: opportunity("water", "Water Heater Repair"), serviceName: "Service Landing Page" },
      { client, opportunity: opportunity("replacement", "Water Heater Replacement"), serviceName: "Service Landing Page" },
    ];

    const projects = buildProjectViews(entries, {
      clusters: [
        {
          opportunityIds: ["water", "not-an-opportunity"],
          title: "Water Heater Service Expansion",
          summary: "A focused service-page scope.",
        },
      ],
    });

    expect(projects).toHaveLength(1);
    expect(projects[0]?.groupingBasis.kind).toBe("deterministic");
    expect(projects[0]?.opportunityIds).toEqual(["water", "replacement"]);
  });

  it("falls back when a semantic proposal is too vague to ground to its rows", () => {
    const entries = [
      { client, opportunity: opportunity("water", "Water Heater Repair"), serviceName: "Service Landing Page" },
      { client, opportunity: opportunity("replacement", "Water Heater Replacement"), serviceName: "Service Landing Page" },
    ];

    const projects = buildProjectViews(entries, {
      clusters: [
        {
          opportunityIds: ["water", "replacement"],
          title: "Website project",
          summary: "A broad scope for the client.",
        },
      ],
    });

    expect(projects[0]?.groupingBasis.kind).toBe("deterministic");
    expect(projects[0]?.title).toBe("Water Heater Service Expansion");
  });

  it("accepts a grounded semantic label without changing the underlying rows", () => {
    const entries = [
      { client, opportunity: opportunity("water", "Water Heater Repair"), serviceName: "Service Landing Page" },
      { client, opportunity: opportunity("replacement", "Water Heater Replacement"), serviceName: "Service Landing Page" },
    ];

    const projects = buildProjectViews(entries, {
      clusters: [
        {
          opportunityIds: ["water", "replacement"],
          title: "Water Heater Service Expansion",
          summary: "Repair and replacement pages for water heaters.",
        },
      ],
    });

    expect(projects[0]?.groupingBasis.kind).toBe("semantic");
    expect(projects[0]?.opportunityIds).toEqual(["water", "replacement"]);
    expect(projects[0]?.underlyingPriceMax).toBe(3600);
    expect(projects[0]?.packagePriceMax).toBeUndefined();
  });

  it("does not accept a model-generated package price or quote language", () => {
    const entries = [
      { client, opportunity: opportunity("water", "Water Heater Repair"), serviceName: "Service Landing Page" },
      { client, opportunity: opportunity("replacement", "Water Heater Replacement"), serviceName: "Service Landing Page" },
    ];

    const projects = buildProjectViews(entries, {
      clusters: [
        {
          opportunityIds: ["water", "replacement"],
          title: "Water Heater Service Expansion",
          summary: "Suggested package price: $3,000.",
        },
      ],
    });

    expect(projects[0]?.groupingBasis.kind).toBe("deterministic");
    expect(projects[0]?.packagePriceMin).toBeUndefined();
    expect(projects[0]?.packagePriceMax).toBeUndefined();
  });

  it("rejects semantic clusters that cross opportunity families", () => {
    const healthOpportunity = {
      ...opportunity("meta", "Missing meta description"),
      ruleId: "missing-meta-description" as const,
      title: "Missing meta description — 3 pages",
    };
    const entries = [
      { client, opportunity: opportunity("water", "Water Heater Repair"), serviceName: "Service Landing Page" },
      { client, opportunity: healthOpportunity, serviceName: "Meta Description Repair" },
    ];

    const projects = buildProjectViews(entries, {
      clusters: [
        {
          opportunityIds: ["water", "meta"],
          title: "Website growth project",
          summary: "A combined scope.",
        },
      ],
    });

    expect(projects.map((project) => project.groupingBasis.kind)).toEqual([
      "deterministic",
      "deterministic",
    ]);
    expect(projects.map((project) => project.opportunityIds)).toEqual([["water"], ["meta"]]);
  });

  it("rejects duplicate semantic assignments instead of dropping a row", () => {
    const entries = [
      { client, opportunity: opportunity("water", "Water Heater Repair"), serviceName: "Service Landing Page" },
      { client, opportunity: opportunity("replacement", "Water Heater Replacement"), serviceName: "Service Landing Page" },
    ];

    const projects = buildProjectViews(entries, {
      clusters: [
        {
          opportunityIds: ["water", "replacement"],
          title: "Water Heater Service Expansion",
          summary: "A focused service-page scope.",
        },
        {
          opportunityIds: ["water"],
          title: "Another project",
          summary: "This must not steal a row.",
        },
      ],
    });

    expect(projects.every((project) => project.groupingBasis.kind === "deterministic")).toBe(true);
    expect(projects.flatMap((project) => project.opportunityIds)).toEqual(["water", "replacement"]);
  });

  it("rejects semantic proposals that omit an eligible opportunity", () => {
    const entries = [
      { client, opportunity: opportunity("water", "Water Heater Repair"), serviceName: "Service Landing Page" },
      { client, opportunity: opportunity("replacement", "Water Heater Replacement"), serviceName: "Service Landing Page" },
    ];

    const projects = buildProjectViews(entries, {
      clusters: [
        {
          opportunityIds: ["water"],
          title: "Water Heater Service Expansion",
          summary: "A focused service-page scope.",
        },
      ],
    });

    expect(projects.every((project) => project.groupingBasis.kind === "deterministic")).toBe(true);
    expect(projects.flatMap((project) => project.opportunityIds)).toEqual(["water", "replacement"]);
  });

  it("does not group opportunities from different clients", () => {
    const otherClient = { id: "client-other", name: "Other Plumbing", domain: "other.example" };
    const entries = [
      { client, opportunity: opportunity("water", "Water Heater Repair"), serviceName: "Service Landing Page" },
      {
        client: otherClient,
        opportunity: { ...opportunity("other-water", "Water Heater Replacement"), clientId: otherClient.id },
        serviceName: "Service Landing Page",
      },
    ];

    const projects = buildProjectViews(entries);

    expect(projects).toHaveLength(2);
    expect(projects.map((project) => project.client.id)).toEqual([client.id, otherClient.id]);
  });

  it("keeps mixed funnel states as a truthful summary instead of inventing a package state", () => {
    const entries = [
      { client, opportunity: opportunity("new", "Water Heater Repair"), serviceName: "Service Landing Page" },
      {
        client,
        opportunity: { ...opportunity("accepted", "Water Heater Replacement"), status: "accepted" as const },
        serviceName: "Service Landing Page",
      },
      {
        client,
        opportunity: {
          ...opportunity("proposal", "Tankless Water Heater"),
          status: "proposal_prepared" as const,
        },
        serviceName: "Service Landing Page",
      },
    ];

    const project = buildProjectViews(entries)[0]!;

    expect(project.statusSummary).toEqual({ new: 1, accepted: 1, proposal_prepared: 1 });
    expect(formatProjectStatusSummary(project.statusSummary)).toBe("1 proposal ready · 1 accepted · 1 new");
  });
});
