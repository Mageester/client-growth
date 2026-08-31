import { describe, expect, it } from "vitest";

import { runRules } from "@/core/rules";
import { hvacCatalog, hvacClient, hvacEvidence } from "./helpers/fixtures";

describe("missing-service-page rule", () => {
  it("surfaces exactly the offering that has no dedicated page", async () => {
    const candidates = await runRules({
      client: hvacClient(),
      catalog: hvacCatalog(),
      evidence: hvacEvidence(),
    });

    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate?.ruleId).toBe("missing-service-page");
    expect(candidate?.subject).toBe("heat pump installation");
    expect(candidate?.suggestedServiceId).toBe("svc-landing-page");
    expect(candidate?.verification?.conclusion).toBe("absent");
  });

  it("does not flag offerings that already have a matching page or nav entry", async () => {
    const candidates = await runRules({
      client: hvacClient(),
      catalog: hvacCatalog(),
      evidence: hvacEvidence(),
    });
    const subjects = candidates.map((c) => c.subject);
    expect(subjects).not.toContain("air conditioning repair");
    expect(subjects).not.toContain("furnace installation");
    expect(subjects).not.toContain("duct cleaning");
  });

  it("preserves evidence references for the detection", async () => {
    const [candidate] = await runRules({
      client: hvacClient(),
      catalog: hvacCatalog(),
      evidence: hvacEvidence(),
    });
    expect(candidate?.evidenceRefs).toContain("https://coolbreezehvac.example/");
    expect(candidate?.evidenceRefs.length).toBeGreaterThan(0);
    expect(candidate?.rawConfidence).toBeGreaterThanOrEqual(0.5);
  });

  it("proposes nothing when the agency has no landing-page service", async () => {
    const catalogWithoutLandingPages = hvacCatalog().filter(
      (s) => !s.tags.includes("landing-page"),
    );
    const candidates = await runRules({
      client: hvacClient(),
      catalog: catalogWithoutLandingPages,
      evidence: hvacEvidence(),
    });
    expect(candidates).toHaveLength(0);
  });
});
