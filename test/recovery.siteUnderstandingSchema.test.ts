import { describe, expect, it } from "vitest";
import {
  SiteUnderstandingInputSchema,
  validateCriticDecisionsWithRepair,
  validateProblemDrafts,
} from "@/core/siteUnderstandingSchema";

const input = {
  clientId: "client-1",
  clientFacts: {
    clientId: "client-1",
    name: "Example Client",
    domain: "example.com",
    offerings: ["roof repair"],
    notes: "",
  },
  evidence: [{
    id: "evidence-1",
    runId: "run-1",
    kind: "page",
    locator: "homepage",
    observedAt: "2026-09-19T00:00:00.000Z",
    payload: { title: "Example Client" },
  }],
  diagnostics: [],
  categories: [],
  capabilities: [],
  subtypeDefinitions: [{
    problemType: "placeholder_production_content",
    category: "content_freshness",
    claimKind: "presence",
    minimumGrade: "moderate",
    requiresCompleteCoverage: false,
    requiresCounterEvidence: false,
    projectWorkstream: "content-freshness",
    legacyRuleId: null,
    reconciliationPolicy: "condition_clears_with_current_evidence",
  }],
};

describe("recovered site-understanding contracts", () => {
  it("validates model drafts against supplied evidence and assigns stable IDs", () => {
    expect(() => SiteUnderstandingInputSchema.parse(input)).not.toThrow();
    const result = validateProblemDrafts(input, [{
      clientId: "client-1",
      category: "content_freshness",
      problemType: "placeholder_production_content",
      canonicalSurface: "homepage-copy",
      rootCause: "template-copy",
      diagnosticIds: [],
      evidenceIds: ["evidence-1"],
      statement: "The homepage contains unfinished template wording.",
      whyItMatters: "Visitors may read the site as unfinished.",
      businessConsequence: "Trust can be reduced before a visitor contacts the business.",
      validationSteps: ["Review the homepage copy against the supplied page evidence."],
    }]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.draftId).toMatch(/^draft_[0-9a-f]{16}$/);
  });

  it("withholds critic items with missing decisions instead of publishing them", () => {
    const draft = validateProblemDrafts(input, [{
      clientId: "client-1",
      category: "content_freshness",
      problemType: "placeholder_production_content",
      canonicalSurface: "homepage-copy",
      rootCause: "template-copy",
      diagnosticIds: [],
      evidenceIds: ["evidence-1"],
      statement: "The homepage contains unfinished template wording.",
      whyItMatters: "Visitors may read the site as unfinished.",
      validationSteps: ["Review the homepage copy against the supplied page evidence."],
    }]).drafts[0]!;
    const repaired = validateCriticDecisionsWithRepair([], [draft]);
    expect(repaired.repaired).toBe(true);
    expect(repaired.decisions[0]).toMatchObject({ draftId: draft.draftId, decision: "reject" });
  });
});
