import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import {
  OpportunityInspector,
  OpportunitySignalRow,
  type SignalDeskEntry,
} from "../app/components/signal-desk";

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
    expect(html).toContain("$900–$1,800");
    expect(html).toContain("86%");
    expect(html).toContain("Open");
    expect(html).toContain('aria-current="true"');
  });

  it("turns the selected signal into an evidence-backed next action", () => {
    const html = render(createElement(OpportunityInspector, { entry, closeHref: "?" }));

    expect(html).toContain("Why it matters");
    expect(html).toContain("A dedicated page gives high-intent demand somewhere useful to land.");
    expect(html).toContain("Evidence strength");
    expect(html).toContain("Services");
    expect(html).toContain("Review &amp; prepare proposal");
    expect(html).toContain("/opportunities/opp-heat-pump");
  });
});
