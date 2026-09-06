import { describe, expect, it } from "vitest";

import { detectOfferingDrift } from "@/core/offeringDrift";

const snapshot = (labels: string[], crawlExhaustive: boolean) => ({
  labels,
  crawlExhaustive,
});

describe("offering drift", () => {
  it("uses the first exhaustive scheduled run as a silent baseline", () => {
    expect(
      detectOfferingDrift({
        trigger: "scheduled",
        current: snapshot(["Heat Pump Servicing"], true),
        previous: null,
      }),
    ).toEqual([]);
  });

  it("returns only labels newly present after an exhaustive baseline", () => {
    expect(
      detectOfferingDrift({
        trigger: "scheduled",
        current: snapshot(
          ["heat pump repair", "Boiler Service", "Heat Pump Servicing", "Heat Pump Servicing"],
          true,
        ),
        previous: snapshot(["Heat Pump Repair", "Boiler Service"], true),
      }),
    ).toEqual(["Heat Pump Servicing"]);
  });

  it("fails closed for manual, incomplete, or untrustworthy baselines", () => {
    const previous = snapshot(["Heat Pump Repair"], true);

    expect(
      detectOfferingDrift({
        trigger: "manual",
        current: snapshot(["Boiler Service"], true),
        previous,
      }),
    ).toEqual([]);
    expect(
      detectOfferingDrift({
        trigger: "scheduled",
        current: snapshot(["Boiler Service"], false),
        previous,
      }),
    ).toEqual([]);
    expect(
      detectOfferingDrift({
        trigger: "scheduled",
        current: snapshot(["Boiler Service"], true),
        previous: snapshot(["Heat Pump Repair"], false),
      }),
    ).toEqual([]);
  });
});
