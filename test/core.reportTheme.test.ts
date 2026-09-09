import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

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

  it("applies every saved theme to compact report headers, titles, and domains", () => {
    const css = readFileSync(new URL("../app/styles/orbit-approved.css", import.meta.url), "utf8");
    const documentRule = /\.client-report-document\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    const headerRule = /\.client-report-compact-header\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    const titleRule = /\.client-report-compact-title h2\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    const domainRule = /\.client-report-compact-title p\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";

    expect(documentRule).toMatch(/--report-theme-soft:/);
    expect(documentRule).toMatch(/--report-theme-paper:/);
    expect(documentRule).toMatch(/--report-theme-ink:/);
    expect(documentRule).toMatch(/--report-theme-muted:/);
    expect(documentRule).toMatch(/--report-theme-line:/);
    expect(headerRule).toMatch(/border-bottom:\s*1px solid var\(--report-theme-line\)/);
    expect(headerRule).toMatch(/var\(--report-theme-soft\)/);
    expect(headerRule).toMatch(/var\(--report-theme-paper\)/);
    expect(titleRule).toMatch(/color:\s*var\(--report-theme-ink\)/);
    expect(domainRule).toMatch(/color:\s*var\(--report-theme-muted\)/);

    for (const theme of ["editorial", "signal"]) {
      const themedRule = new RegExp(
        `\\.client-report-document\\[data-report-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\}`,
      ).exec(css)?.[1] ?? "";
      expect(themedRule).toMatch(/--report-theme-soft:/);
      expect(themedRule).toMatch(/--report-theme-paper:/);
      expect(themedRule).toMatch(/--report-theme-ink:/);
      expect(themedRule).toMatch(/--report-theme-muted:/);
      expect(themedRule).toMatch(/--report-theme-line:/);
    }
  });
});
