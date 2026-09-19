import { describe, expect, it } from "vitest";
import { boundControlsFrom, verifyControlEnumeration } from "@/core/claimBinding";
import { FindingSetSchema, PublishedFindingSchema } from "@/core/findingSchema";
import type { EvidenceRef } from "@/core/insightSchema";

function ctaEvidence(id: string, label: string, href: string): EvidenceRef {
  return {
    id,
    runId: "run-1",
    kind: "element",
    locator: `element:${id}`,
    pageUrl: "https://example.com/",
    observedAt: "2026-09-19T00:00:00.000Z",
    payload: {
      observationType: "cta",
      elementKey: id,
      label,
      accessibleName: label,
      href,
    },
  };
}

describe("recovered finding and claim boundaries", () => {
  it("rejects an unbounded or unknown published finding", () => {
    const valid = {
      id: "finding-1",
      fingerprint: "fp-1",
      statement: "The contact CTA points to the booking page.",
      whyItMatters: "Visitors may be sent to the wrong conversion step.",
      businessConsequence: null,
      category: "conversion",
      problemType: "broken_conversion_path",
      calibration: "VERIFIED_DEFECT",
      origin: "SOURCE_HTTP",
      tier: "broken_conversion",
      rank: 1,
      confidence: "strong",
      claimScope: "observed",
      pages: ["https://example.com/"],
      evidenceIds: ["evidence-1"],
      evidenceLabels: ["Contact CTA"],
      validationSteps: [],
      limitations: [],
      catalogMatch: null,
      opportunityId: null,
      source: "deterministic",
      reviewed: false,
    } as const;
    expect(PublishedFindingSchema.parse(valid)).toEqual(valid);
    expect(() => PublishedFindingSchema.parse({ ...valid, unexpected: true })).toThrow();
    expect(() => FindingSetSchema.parse({ runId: "run-1", findings: [valid], limitations: [valid], withheld: -1 })).toThrow();
  });

  it("withholds a universal claim when bound CTAs have different destinations", () => {
    const refs = [
      ctaEvidence("cta-1", "Book now", "https://example.com/book"),
      ctaEvidence("cta-2", "Call us", "tel:+14165550123"),
    ];
    const controls = boundControlsFrom(refs.map((ref) => ref.id), new Map(refs.map((ref) => [ref.id, ref])));
    const result = verifyControlEnumeration({
      statement: "Both Book now and Call us point to the booking page.",
      controls,
      scopeUrl: "https://example.com/",
    });
    expect(result.kind).toBe("contradicted");
    if (result.kind === "contradicted") {
      expect(result.statement).toContain("the remaining 1 target");
      expect(result.detail).toContain("2 destinations");
    }
  });
});
