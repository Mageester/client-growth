import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { readFileSync } from "node:fs";

import { deferMenuClose } from "../app/components/ui";
import { AppNavigation, ThemePicker, isProposalSharePath, loader as rootLoader } from "../app/root";
import { __setSessionResolver } from "../app/lib/session.server";

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
  it("keeps the product focused on the approved four-screen hierarchy", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/opportunities"] },
        createElement(AppNavigation),
      ),
    );

    expect(html).toContain("Home");
    expect(html).toContain("Clients");
    expect(html).toContain("Opportunities");
    expect(html).toContain("Settings");
    expect(html).not.toContain("Services");
    expect(html).not.toContain("This week");
    expect(html).not.toContain("Check health");
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

describe("mobile viewport safety", () => {
  it("does not force the document wider than a narrow phone viewport", () => {
    const css = readFileSync(new URL("../app/styles/app.css", import.meta.url), "utf8");
    const bodyRules = [...css.matchAll(/^body\s*\{(?<declarations>[^}]*)\}/gm)]
      .map((match) => match.groups?.declarations ?? "")
      .join("\n");

    expect(bodyRules).not.toMatch(/min-width\s*:\s*320px/);
  });
});

describe("opportunity inspector values", () => {
  it("wraps long metric values instead of clipping their left edge", () => {
    const css = readFileSync(new URL("../app/styles/signal-desk.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.inspector-metrics\s+dd\s*\{[\s\S]*display:\s*block/);
    expect(css).toMatch(/\.inspector-metrics\s+dd\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.inspector-metrics\s+dd\s*\{[\s\S]*white-space:\s*normal/);
  });
});

describe("public proposal share shell", () => {
  it.each(["/proposal/share", "/proposal/share/", "/PROPOSAL/SHARE/", "/proposal/%73hare"]) (
    "recognizes %s as the standalone share path",
    (pathname) => {
      expect(isProposalSharePath(pathname)).toBe(true);
    },
  );

  it.each(["/proposal/share-extra", "/proposal//share", "/proposal%2Fshare"]) (
    "does not treat %s as the share path",
    (pathname) => {
      expect(isProposalSharePath(pathname)).toBe(false);
    },
  );

  it("skips session resolution for a matched share path with a trailing slash", async () => {
    let sessionLookups = 0;
    __setSessionResolver(async () => {
      sessionLookups += 1;
      return null;
    });
    try {
      const result = await rootLoader({
        request: new Request("http://localhost/proposal/share/?token=test"),
        context: { cloudflare: { env: { DB: {} } } },
      } as never);

      expect(result.signedIn).toBe(false);
      expect(sessionLookups).toBe(0);
    } finally {
      __setSessionResolver(null);
    }
  });

  it("keeps the public proposal readable on printed paper", () => {
    const css = readFileSync(new URL("../app/styles/signal-desk.css", import.meta.url), "utf8");
    expect(css).toMatch(/@media\s+print\s*\{/);
    expect(css).toMatch(/@media\s+print[\s\S]*--bg:\s*#fff/);
    expect(css).toMatch(/@media\s+print[\s\S]*\.proposal-share-page/);
  });
});
