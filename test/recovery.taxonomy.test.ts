import { describe, expect, it } from "vitest";
import {
  EVIDENCE_GRADES,
  INSIGHT_CATEGORIES,
  INSIGHT_DEFINITIONS,
  INSIGHT_PROBLEM_TYPES,
  MODEL_ANCHORED_PROBLEM_TYPES,
  SITE_GROUNDED_PROVENANCE,
  definitionForProblemType,
} from "@/core/insightTaxonomy";

describe("recovered insight taxonomy", () => {
  it("keeps the bounded production categories and model-anchored subtypes", () => {
    expect(INSIGHT_CATEGORIES).toHaveLength(10);
    expect(INSIGHT_PROBLEM_TYPES).toContain("visual_conversion_obstacle");
    expect(INSIGHT_PROBLEM_TYPES).toContain("inconsistent_content_fact");
    expect(MODEL_ANCHORED_PROBLEM_TYPES.has("dead_action_target")).toBe(true);
    expect(EVIDENCE_GRADES).toEqual(["strong", "moderate", "limited", "insufficient"]);
    expect(SITE_GROUNDED_PROVENANCE.has("SITE_OBSERVED")).toBe(true);
  });

  it("exposes auditable policy for legacy and semantic findings", () => {
    expect(definitionForProblemType("missing_service_path")).toMatchObject({
      category: "service_discovery",
      claimKind: "absence",
      minimumGrade: "strong",
      legacyRuleId: "missing-service-page",
      priority: "C",
    });
    expect(definitionForProblemType("placeholder_production_content")).toMatchObject({
      claimKind: "presence",
      legacyRuleId: null,
      priority: "A",
    });
    expect(Object.keys(INSIGHT_DEFINITIONS)).toHaveLength(31);
    expect(() => definitionForProblemType("unknown" as never)).toThrow();
  });
});
