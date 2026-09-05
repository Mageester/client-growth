import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AppNavigation } from "../app/root";
import ClientsIndex from "../app/routes/clients._index";
import Changes from "../app/routes/changes";
import OpportunityDetail from "../app/routes/opportunities.$id";
import ServicesIndex from "../app/routes/services._index";
import { OpportunityQueue } from "../app/components/signal-desk";
import { PageContextMeta } from "../app/components/ui";

function render(node: ReactNode, initialEntry = "/") {
  const router = createMemoryRouter([{ path: "*", element: node }], {
    initialEntries: [initialEntry],
  });
  return renderToStaticMarkup(
    createElement(RouterProvider, { router }),
  );
}

const opportunity = {
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
};

describe("approved primary information architecture", () => {
  it("shows exactly Home, Clients, Opportunities, and Settings in that order", () => {
    const html = render(createElement(AppNavigation), "/changes");
    const labels = ["Home", "Clients", "Opportunities", "Settings"];

    for (const label of labels) expect(html).toContain(label);
    expect(html).not.toContain("This week");
    expect(html).not.toContain("Services");
    expect(html).not.toContain("Check health");
    expect(labels.map((label) => html.indexOf(label))).toEqual(
      [...labels.map((label) => html.indexOf(label))].sort((a, b) => a - b),
    );
  });
});

describe("approved page anatomy", () => {
  it("makes Home an attention-first view backed by portfolio data", () => {
    const html = render(
      createElement(Changes, {
        loaderData: {
          workspaceName: "Axiom Orbit",
          attention: [
            {
              opportunity,
              client: { id: "c1", name: "Cambridge Heating", domain: "example.com" },
              serviceName: "Dedicated service page",
            },
          ],
          portfolio: { clients: 1, open: 1, priceMin: 900, priceMax: 1800 },
          since: "2026-08-29T12:00:00.000Z",
          until: "2026-09-05T12:00:00.000Z",
          summary: { checks: 1, clientsChecked: 1, newFindings: 1, resolvedFindings: 0, inconclusive: 0 },
          runs: [],
          findings: [],
        },
      } as never),
      "/changes",
    );

    expect(html).toContain("What deserves your attention");
    expect(html).toContain("Cambridge Heating");
    expect(html).toContain("$900 – $1,800");
  });

  it("gives Clients the approved scannable columns", () => {
    const html = render(
      createElement(ClientsIndex, {
        loaderData: {
          clients: [
            {
              id: "c1",
              name: "Cambridge Heating",
              domain: "example.com",
              offerings: ["Heating"],
              notes: "",
              totals: { open: 1, closed: 0, priceMin: 900, priceMax: 1800 },
              lastRunAt: "2026-09-05T12:00:00.000Z",
              runSummary: "One opportunity found.",
              state: "attention",
            },
          ],
        },
      } as never),
      "/clients",
    );

    for (const label of ["Client", "Opportunities", "Potential value", "Status", "Last checked"]) {
      expect(html).toContain(label);
    }
  });

  it("uses the approved opportunity detail tabs and proposal action", () => {
    const html = render(
      createElement(OpportunityDetail, {
        loaderData: {
          opportunity,
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
      } as never),
      "/opportunities/o1",
    );

    for (const label of ["Overview", "Evidence", "Recommendations", "Activity"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Create proposal");
  });

  it("places Services inside a secondary Settings navigation", () => {
    const html = render(
      createElement(ServicesIndex, { loaderData: { services: [] } } as never),
      "/services",
    );

    for (const label of ["General", "Integrations", "Services", "Team", "Billing"]) {
      expect(html).toContain(label);
    }
    // Check health is a Settings section too, which is what lets the primary
    // sidebar stay at four destinations.
    expect(html).toContain("Check health");
    expect(html).toContain("Manage the services you offer to clients.");
  });
});

describe("approved interaction model", () => {
  it("gives the opportunity queue one current row and one tab stop", () => {
    // The highlighted row in the reference is a keyboard cursor, not decoration:
    // exactly one row is current, and only that row is reachable by Tab.
    const entries = [
      {
        opportunity,
        client: { id: "c1", name: "Cambridge Heating", domain: "example.com" },
        serviceName: "Dedicated service page",
      },
      {
        opportunity: { ...opportunity, id: "o2", title: "Duplicate page title" },
        client: { id: "c2", name: "Atlas", domain: "atlas.example" },
        serviceName: "Duplicate title cleanup",
      },
    ];
    const html = render(
      createElement(OpportunityQueue, {
        entries,
        hrefFor: (entry: (typeof entries)[number]) => `/opportunities/${entry.opportunity.id}`,
      } as never),
      "/opportunities",
    );

    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html.match(/tabindex="0"/gi)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/gi)).toHaveLength(1);
  });

  it("makes the appearance control an actual control", () => {
    // A sun that only looks clickable is worse than no sun at all.
    const html = render(createElement(PageContextMeta, { dateTime: "2026-09-05T12:00:00.000Z" }));

    expect(html).toContain("<button");
    expect(html).toContain("aria-label=\"Switch to light appearance\"");
  });
});
