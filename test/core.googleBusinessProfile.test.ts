import { describe, expect, it } from "vitest";

import {
  confirmExternalBusinessProfileClaims,
  importGoogleBusinessProfileServiceList,
  type GoogleBusinessProfileServiceList,
} from "@/core/externalBusinessEvidence";

const scope = { workspaceId: "ws-a", clientId: "client-a" };
const now = new Date("2026-09-07T13:00:00.000Z");

const serviceList = (overrides: Partial<GoogleBusinessProfileServiceList> = {}) => ({
  name: "accounts/123/locations/456/serviceList",
  serviceItems: [
    {
      isOffered: true,
      structuredServiceItem: {
        serviceTypeId: "water_heater_installation",
        description: "Water heater installation",
      },
    },
    {
      isOffered: true,
      freeFormServiceItem: {
        categoryId: "plumbing",
        label: { displayName: "Water Solutions", languageCode: "en" },
      },
    },
    {
      isOffered: false,
      freeFormServiceItem: {
        categoryId: "plumbing",
        label: { displayName: "Old Service", languageCode: "en" },
      },
    },
  ],
  ...overrides,
});

describe("Google Business Profile ServiceList intake", () => {
  it("does not turn an untrusted upload into external evidence", () => {
    const result = importGoogleBusinessProfileServiceList(scope, serviceList(), now, {
      ownerAuthorized: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/authorization/i);
  });

  it("parses the official response shape and owns Orbit provenance fields", () => {
    const result = importGoogleBusinessProfileServiceList(scope, serviceList(), now, {
      ownerAuthorized: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.claims.map((claim) => claim.normalizedLabel)).toEqual([
      "Water Heater Installation",
      "Water Solutions",
    ]);
    expect(result.claims[0]).toMatchObject({
      provider: "google-business-profile-api",
      sourceRecordId: "accounts/123/locations/456/serviceList",
      sourceUrl:
        "https://mybusiness.googleapis.com/v4/accounts/123/locations/456/serviceList",
      authorization: "owner-authorized-api-response",
      sourceField: "serviceItems",
      observedAt: now.toISOString(),
      retrievedAt: now.toISOString(),
      sourceVersion: "v4",
    });
    expect(result.claims[1]?.semanticState).toBe("ambiguous");
  });

  it("fails closed when the response is not a ServiceList resource", () => {
    const result = importGoogleBusinessProfileServiceList(
      scope,
      { name: "accounts/123/locations/456", serviceItems: [] },
      now,
      { ownerAuthorized: true },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/service list|resource/i);
  });

  it("promotes only the ambiguous labels the user confirms", () => {
    const imported = importGoogleBusinessProfileServiceList(scope, serviceList(), now, {
      ownerAuthorized: true,
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    const ambiguous = imported.claims.find((claim) => claim.semanticState === "ambiguous");
    expect(ambiguous).toBeDefined();
    const confirmed = confirmExternalBusinessProfileClaims(
      imported.claims,
      new Set([ambiguous!.id]),
    );

    expect(confirmed.find((claim) => claim.id === ambiguous!.id)?.semanticState).toBe("accepted");
    expect(confirmed.find((claim) => claim.normalizedLabel === "Water Heater Installation")?.semanticState).toBe(
      "accepted",
    );
  });
});
