import { describe, expect, it } from "vitest";

import {
  importOfficialBusinessProfile,
  resolveCurrentExternalClaims,
  type OfficialBusinessProfileExport,
} from "@/core/externalBusinessEvidence";

const baseExport = (overrides: Partial<OfficialBusinessProfileExport> = {}) => ({
  provider: "google-business-profile-export" as const,
  sourceRecordId: "location-123",
  sourceUrl: "https://business.google.com/locations/location-123",
  authorization: "owner-authorized-export" as const,
  sourceField: "services",
  observedAt: "2026-09-07T12:00:00.000Z",
  retrievedAt: "2026-09-07T12:05:00.000Z",
  sourceVersion: "2026-09-07",
  services: ["Drain Cleaning", "Drain cleaning", "Free Quotes", "Boiler Repair"],
  ...overrides,
});

const scope = { workspaceId: "ws-a", clientId: "client-a" };
const now = new Date("2026-09-07T13:00:00.000Z");

describe("official external business evidence", () => {
  it("keeps only distinct, service-shaped labels and preserves provenance", () => {
    const result = importOfficialBusinessProfile(scope, baseExport(), now);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims).toHaveLength(3);
    expect(result.claims.map((claim) => claim.normalizedLabel)).toEqual([
      "Drain Cleaning",
      "Free Quotes",
      "Boiler Repair",
    ]);
    expect(result.claims[0]).toMatchObject({
      workspaceId: "ws-a",
      clientId: "client-a",
      provider: "google-business-profile-export",
      sourceRecordId: "location-123",
      sourceUrl: "https://business.google.com/locations/location-123",
      authorization: "owner-authorized-export",
      sourceField: "services",
      rawServiceLabel: "Drain Cleaning",
      semanticState: "accepted",
    });
    expect(result.claims[0]?.sourceHash).toMatch(/^fnv1a:/);
  });

  it("marks broad labels ambiguous and rejects non-service claims without making findings", () => {
    const result = importOfficialBusinessProfile(
      scope,
      baseExport({ services: ["Solutions", "Fully Insured", "Heat Pump Installation"] }),
      now,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.map((claim) => [claim.rawServiceLabel, claim.semanticState])).toEqual([
      ["Solutions", "ambiguous"],
      ["Fully Insured", "rejected"],
      ["Heat Pump Installation", "accepted"],
    ]);
  });

  it("rejects non-official URLs and invalid time ordering", () => {
    const badHost = importOfficialBusinessProfile(
      scope,
      baseExport({ sourceUrl: "https://example.com/profile/location-123" }),
      now,
    );
    expect(badHost.ok).toBe(false);
    if (badHost.ok) return;
    expect(badHost.error).toMatch(/official business profile/i);

    const badTime = importOfficialBusinessProfile(
      scope,
      baseExport({
        observedAt: "2026-09-08T00:00:00.000Z",
        retrievedAt: "2026-09-07T12:05:00.000Z",
      }),
      now,
    );
    expect(badTime.ok).toBe(false);
    if (badTime.ok) return;
    expect(badTime.error).toMatch(/observed/i);
  });

  it("marks stale snapshots and same-time hash disagreements ineligible", () => {
    const stale = importOfficialBusinessProfile(
      scope,
      baseExport({
        retrievedAt: "2026-07-01T12:05:00.000Z",
        observedAt: "2026-07-01T12:00:00.000Z",
        services: ["Drain Cleaning"],
      }),
      now,
    );
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(resolveCurrentExternalClaims(stale.claims, now)[0]?.semanticState).toBe("stale");

    const first = importOfficialBusinessProfile(
      scope,
      baseExport({ services: ["Drain Cleaning"] }),
      now,
    );
    const second = importOfficialBusinessProfile(
      scope,
      baseExport({ services: ["Boiler Repair"] }),
      now,
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const resolved = resolveCurrentExternalClaims([...first.claims, ...second.claims], now);
    expect(new Set(resolved.map((claim) => claim.semanticState))).toEqual(new Set(["conflicting"]));
  });
});
