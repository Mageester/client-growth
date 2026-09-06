import { describe, expect, it } from "vitest";

import { findCompetitorGaps, type CompetitorSite } from "@/core/competitorGaps";
import { EvidenceBundleSchema, type EvidenceBundle } from "@/core/schema";

/**
 * Synthetic sites shaped like the real corpus: a services section with one page
 * per service, which is how every small-business site in the corpus that has
 * service pages at all is built.
 */
function siteWith(domain: string, services: string[]): EvidenceBundle {
  const origin = `https://${domain}`;
  return EvidenceBundleSchema.parse({
    clientId: domain,
    source: "http",
    capturedAt: "2026-09-06T00:00:00.000Z",
    site: {
      pages: [
        {
          url: `${origin}/`,
          status: 200,
          title: domain,
          h1s: [domain],
          headings: [],
          textExcerpt: "",
          wordCount: 500,
        },
        ...services.map((service) => ({
          url: `${origin}/services/${service.toLowerCase().replace(/\s+/g, "-")}`,
          status: 200,
          title: service,
          h1s: [service],
          headings: [],
          textExcerpt: "",
          wordCount: 500,
        })),
      ],
      links: services.map((service) => ({
        href: `${origin}/services/${service.toLowerCase().replace(/\s+/g, "-")}`,
        label: service,
        scheme: "http",
        inNav: true,
        foundOn: [`${origin}/`],
      })),
      crawlExhaustive: true,
    },
  });
}

const competitor = (domain: string, services: string[]): CompetitorSite => ({
  domain,
  evidence: siteWith(domain, services),
});

describe("competitor service gaps", () => {
  it("reports a service two competitors have and the client does not", () => {
    const result = findCompetitorGaps({
      clientOfferings: ["Drain cleaning"],
      clientEvidence: siteWith("client.example", ["Drain cleaning"]),
      competitors: [
        competitor("rival-one.example", ["Drain cleaning", "Emergency callouts"]),
        competitor("rival-two.example", ["Drain cleaning", "Emergency callouts"]),
      ],
    });

    expect(result.limitation).toBeUndefined();
    expect(result.gaps.map((gap) => gap.label)).toEqual(["Emergency callouts"]);
    expect(result.gaps[0]!.competitorDomains).toEqual([
      "rival-one.example",
      "rival-two.example",
    ]);
    expect(result.gaps[0]!.exampleUrl).toContain("emergency-callouts");
  });

  it("stays silent when only one competitor has it", () => {
    // One site's choice is not a market pattern, and telling an agency their
    // client is behind on the strength of a single competitor is the kind of
    // claim that gets corrected in front of the client.
    const result = findCompetitorGaps({
      clientOfferings: ["Drain cleaning"],
      clientEvidence: siteWith("client.example", ["Drain cleaning"]),
      competitors: [
        competitor("rival-one.example", ["Drain cleaning", "Emergency callouts"]),
        competitor("rival-two.example", ["Drain cleaning"]),
      ],
    });

    expect(result.gaps).toEqual([]);
    expect(result.limitation).toBeUndefined();
  });

  it("never counts an unreadable competitor as one that lacks the service", () => {
    const result = findCompetitorGaps({
      clientOfferings: [],
      clientEvidence: siteWith("client.example", []),
      competitors: [
        competitor("rival-one.example", ["Emergency callouts"]),
        competitor("rival-two.example", ["Emergency callouts"]),
        { domain: "rival-three.example", evidence: null },
      ],
    });

    expect(result.readableCompetitors).toHaveLength(2);
    expect(result.unreadableCompetitors).toEqual(["rival-three.example"]);
    expect(result.gaps.map((gap) => gap.label)).toEqual(["Emergency callouts"]);
    // The gap names only the two sites actually read.
    expect(result.gaps[0]!.competitorDomains).not.toContain("rival-three.example");
  });

  it("refuses to compare at all when too few competitors could be read", () => {
    const result = findCompetitorGaps({
      clientOfferings: [],
      clientEvidence: siteWith("client.example", []),
      competitors: [
        competitor("rival-one.example", ["Emergency callouts"]),
        { domain: "rival-two.example", evidence: null },
      ],
    });

    expect(result.gaps).toEqual([]);
    // "No gaps found" would read as "your client is level with the market".
    expect(result.limitation).toMatch(/could be read/i);
    expect(result.limitation).toMatch(/no comparison is being claimed/i);
  });

  it("says nothing about a client whose own site could not be read", () => {
    const result = findCompetitorGaps({
      clientOfferings: [],
      clientEvidence: null,
      competitors: [
        competitor("rival-one.example", ["Emergency callouts"]),
        competitor("rival-two.example", ["Emergency callouts"]),
      ],
    });

    expect(result.gaps).toEqual([]);
    expect(result.limitation).toMatch(/could not be read/i);
    expect(result.limitation).toMatch(/not a finding that the client is up to date/i);
  });

  it("does not report a service the client records as an offering", () => {
    // Recorded but with no page of its own: that is missing-service-page's job,
    // and reporting it here too would sell the same work twice.
    const result = findCompetitorGaps({
      clientOfferings: ["Emergency callouts"],
      clientEvidence: siteWith("client.example", []),
      competitors: [
        competitor("rival-one.example", ["Emergency callouts"]),
        competitor("rival-two.example", ["Emergency callouts"]),
      ],
    });

    expect(result.gaps).toEqual([]);
  });

  it("does not report a service the client has a page for but never recorded", () => {
    const result = findCompetitorGaps({
      clientOfferings: [],
      clientEvidence: siteWith("client.example", ["Emergency callouts"]),
      competitors: [
        competitor("rival-one.example", ["Emergency callouts"]),
        competitor("rival-two.example", ["Emergency callouts"]),
      ],
    });

    expect(result.gaps).toEqual([]);
  });

  it("treats a wordier competitor label as the same service", () => {
    const result = findCompetitorGaps({
      clientOfferings: ["Emergency callout"],
      clientEvidence: siteWith("client.example", []),
      competitors: [
        competitor("rival-one.example", ["Emergency callouts"]),
        competitor("rival-two.example", ["Emergency callout service"]),
      ],
    });

    expect(result.gaps).toEqual([]);
  });

  it("counts one competitor once however many pages they have about it", () => {
    const busy = siteWith("rival-one.example", [
      "Emergency callouts",
      "Emergency callouts",
    ]);
    const result = findCompetitorGaps({
      clientOfferings: [],
      clientEvidence: siteWith("client.example", []),
      competitors: [
        { domain: "rival-one.example", evidence: busy },
        competitor("rival-two.example", ["Boiler servicing"]),
      ],
    });

    // Each competitor has one service the other lacks, so neither reaches two.
    expect(result.gaps).toEqual([]);
  });

  it("ranks a gap all three competitors share above one that only two share", () => {
    const result = findCompetitorGaps({
      clientOfferings: [],
      clientEvidence: siteWith("client.example", []),
      competitors: [
        competitor("a.example", ["Emergency callouts", "Boiler servicing"]),
        competitor("b.example", ["Emergency callouts", "Boiler servicing"]),
        competitor("c.example", ["Emergency callouts"]),
      ],
    });

    expect(result.gaps.map((gap) => gap.label)).toEqual([
      "Emergency callouts",
      "Boiler servicing",
    ]);
    expect(result.gaps[0]!.competitorDomains).toHaveLength(3);
  });
});
