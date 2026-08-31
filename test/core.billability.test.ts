import { describe, expect, it } from "vitest";

import { resolveBillability } from "@/core/billability";
import { coverageLandingPages, coverageNone } from "./helpers/fixtures";

describe("resolveBillability", () => {
  it("is billable when the mapped service is not covered by the contract", () => {
    expect(resolveBillability("svc-landing-page", coverageNone())).toBe("billable");
  });

  it("is already_covered when the mapped service is covered by the contract", () => {
    expect(resolveBillability("svc-landing-page", coverageLandingPages())).toBe(
      "already_covered",
    );
  });

  it("only matches the specific covered service id", () => {
    expect(resolveBillability("svc-seo-retainer", coverageLandingPages())).toBe("billable");
  });
});
