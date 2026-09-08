import { describe, expect, it } from "vitest";

import {
  DEFAULT_REPORT_THEME,
  REPORT_THEME_OPTIONS,
  normalizeReportTheme,
} from "@/core/reportTheme";

describe("client report themes", () => {
  it("offers a small, named set of print-safe agency themes", () => {
    expect(REPORT_THEME_OPTIONS.map((theme) => theme.id)).toEqual([
      "studio",
      "editorial",
      "signal",
    ]);
    expect(REPORT_THEME_OPTIONS.every((theme) => theme.label && theme.description)).toBe(true);
    expect(DEFAULT_REPORT_THEME).toBe("studio");
  });

  it("fails closed to the default theme for missing or invalid saved values", () => {
    expect(normalizeReportTheme(undefined)).toBe("studio");
    expect(normalizeReportTheme("unknown")).toBe("studio");
    expect(normalizeReportTheme("editorial")).toBe("editorial");
    expect(normalizeReportTheme("signal")).toBe("signal");
  });
});
