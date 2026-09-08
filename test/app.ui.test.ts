import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { readFileSync } from "node:fs";

import { AnalysisRunning, formatCurrencyRange, deferMenuClose } from "../app/components/ui";
import {
  AppNavigation,
  ThemePicker,
  isClientReportSharePath,
  isProposalSharePath,
  loader as rootLoader,
} from "../app/root";
import { homeRenderClock } from "../app/routes/changes";
import { healthSectionDescription } from "../app/routes/opportunities._index";
import OpportunityDetail from "../app/routes/opportunities.$id";
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

  it("gives a running analysis an explicit stop action", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/clients/client-1"] },
        createElement(AnalysisRunning, {
          clientName: "Northstar Growth Studio",
          domain: "northstar.example",
          stopHref: "/clients/client-1",
        } as never),
      ),
    );

    expect(html).toContain("Stop reading");
    expect(html).toContain('href="/clients/client-1"');
  });

  it("switches the Orbit detail and opportunity feed to fluid phone layouts", () => {
    const css = readFileSync(new URL("../app/styles/orbit-approved.css", import.meta.url), "utf8");
    const phoneRules = css.slice(css.lastIndexOf("@media (max-width: 700px)"));

    expect(phoneRules).toMatch(/\.app-frame \.detail\s*\{[\s\S]*box-sizing:\s*border-box/);
    expect(phoneRules).toMatch(/\.app-frame \.signal-row-select\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(phoneRules).toMatch(/\.app-frame \.signal-row-client\s*\{[\s\S]*grid-column:\s*1/);
    expect(phoneRules).toMatch(/\.app-frame \.signal-row-age\s*\{[\s\S]*display:\s*none/);
    expect(phoneRules).toMatch(/\.app-frame \.attention-tags\s*\{[\s\S]*flex-wrap:\s*wrap/);
    expect(phoneRules).toMatch(/\.app-frame \.detail-overview \.case[\s\S]*min-width:\s*0/);
    expect(phoneRules).toMatch(/\.app-frame \.settings-nav\s*\{[\s\S]*grid-template-columns:\s*repeat\(2/);
    expect(phoneRules).toMatch(/\.app-frame \.services-table\s*\{[\s\S]*overflow:\s*visible/);
    expect(phoneRules).toMatch(/\.app-frame \.services-table \.records\s*\{[\s\S]*min-width:\s*0/);
    expect(phoneRules).toMatch(/\.app-frame \.services-table \.record-name\s*\{[\s\S]*text-overflow:\s*clip/);
    expect(phoneRules).toMatch(/\.app-frame \.services-table \.record-name\s*\{[\s\S]*white-space:\s*normal/);
    expect(phoneRules).toMatch(/\.app-frame \.detail \.record-meta\s*\{[\s\S]*min-width:\s*0/);
    expect(phoneRules).toMatch(/\.app-frame \.detail \.record-meta > span:last-child\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.app-frame \.opportunities-page \.orbit-select-wrap\s*\{[\s\S]*width:\s*180px/);
  });

  it("keeps finding identity readable when rows get narrow", () => {
    const signalCss = readFileSync(new URL("../app/styles/signal-desk.css", import.meta.url), "utf8");
    const orbitCss = readFileSync(new URL("../app/styles/orbit-approved.css", import.meta.url), "utf8");
    const css = `${signalCss}\n${orbitCss}`;
    const signalOverride = /\.app-frame \.signal-desk \.signal-row-title\s*\{([\s\S]*?)\}/.exec(css);
    const laterOrbitRule = /\.app-frame \.signal-row-title\s*\{([\s\S]*?)\}/.exec(css);
    const selectorSpecificity = (selector: string) => (selector.match(/[.#\[]/g) ?? []).length;

    expect(signalOverride?.[1]).toMatch(/overflow:\s*visible/);
    expect(signalOverride?.[1]).toMatch(/-webkit-line-clamp:\s*unset/);
    expect(signalOverride?.[1]).toMatch(/white-space:\s*normal/);
    expect(signalOverride?.[1]).toMatch(/overflow-wrap:\s*anywhere/);
    expect(signalOverride?.[1]).toMatch(/text-overflow:\s*clip/);
    expect(laterOrbitRule?.[1]).toMatch(/-webkit-line-clamp:\s*2/);
    expect(css.indexOf(".app-frame .signal-desk .signal-row-title")).toBeLessThan(
      css.lastIndexOf(".app-frame .signal-row-title"),
    );
    expect(selectorSpecificity(".app-frame .signal-desk .signal-row-title")).toBeGreaterThan(
      selectorSpecificity(".app-frame .signal-row-title"),
    );
    expect(css).toMatch(/\.app-frame \.signal-desk \.signal-row-client-name\s*\{[\s\S]*white-space:\s*normal/);
    expect(css).toMatch(/\.app-frame \.signal-desk \.signal-row-context > span\s*\{[\s\S]*overflow:\s*visible/);
  });

  it("keeps public proposal pages fluid on a phone", () => {
    const css = readFileSync(new URL("../app/styles/app.css", import.meta.url), "utf8");
    expect(css).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*\.detail\.detail-narrow\.proposal-share-page\s*\{[\s\S]*box-sizing:\s*border-box[\s\S]*max-width:\s*100%/,
    );
  });

  it("anchors time-sensitive home copy to the loader snapshot", () => {
    const changes = readFileSync(new URL("../app/routes/changes.tsx", import.meta.url), "utf8");
    const until = "2026-09-06T18:00:00.000Z";
    expect(homeRenderClock(until)).toBe(Date.parse(until));
    expect(changes).toContain("const renderNow = homeRenderClock(data.until);");
    expect(changes).toContain("greeting(new Date(renderNow))");
    expect(changes).toContain("formatRelative(item.at, renderNow)");
  });

  it("labels the all-findings view as history instead of open work", () => {
    expect(healthSectionDescription(3, "open")).toMatch(/worth fixing/);
    expect(healthSectionDescription(3, "all")).toMatch(/history/i);
    expect(healthSectionDescription(3, "all")).not.toMatch(/worth fixing/);
  });
});

describe("opportunity inspector values", () => {
  it("wraps long metric values instead of clipping their left edge", () => {
    const css = readFileSync(new URL("../app/styles/signal-desk.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.inspector-metrics\s+dd\s*\{[\s\S]*display:\s*block/);
    expect(css).toMatch(/\.inspector-metrics\s+dd\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.inspector-metrics\s+dd\s*\{[\s\S]*white-space:\s*normal/);
  });

  it("puts a concise evidence summary before the primary proposal action", () => {
    const detail = createElement(OpportunityDetail, {
      loaderData: {
        opportunity: {
          id: "o1",
          dedupeKey: "missing-service-page:heat-pumps",
          clientId: "c1",
          ruleId: "missing-service-page",
          title: "Heat pump service page",
          detected: "The service is offered but has no dedicated page.",
          evidenceRefs: ["https://example.com/services"],
          suppressedEvidenceRefs: [],
          rationale: "A dedicated page gives high-intent demand somewhere useful to land.",
          suggestedServiceId: "s1",
          suggestedScope: ["Write the service page"],
          priceMin: 900,
          priceMax: 1800,
          confidence: 0.75,
          billableStatus: "billable",
          status: "new",
          updatedAt: "2026-09-05T12:00:00.000Z",
        },
        client: { id: "c1", name: "Cambridge Heating", domain: "example.com" },
        service: {
          id: "s1",
          name: "Dedicated service page",
          description: "A focused page for a specific service.",
          priceMin: 900,
          priceMax: 1800,
          tags: ["landing-page"],
          active: true,
        },
        lastRunAt: "2026-09-05T12:00:00.000Z",
        evidence: { headline: "One page checked", inspectedCount: 1, primary: [], secondary: [] },
      },
    } as never);
    const router = createMemoryRouter([{ path: "*", element: detail }], {
      initialEntries: ["/opportunities/o1"],
    });
    const html = renderToStaticMarkup(
      createElement(RouterProvider, { router }),
    );

    expect(html).toContain("Evidence summary");
    expect(html).toContain("One page checked");
    expect(html).toContain("Prepare client proposal");
    expect(html.indexOf("Evidence summary")).toBeLessThan(html.indexOf("Prepare client proposal"));
    // The Decide section leads with the funnel's first question for a NEW
    // finding: is it worth pursuing.
    expect(html).toContain("Worth pursuing?");
    expect(html).toContain('name="intent" value="accept"');
  });

  it("reviews an existing draft without submitting prepare-proposal", () => {
    const detail = createElement(OpportunityDetail, {
      loaderData: {
        opportunity: {
          id: "o1",
          dedupeKey: "missing-service-page:heat-pumps",
          clientId: "c1",
          ruleId: "missing-service-page",
          title: "Heat pump service page",
          detected: "The service is offered but has no dedicated page.",
          evidenceRefs: ["https://example.com/services"],
          suppressedEvidenceRefs: [],
          rationale: "A dedicated page gives high-intent demand somewhere useful to land.",
          suggestedServiceId: "s1",
          suggestedScope: ["Write the service page"],
          priceMin: 900,
          priceMax: 1800,
          confidence: 0.75,
          billableStatus: "billable",
          status: "proposal_prepared",
          proposalMd: "# Edited draft",
          updatedAt: "2026-09-05T12:00:00.000Z",
        },
        client: { id: "c1", name: "Cambridge Heating", domain: "example.com" },
        service: {
          id: "s1",
          name: "Dedicated service page",
          description: "A focused page for a specific service.",
          priceMin: 900,
          priceMax: 1800,
          tags: ["landing-page"],
          active: true,
        },
        lastRunAt: "2026-09-05T12:00:00.000Z",
        evidence: { headline: "One page checked", inspectedCount: 1, primary: [], secondary: [] },
      },
    } as never);
    const router = createMemoryRouter([{ path: "*", element: detail }], {
      initialEntries: ["/opportunities/o1"],
    });
    const html = renderToStaticMarkup(createElement(RouterProvider, { router }));

    expect(html).toContain("Review proposal");
    expect(html).toMatch(/href="[^"]*#proposal-draft"/);
    expect(html).not.toContain('name="intent" value="prepare-proposal"');
    expect(html).toContain("Edited draft");
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

  it.each(["/report/share", "/report/share/", "/REPORT/SHARE/"]) (
    "recognizes %s as the standalone client report path",
    (pathname) => {
      expect(isClientReportSharePath(pathname)).toBe(true);
    },
  );

  it("skips session resolution for a matched client report path", async () => {
    let sessionLookups = 0;
    __setSessionResolver(async () => {
      sessionLookups += 1;
      return null;
    });
    try {
      const result = await rootLoader({
        request: new Request("http://localhost/report/share?token=test"),
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

describe("money formatting", () => {
  it("shows a single amount as an amount, not as a range with equal ends", () => {
    // Recorded sales and single-price services both arrive with min === max.
    expect(formatCurrencyRange(9400, 9400)).toBe("$9,400");
    expect(formatCurrencyRange(0, 0)).toBe("$0");
  });

  it("still shows a real range as a range", () => {
    expect(formatCurrencyRange(900, 1800)).toBe("$900 – $1,800");
  });
});
