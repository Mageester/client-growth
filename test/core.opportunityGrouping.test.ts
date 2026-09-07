import { describe, expect, it } from "vitest";

import { groupOpportunitiesByFamily } from "@/core/opportunityGrouping";

function entry(id: string, ruleId: string, priceMin: number) {
  return {
    opportunity: {
      id,
      ruleId,
      priceMin,
      priceMax: priceMin + 100,
      status: "new",
    },
    client: { id: "client-a", name: "Acme", domain: "acme.example" },
    serviceName: "Agency service",
  };
}

describe("opportunity family grouping", () => {
  it("groups related findings without changing their rows or commercial values", () => {
    const servicePage = entry("opp-page", "missing-service-page", 900);
    const competitor = entry("opp-competitor", "competitor-service-gap", 900);
    const conversion = entry("opp-conversion", "broken-conversion-path", 300);
    const technicalBase = entry("opp-title", "missing-title", 150);
    const technical = {
      ...technicalBase,
      opportunity: { ...technicalBase.opportunity, status: "resolved" },
    };

    const groups = groupOpportunitiesByFamily([servicePage, competitor, conversion, technical]);

    expect(groups.map((group) => [group.family.key, group.entries.map((item) => item.opportunity.id)])).toEqual([
      ["service-visibility", ["opp-page", "opp-competitor"]],
      ["conversion", ["opp-conversion"]],
      ["site-health", ["opp-title"]],
    ]);
    expect(groups[0]!.entries[0]).toBe(servicePage);
    expect(groups.flatMap((group) => group.entries).map((item) => item.opportunity.priceMin)).toEqual([
      900,
      900,
      300,
      150,
    ]);
    expect(groups[2]!.entries[0]!.opportunity.status).toBe("resolved");
  });

  it("keeps separate clients in separate family groups", () => {
    const first = entry("opp-a", "missing-service-page", 900);
    const second = { ...entry("opp-b", "missing-service-page", 900), client: { id: "client-b", name: "Beta", domain: "beta.example" } };

    const groups = groupOpportunitiesByFamily([first, second]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.key)).toEqual(["client-a:service-visibility", "client-b:service-visibility"]);
  });
});
