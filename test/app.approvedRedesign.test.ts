import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AppNavigation } from "../app/root";
import ClientsIndex from "../app/routes/clients._index";
import Changes from "../app/routes/changes";
import OpportunityDetail from "../app/routes/opportunities.$id";
import Onboarding from "../app/routes/onboarding";
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
  it("keeps activation fields intact inside the collapsed pricing review", () => {
    const html = render(
      createElement(Onboarding, {
        loaderData: {
          stage: "setup",
          hasWorkspace: false,
          client: null,
          readFailed: false,
          crawl: null,
          suggestions: [],
        },
        actionData: undefined,
      } as never),
      "/onboarding",
    );

    expect(html).toContain("Review starter pricing");
    expect(html).not.toMatch(/<details[^>]*\bopen(?:=|>)/);
    const starters = [
      ["landing", "Service Landing Page", "900", "1800"],
      ["servicepages", "Service Pages Build", "2500", "6000"],
      ["competitorgap", "Competitor Gap Page", "900", "1800"],
      ["conversion", "Conversion Path Fix", "300", "900"],
      ["missingtitle", "Page Title Repair", "150", "300"],
      ["duplicatetitle", "Duplicate Title Repair", "200", "400"],
      ["thinservice", "Thin Service Page", "400", "800"],
      ["missingh1", "H1 Heading Repair", "150", "300"],
      ["internallink", "Internal Link Repair", "200", "500"],
      ["metadescription", "Meta Description Repair", "200", "500"],
      ["structureddata", "LocalBusiness or Service Schema", "300", "700"],
      ["imagealt", "Image Alt Attribute Repair", "150", "400"],
    ] as const;
    for (const [field, name, min, max] of starters) {
      expect(html).toContain(`name="${field}On"`);
      expect(html).toContain(`name="${field}Name"`);
      expect(html).toContain(`name="${field}Min"`);
      expect(html).toContain(`name="${field}Max"`);
      expect(html).toContain(`value="${name}"`);
      expect(html).toContain(`value="${min}"`);
      expect(html).toContain(`value="${max}"`);
    }
    expect(html.match(/type="checkbox"[^>]*checked=""/g)).toHaveLength(starters.length);
  });

  it("makes Home an attention-first view backed by portfolio data", () => {
    const html = render(
      createElement(Changes, {
        loaderData: {
          firstName: "Orbit",
          portfolio: { clients: 1, open: 1, priceMin: 900, priceMax: 1800 },
          actionCenter: {
            queue: [
              {
                id: "opportunities:c1:service-visibility",
                kind: "commercial",
                client: { id: "c1", name: "Cambridge Heating", domain: "example.com" },
                family: "service-visibility",
                stage: "new",
                title: "Service expansion opportunity",
                detail: "A new commercial opportunity is ready for review.",
                action: "Worth pursuing? Accept it, or dismiss",
                href: "/opportunities?client=c1",
                count: 1,
                priceMin: 900,
                priceMax: 1800,
                opportunityIds: ["o1"],
              },
            ],
            pipeline: {
              newCount: 1,
              acceptedCount: 0,
              pitchedCount: 0,
              soldCount: 0,
              lostCount: 0,
              closeRate: null,
              soldRevenue: 0,
              openCount: 1,
              openPriceMin: 900,
              openPriceMax: 1800,
            },
          },
          since: "2026-08-29T12:00:00.000Z",
          until: "2026-09-05T12:00:00.000Z",
          summary: { checks: 1, clientsChecked: 1, newFindings: 1, resolvedFindings: 0, inconclusive: 0 },
          runs: [
            {
              id: 1,
              clientId: "c1",
              clientName: "Cambridge Heating",
              finishedAt: "2026-09-05T12:00:00.000Z",
              outcome: "clean",
              summary: "No new opportunity findings.",
              trigger: "scheduled",
              newCount: 0,
              resolvedCount: 0,
              offeringDrift: ["Heat Pump Servicing"],
            },
          ],
          activity: [
            {
              id: "run:1",
              clientId: "c1",
              clientName: "Cambridge Heating",
              label: "Analysis completed",
              detail: "1 new opportunity surfaced. New on site: Heat Pump Servicing",
              at: "2026-09-05T12:00:00.000Z",
              href: "/clients/c1",
            },
          ],
          findings: [],
        },
      } as never),
      "/changes",
    );

    expect(html).toContain("Clients worth contacting");
    expect(html).toContain("Cambridge Heating");
    expect(html).toContain("$900 – $1,800");
    expect(html).toContain("Service expansion opportunity");
    expect(html).toContain("Pipeline");
    expect(html).toContain("Close rate");
    expect(html).toContain("New on site");
    expect(html).toContain("Heat Pump Servicing");
  });

  it("keeps an inconclusive client as a retry action rather than a fake opportunity", () => {
    const html = render(
      createElement(Changes, {
        loaderData: {
          firstName: "Orbit",
          portfolio: { clients: 1, open: 0, priceMin: 0, priceMax: 0 },
          actionCenter: {
            queue: [
              {
                id: "analysis:c1",
                kind: "analysis",
                analysisState: "inconclusive",
                client: { id: "c1", name: "Artfully You", domain: "artfullyyou.ca" },
                family: null,
                stage: null,
                title: "Analysis needs another look",
                detail: "The origin timed out before an HTTP response.",
                action: "Retry analysis",
                href: "/clients/c1",
                count: 0,
                priceMin: 0,
                priceMax: 0,
                opportunityIds: [],
              },
            ],
            pipeline: {
              newCount: 0,
              acceptedCount: 0,
              pitchedCount: 0,
              soldCount: 0,
              lostCount: 0,
              closeRate: null,
              soldRevenue: 0,
              openCount: 0,
              openPriceMin: 0,
              openPriceMax: 0,
            },
          },
          since: "2026-08-29T12:00:00.000Z",
          until: "2026-09-05T12:00:00.000Z",
          summary: { checks: 1, clientsChecked: 1, newFindings: 0, resolvedFindings: 0, inconclusive: 1 },
          runs: [],
          activity: [],
          findings: [],
        },
      } as never),
      "/changes",
    );

    expect(html).toContain("Retry analysis");
    expect(html).toContain("The origin timed out before an HTTP response.");
    expect(html).not.toContain("Service expansion opportunity");
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
    expect(html).toContain("Prepare client proposal");
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
