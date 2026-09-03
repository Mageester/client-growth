import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { deferMenuClose } from "../app/components/ui";
import { AppNavigation, ThemePicker } from "../app/root";

describe("menu activation", () => {
  it("defers closing until a nested form can submit", () => {
    vi.useFakeTimers();
    try {
      const events: string[] = [];

      deferMenuClose(() => events.push("close"));
      events.push("submit");

      expect(events).toEqual(["submit"]);
      vi.runOnlyPendingTimers();
      expect(events).toEqual(["submit", "close"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("application navigation", () => {
  it("keeps the product focused on the three real portfolio workflows", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/opportunities"] },
        createElement(AppNavigation),
      ),
    );

    expect(html).toContain("Opportunities");
    expect(html).toContain("Clients");
    expect(html).toContain("Services");
    expect(html).not.toContain("Reports");
    expect(html).not.toContain("Monitoring");
  });

  it("offers explicit light, dark, and system workspace themes", () => {
    const html = renderToStaticMarkup(
      createElement(ThemePicker, { value: "system", onChange: () => undefined }),
    );

    expect(html).toContain("Appearance");
    expect(html).toContain("Light");
    expect(html).toContain("Dark");
    expect(html).toContain("System");
    expect(html).toContain('aria-pressed="true"');
  });
});
