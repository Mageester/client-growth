import { describe, expect, it } from "vitest";

import { analyzeClient } from "@/pipeline/analyzeClient";
import { FixtureEvidenceProvider } from "@/adapters/evidence/FixtureEvidenceProvider";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import { generateProposalDraft } from "@/core/proposal";
import { coverageNone, hvacCatalog, hvacClient, hvacEvidence } from "./helpers/fixtures";

describe("generateProposalDraft", () => {
  it("builds an editable markdown draft from the opportunity and evidence", async () => {
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

    expect(md).toContain("# Proposal:");
    expect(md).toContain("Cool Breeze HVAC");
    expect(md).toContain("$900");
    expect(md).toContain("$1,500");
    expect(md).toContain("## Proposed scope");
    expect(md).toContain("https://coolbreezehvac.example/");
    expect(md).not.toContain("nav:"); // nav refs are rendered as plain labels, not raw refs
  });
});
