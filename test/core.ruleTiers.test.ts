import { describe, expect, it } from "vitest";

import { RULE_SERVICE_LINKS, isCommercialRule, tierForRule } from "@/core/rules/registry";
import { RuleIdSchema } from "@/core/schema";

describe("which findings lead the queue", () => {
  it("gives every rule in the schema a tier, so none can drift in untiered", () => {
    const tiered = new Set(RULE_SERVICE_LINKS.map((link) => link.ruleId));
    for (const ruleId of RuleIdSchema.options) {
      expect(tiered.has(ruleId), `${ruleId} has no registry entry`).toBe(true);
    }
  });

  it("treats the three rules that need to know what the business sells as commercial", () => {
    // These are the only findings that depend on the recorded offerings, which
    // is the one thing a site crawler cannot know. They are the product.
    expect(isCommercialRule("missing-service-page")).toBe(true);
    expect(isCommercialRule("no-service-pages")).toBe(true);
    expect(isCommercialRule("broken-conversion-path")).toBe(true);
  });

  it("treats the checks any SEO crawler already gives away as site health", () => {
    for (const ruleId of [
      "missing-title",
      "duplicate-title",
      "thin-service-page",
      "missing-h1",
      "broken-internal-link",
      "missing-meta-description",
      "missing-structured-data",
      "missing-image-alt",
    ] as const) {
      expect(tierForRule(ruleId), ruleId).toBe("health");
    }
  });

  it("puts an unrecognised rule in the appendix rather than the queue", () => {
    // Erring toward "health" is recoverable; promoting a finding nobody has
    // classified into the list an agency reads as sellable work is not.
    expect(tierForRule("not-a-real-rule" as never)).toBe("health");
  });

  it("keeps commercial findings a small minority of the rule set, by design", () => {
    const commercial = RULE_SERVICE_LINKS.filter((link) => link.tier === "commercial");
    expect(commercial.length).toBeLessThan(RULE_SERVICE_LINKS.length / 2);
  });
});
