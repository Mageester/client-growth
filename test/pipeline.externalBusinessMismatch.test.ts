import { describe, expect, it, vi } from "vitest";

import { FixtureEvidenceProvider } from "@/adapters/evidence/FixtureEvidenceProvider";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import { importOfficialBusinessProfile } from "@/core/externalBusinessEvidence";
import {
  ClientSchema,
  EvidenceBundleSchema,
  ServiceSchema,
  type EvidenceBundle,
} from "@/core/schema";
import { analyzeClient } from "@/pipeline/analyzeClient";
import type { OpportunityEvaluator } from "@/ports/OpportunityEvaluator";

const client = ClientSchema.parse({
  id: "client-a",
  name: "Acme Plumbing",
  domain: "acme.example",
  offerings: [],
});

const landingPage = ServiceSchema.parse({
  id: "svc-landing",
  name: "Service page",
  description: "",
  priceMin: 900,
  priceMax: 1800,
  tags: ["landing-page"],
  active: true,
});

function evidence(): EvidenceBundle {
  return EvidenceBundleSchema.parse({
    clientId: client.id,
    source: "fixture",
    capturedAt: "2026-09-07T12:00:00.000Z",
    site: {
      pages: [
        {
          url: "https://acme.example/",
          status: 200,
          title: "Acme Plumbing",
          h1s: ["Acme Plumbing"],
          headings: [],
          textExcerpt: "",
          wordCount: 240,
        },
        {
          url: "https://acme.example/services/drain-cleaning",
          status: 200,
          title: "Drain Cleaning",
          h1s: ["Drain Cleaning"],
          headings: [],
          textExcerpt: "",
          wordCount: 240,
        },
        {
          url: "https://acme.example/services/plumbing",
          status: 200,
          title: "Plumbing",
          h1s: ["Plumbing"],
          headings: [],
          textExcerpt: "",
          wordCount: 240,
        },
      ],
      nav: ["Home", "Services", "Drain Cleaning", "Plumbing"],
      links: [],
      sitemapUrls: [],
      crawlExhaustive: true,
    },
    networkEvents: [],
  });
}

function claims(labels: string[]) {
  const imported = importOfficialBusinessProfile(
    { workspaceId: "ws-a", clientId: client.id },
    {
      provider: "google-business-profile-export",
      sourceRecordId: "location-123",
      sourceUrl: "https://business.google.com/locations/location-123",
      authorization: "owner-authorized-export",
      sourceField: "services",
      observedAt: "2026-09-07T12:00:00.000Z",
      retrievedAt: "2026-09-07T12:05:00.000Z",
      services: labels,
    },
    new Date("2026-09-07T13:00:00.000Z"),
  );
  if (!imported.ok) throw new Error(imported.error);
  return imported.claims;
}

function run(
  externalClaims = claims(["Water Heater Replacement"]),
  evaluator: OpportunityEvaluator = new MockEvaluator(),
) {
  return analyzeClient({
    client,
    catalog: [landingPage],
    coverage: [],
    evidenceProvider: new FixtureEvidenceProvider([evidence()]),
    evaluator,
    externalClaims,
    now: new Date("2026-09-07T13:00:00.000Z"),
  });
}

describe("external business-profile mismatch pipeline", () => {
  it("reuses the normal opportunity pipeline and preserves source evidence and pricing", async () => {
    const mock = new MockEvaluator();
    const evaluate = vi.fn(mock.evaluate.bind(mock));
    const result = await run(undefined, { evaluate });

    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]).toMatchObject({
      ruleId: "missing-service-page",
      suggestedServiceId: "svc-landing",
      priceMin: 900,
      priceMax: 1800,
      billableStatus: "billable",
    });
    expect(result.opportunities[0]?.title).toMatch(/Water Heater Replacement/i);
    expect(result.opportunities[0]?.evidenceRefs).toContain(
      "external:https://business.google.com/locations/location-123",
    );
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate a client-profile candidate for the same service", async () => {
    const profileClient = ClientSchema.parse({ ...client, offerings: ["Water Heater Replacement"] });
    const result = await analyzeClient({
      client: profileClient,
      catalog: [landingPage],
      coverage: [],
      evidenceProvider: new FixtureEvidenceProvider([evidence()]),
      evaluator: new MockEvaluator(),
      externalClaims: claims(["Water Heater Replacement"]),
      now: new Date("2026-09-07T13:00:00.000Z"),
    });

    expect(result.opportunities).toHaveLength(1);
    expect(new Set(result.opportunities.map((opportunity) => opportunity.dedupeKey)).size).toBe(1);
  });

  it("fails closed when the existing evaluator cannot judge an external mismatch", async () => {
    const result = await run(undefined, {
      evaluate: async () => {
        throw new Error("provider unavailable");
      },
    });

    expect(result.opportunities).toEqual([]);
    expect(result.stats.aiCalls).toBe(1);
    expect(result.stats.evaluatorErrors).toBe(1);
  });

  it("keeps contract coverage authoritative for an external mismatch", async () => {
    const result = await analyzeClient({
      client,
      catalog: [landingPage],
      coverage: [{ clientId: client.id, serviceId: landingPage.id, covered: true }],
      evidenceProvider: new FixtureEvidenceProvider([evidence()]),
      evaluator: new MockEvaluator(),
      externalClaims: claims(["Water Heater Replacement"]),
      now: new Date("2026-09-07T13:00:00.000Z"),
    });

    expect(result.opportunities).toEqual([]);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0]?.status).toBe("already_covered");
    expect(result.stats.aiCalls).toBe(0);
  });

  it("reconciles an external finding onto the existing funnel row", async () => {
    const first = await run();
    const original = first.opportunities[0]!;
    const second = await run(undefined, new MockEvaluator());
    const repeated = second.opportunities[0]!;

    expect(repeated.id).toBe(original.id);
    expect(repeated.dedupeKey).toBe(original.dedupeKey);

    const accepted = await analyzeClient({
      client,
      catalog: [landingPage],
      coverage: [],
      evidenceProvider: new FixtureEvidenceProvider([evidence()]),
      evaluator: new MockEvaluator(),
      externalClaims: claims(["Water Heater Replacement"]),
      existing: [{ ...original, status: "accepted", acceptedAt: "2026-09-07T14:00:00.000Z" }],
      now: new Date("2026-09-07T15:00:00.000Z"),
    });
    expect(accepted.opportunities[0]?.status).toBe("accepted");
    expect(accepted.opportunities[0]?.acceptedAt).toBe("2026-09-07T14:00:00.000Z");
  });
});
