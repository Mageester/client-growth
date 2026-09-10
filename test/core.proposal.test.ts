import { describe, expect, it } from "vitest";

import { analyzeClient } from "@/pipeline/analyzeClient";
import { FixtureEvidenceProvider } from "@/adapters/evidence/FixtureEvidenceProvider";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import {
  formatReviewedProposal,
  generateProposalDraft,
  parseReviewedProposal,
} from "@/core/proposal";
import { coverageNone, hvacCatalog, hvacClient, hvacEvidence } from "./helpers/fixtures";

describe("generateProposalDraft", () => {
  it("builds a focused commercial draft while keeping source evidence separate", async () => {
    const catalog = hvacCatalog();
    const { opportunities } = await analyzeClient({
      client: hvacClient(),
      catalog,
      coverage: coverageNone(),
      evidenceProvider: new FixtureEvidenceProvider([hvacEvidence()]),
      evaluator: new MockEvaluator(),
      now: new Date("2026-08-30T00:00:00.000Z"),
    });
    const opp = opportunities[0]!;
    const service = catalog.find((s) => s.id === opp.suggestedServiceId)!;

    const md = generateProposalDraft({ opportunity: opp, client: hvacClient(), service });

    expect(md).toContain("# Heat Pump Installation");
    expect(md).toContain("$900");
    expect(md).toContain("$1,500");
    expect(md).toContain("USD");
    expect(md).toContain("## Proposed scope");
    expect(md).not.toContain("https://coolbreezehvac.example/");
    expect(md).not.toContain("## Evidence reviewed");
  });

  it("round-trips the reviewed commercial commitments without Markdown knowledge", () => {
    const text = formatReviewedProposal({
      title: "Heat pump service page",
      scope: ["Write and build one service page."],
      priceMin: 1250,
      priceMax: 1250,
      currency: "CAD",
      nextStep: "Reply to approve the reviewed scope.",
    });

    expect(parseReviewedProposal(text)).toEqual({
      title: "Heat pump service page",
      scope: ["Write and build one service page."],
      priceMin: 1250,
      priceMax: 1250,
      currency: "CAD",
      nextStep: "Reply to approve the reviewed scope.",
    });
  });

  it("preserves reviewed commitments from the legacy proposal format", () => {
    const legacy = [
      "# Proposal: Emergency dentistry conversion page",
      "",
      "**Prepared for:** Northstar Dental",
      "**Suggested service:** Landing page",
      "**Estimated investment:** $900–$1,800",
      "",
      "## What we found",
      "The emergency service has no dedicated page.",
      "",
      "## Proposed scope",
      "- Write and build the agency-reviewed emergency dentistry page.",
      "- Connect its booking call to action.",
      "",
      "## Investment",
      "Landing page: $900–$1,800.",
      "",
      "## Next step",
      "Reply to approve this reviewed scope, then we’ll schedule the work.",
      "",
    ].join("\n");

    expect(parseReviewedProposal(legacy)).toEqual({
      title: "Emergency dentistry conversion page",
      scope: [
        "Write and build the agency-reviewed emergency dentistry page.",
        "Connect its booking call to action.",
      ],
      priceMin: 900,
      priceMax: 1800,
      currency: "USD",
      nextStep: "Reply to approve this reviewed scope, then we’ll schedule the work.",
    });
  });
});
