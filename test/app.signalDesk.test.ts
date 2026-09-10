import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";

import {
  OpportunityInspector,
  OpportunitySignalRow,
  type SignalDeskEntry,
} from "../app/components/signal-desk";
import OpportunityDetail from "../app/routes/opportunities.$id";

const entry: SignalDeskEntry = {
  client: {
    id: "client-blue-peak",
    name: "Blue Peak HVAC",
    domain: "bluepeakhvac.example",
  },
  serviceName: "Service Landing Page",
  opportunity: {
    id: "opp-heat-pump",
    dedupeKey: "missing-service-page:heat-pump-installation",
    clientId: "client-blue-peak",
    ruleId: "missing-service-page",
    title: "No page for heat pump installation",
    detected: "Heat pump installation is listed as a core offering, but the site has no page for it.",
    rationale: "A dedicated page gives high-intent demand somewhere useful to land.",
    evidenceRefs: ["page:https://bluepeakhvac.example/services"],
    suppressedEvidenceRefs: [],
    suggestedServiceId: "service-page",
    suggestedScope: ["Keyword and intent review", "Page copy", "Lead form"],
    priceMin: 900,
    priceMax: 1800,
    confidence: 0.86,
    billableStatus: "billable",
    status: "new",
    updatedAt: "2026-09-02T12:00:00.000Z",
  },
};

function render(node: ReactNode) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, node));
}

describe("Signal Desk opportunity presentation", () => {
  it("makes the account, value, service, evidence strength, and open state scannable", () => {
    const html = render(
      createElement(OpportunitySignalRow, {
        entry,
        selected: true,
        selectHref: "?opportunity=opp-heat-pump",
      }),
    );

    expect(html).toContain("No page for heat pump installation");
    expect(html).toContain("Blue Peak HVAC");
    expect(html).toContain("Service Landing Page");
    expect(html).toContain("$900 – $1,800");
    expect(html).not.toContain("86%");
    expect(html).toContain('class="evidence-strength">Strong evidence</small>');
    expect(html).toContain("Prepare client proposal");
    expect(html).toContain("Open");
    expect(html).toContain('aria-current="true"');
  });

  it("keeps the affected-page count in an aggregate signal title", () => {
    const html = render(
      createElement(OpportunitySignalRow, {
        entry: {
          ...entry,
          opportunity: {
            ...entry.opportunity,
            ruleId: "missing-meta-description",
            title: "Missing meta description — 7 pages",
          },
        },
        selected: false,
        selectHref: "?opportunity=opp-meta",
      }),
    );

    expect(html).toContain("Missing meta description — 7 pages");
  });

  it("turns the selected signal into an evidence-backed next action", () => {
    const html = render(createElement(OpportunityInspector, { entry, closeHref: "?" }));

    expect(html).toContain("Why it matters");
    expect(html).toContain("A dedicated page gives high-intent demand somewhere useful to land.");
    expect(html).toContain("Evidence strength");
    expect(html).toContain("Strong evidence");
    expect(html).not.toContain("86%");
    expect(html).toContain("Services");
    expect(html).toContain("Prepare client proposal");
    expect(html).toContain("/opportunities/opp-heat-pump");
  });

  it("uses review language once a proposal draft exists", () => {
    const html = render(
      createElement(OpportunityInspector, {
        entry: {
          ...entry,
          opportunity: {
            ...entry.opportunity,
            status: "proposal_prepared",
            proposalMd: "# Draft",
          },
        },
        closeHref: "?",
      }),
    );

    expect(html).toContain("Review proposal");
    expect(html).not.toContain("Prepare client proposal");
  });

  it("keeps draft review aligned for active and expired snoozes", () => {
    for (const snoozeUntil of ["2099-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z"]) {
      const opportunity = {
        ...entry.opportunity,
        status: "snoozed" as const,
        snoozeUntil,
        proposalMd: "# Edited draft",
      };
      const rowHtml = render(
        createElement(OpportunitySignalRow, {
          entry: { ...entry, opportunity },
          selected: true,
          selectHref: "?opportunity=opp-heat-pump",
        }),
      );
      expect(rowHtml).toContain("Review proposal");
      expect(rowHtml).not.toContain("Prepare client proposal");

      const detail = createElement(OpportunityDetail, {
        loaderData: {
          opportunity: {
            ...opportunity,
            evidenceRefs: ["https://bluepeakhvac.example/services"],
            suppressedEvidenceRefs: [],
          },
          client: entry.client,
          service: {
            id: "service-page",
            name: "Service Landing Page",
            description: "A focused page for a specific service.",
            priceMin: 900,
            priceMax: 1800,
            tags: ["landing-page"],
            active: true,
          },
          lastRunAt: "2026-09-02T12:00:00.000Z",
          evidence: { headline: "One page checked", inspectedCount: 1, primary: [], secondary: [] },
        },
      } as never);
      const router = createMemoryRouter([{ path: "*", element: detail }], {
        initialEntries: ["/opportunities/opp-heat-pump"],
      });
      const detailHtml = renderToStaticMarkup(createElement(RouterProvider, { router }));
      expect(detailHtml).toMatch(/href="[^"]*#proposal-draft"/);
      expect(detailHtml).not.toContain('name="intent" value="prepare-proposal"');
    }
  });
});
