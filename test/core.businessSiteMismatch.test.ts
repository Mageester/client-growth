import { describe, expect, it } from "vitest";

import { buildExternalMismatchCandidates } from "@/core/businessSiteMismatch";
import {
  ClientSchema,
  EvidenceBundleSchema,
  ServiceSchema,
  type EvidenceBundle,
} from "@/core/schema";
import { importOfficialBusinessProfile } from "@/core/externalBusinessEvidence";

const client = ClientSchema.parse({
  id: "client-a",
  name: "Acme Plumbing",
  domain: "acme.example",
  offerings: [],
});

const catalog = [
  ServiceSchema.parse({
    id: "svc-landing",
    name: "Service page",
    description: "",
    priceMin: 900,
    priceMax: 1800,
    tags: ["landing-page"],
    active: true,
  }),
];

function evidence(overrides: Partial<EvidenceBundle["site"]> = {}): EvidenceBundle {
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
      ...overrides,
    },
    networkEvents: [],
  });
}

function claim(labels: string[], overrides: Record<string, unknown> = {}) {
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
      sourceVersion: "v1",
      services: labels,
      ...overrides,
    },
    new Date("2026-09-07T13:00:00.000Z"),
  );
  if (!imported.ok) throw new Error(imported.error);
  return imported.claims;
}

describe("business-to-site mismatch candidates", () => {
  it("requires readable service coverage and surfaces only a deterministic website absence", async () => {
    const candidates = await buildExternalMismatchCandidates({
      client,
      catalog,
      evidence: evidence(),
      coverage: {
        analyzable: true,
        reason: "service coverage confirmed",
        representedOfferings: 0,
        serviceLikePages: 2,
        serviceLikeSitemapUrls: 0,
        limitation: null,
      },
      claims: claim(["Drain Cleaning", "Water Heater Replacement"]),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      ruleId: "missing-service-page",
      subject: "Water Heater Replacement",
      suggestedServiceId: "svc-landing",
    });
    expect(candidates[0]?.evidenceRefs).toContain(
      "external:https://business.google.com/locations/location-123",
    );
    expect(candidates[0]?.verification?.conclusion).toBe("absent");
  });

  it("suppresses covered website services, stale/conflicting claims, and weak semantics", async () => {
    const fresh = claim(["Drain Cleaning"]);
    const stale = claim(["Water Heater Replacement"], {
      retrievedAt: "2026-07-01T12:05:00.000Z",
      observedAt: "2026-07-01T12:00:00.000Z",
    });
    const ambiguous = claim(["Solutions"]);

    const candidates = await buildExternalMismatchCandidates({
      client,
      catalog,
      evidence: evidence(),
      coverage: {
        analyzable: true,
        reason: "service coverage confirmed",
        representedOfferings: 0,
        serviceLikePages: 2,
        serviceLikeSitemapUrls: 0,
        limitation: null,
      },
      claims: [...fresh, ...stale, ...ambiguous],
    });

    expect(candidates).toEqual([]);
  });

  it("never uses external claims to rescue an unreadable or incomplete website", async () => {
    const unreadable = evidence({ pages: [], crawlExhaustive: false });
    const candidates = await buildExternalMismatchCandidates({
      client,
      catalog,
      evidence: unreadable,
      coverage: {
        analyzable: false,
        reason: "the website could not be read",
        representedOfferings: 0,
        serviceLikePages: 0,
        serviceLikeSitemapUrls: 0,
        limitation: "coverage-limited",
      },
      claims: claim(["Water Heater Replacement"]),
    });

    expect(candidates).toEqual([]);
  });
});
