import { describe, expect, it } from "vitest";

import {
  analysisAdmissionBlocker,
  analysisAdmissionReason,
} from "../app/lib/analysis-readiness";

describe("analysis readiness presentation", () => {
  it("explains the first blocked rule that the active catalog can run", () => {
    const readiness = {
      rules: [
        {
          ruleId: "missing-service-page" as const,
          label: "Missing service page",
          state: "not_ready" as const,
          reason: "Unmatched rule blocker.",
          actionable: true,
        },
        {
          ruleId: "broken-conversion-path" as const,
          label: "Broken conversion path",
          state: "site_coverage_limited" as const,
          reason: "Matched rule blocker.",
          actionable: false,
        },
      ],
      catalog: {
        rules: [
          { ruleId: "missing-service-page" as const, serviceId: null },
          { ruleId: "broken-conversion-path" as const, serviceId: "service-conversion" },
        ],
      },
    };

    expect(analysisAdmissionBlocker(readiness)?.ruleId).toBe("broken-conversion-path");
    expect(analysisAdmissionReason(readiness)).toBe("Matched rule blocker.");
  });

  it("uses the admission fallback when no rule is blocked", () => {
    expect(
      analysisAdmissionReason({
        rules: [],
        catalog: { rules: [] },
      }),
    ).toBe("No ready analysis rule is available for this client yet.");
  });
});
