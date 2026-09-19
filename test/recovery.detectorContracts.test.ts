import { describe, expect, it } from "vitest";
import { candidateFromDiagnostic } from "@/core/diagnosticCompatibility";
import { aggregateTechnicalDiagnostics } from "@/core/diagnosticAggregation";
import { DiagnosticDraftSchema } from "@/core/insightSchema";
import { bookingSkeletonForPage, currencyMismatchFor } from "@/core/rules/bookingCardSkeleton";
import { matchesForPageText } from "@/core/rules/placeholderSignatures";

describe("recovered detector contracts", () => {
  it("matches only high-precision production placeholder signatures", () => {
    const matches = matchesForPageText("I'm a paragraph. Click here to add your own text. Lorem ipsum dolor sit amet.");
    expect(matches.map((match) => match.key)).toEqual(["paragraph-scaffold", "lorem-ipsum-filler"]);
    expect(matchesForPageText("A real service description with no template instruction.")).toEqual([]);
  });

  it("recognizes a repeated booking-card skeleton and explicit currency mismatch", () => {
    const page = {
      url: "https://example.com/book",
      status: 200,
      wordCount: 120,
      sections: [1, 2, 3].map((index) => ({ elementKey: `card-${index}`, heading: "Service name", textExcerpt: "Service name $50 60 mins book now" })),
    };
    const skeleton = bookingSkeletonForPage(page);
    expect(skeleton?.occurrences).toBe(3);
    expect(skeleton?.bookingSurface).toBe("path");
    expect(currencyMismatchFor({ displayedCurrencies: ["USD"], intendedCurrency: "CAD" })).toEqual({ displayed: "USD", intended: "CAD" });
  });

  it("adapts an observed legacy diagnostic only when the catalog can price it", () => {
    const draft = DiagnosticDraftSchema.parse({
      detectorId: "missing-title",
      detectorVersion: "1",
      category: "technical_reliability",
      problemType: "missing_page_title",
      subject: { kind: "site", key: "example.com" },
      observation: "The home page is missing a title.",
      legacyEvidenceRefs: ["page:https://example.com/"],
      rawConfidence: 0.95,
      state: "observed",
      details: { kind: "legacy", legacyRuleId: "missing-title" },
    });
    const candidate = candidateFromDiagnostic(draft, [{ id: "service-1", name: "SEO titles", description: "", priceMin: 100, priceMax: 200, tags: ["missing-title"], active: true }]);
    expect(candidate?.suggestedServiceId).toBe("service-1");
    expect(candidateFromDiagnostic(draft, [])).toBeNull();
  });

  it("aggregates technical diagnostics while preserving page evidence", () => {
    const drafts = ["/", "/about"].map((path) => DiagnosticDraftSchema.parse({
      detectorId: "missing-title",
      detectorVersion: "1",
      category: "technical_reliability",
      problemType: "missing_page_title",
      subject: { kind: "page", key: `https://example.com${path}` },
      observation: `The page ${path} is missing a title.`,
      legacyEvidenceRefs: [`page:https://example.com${path}`],
      rawConfidence: 0.95,
      state: "observed",
      details: { kind: "legacy", legacyRuleId: "missing-title" },
    }));
    const result = aggregateTechnicalDiagnostics({ client: { domain: "example.com" }, diagnostics: drafts });
    expect(result).toHaveLength(1);
    expect(result[0]?.observation).toContain("2 affected pages");
    expect(result[0]?.legacyEvidenceRefs).toHaveLength(2);
  });
});
