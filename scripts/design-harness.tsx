/**
 * Dev-only design harness. Server-renders the real Signal Desk surfaces with
 * representative data into a standalone HTML file so the presentation layer can
 * be reviewed without a running Worker or a signed-in session.
 *
 *   npx tsx scripts/design-harness.tsx > .design-harness.html
 *
 * Local only. Never imported by the Worker.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { readFileSync } from "node:fs";

import type { Opportunity } from "../src/core/schema";
import { OpportunitySignalRow, OpportunityInspector } from "../app/components/signal-desk";
import type { SignalDeskEntry } from "../app/components/signal-desk";

const opp = (o: Partial<Opportunity> & { id: string; title: string }): Opportunity => ({
  dedupeKey: o.id,
  clientId: "c1",
  ruleId: "missing-service-page" as Opportunity["ruleId"],
  detected: "No page on the site covers this service.",
  evidenceRefs: ["https://example.com/services"],
  rationale:
    "The business sells this service but nothing on the site describes it, so search traffic and enquiries for it land nowhere.",
  suggestedServiceId: "svc-landing",
  suggestedScope: ["Write the page", "On-page SEO", "Lead capture CTA"],
  priceMin: 900,
  priceMax: 1800,
  confidence: 0.82,
  billableStatus: "billable",
  status: "new",
  updatedAt: new Date().toISOString(),
  ...o,
}) as Opportunity;

const entries: SignalDeskEntry[] = [
  {
    client: { id: "c1", name: "Northwind Heating", domain: "northwindheating.co.uk" },
    serviceName: "Service Landing Page",
    opportunity: opp({
      id: "o1",
      title: "No page for emergency boiler repair",
      confidence: 0.88,
      priceMin: 1200,
      priceMax: 2400,
    }),
  },
  {
    client: { id: "c2", name: "Halton Plumbing", domain: "haltonplumbing.com" },
    serviceName: "Conversion Path Fix",
    opportunity: opp({
      id: "o2",
      title: "Contact form fails silently on mobile",
      confidence: 0.71,
      priceMin: 600,
      priceMax: 1100,
      status: "proposal_prepared",
    }),
  },
  {
    client: { id: "c3", name: "Fenwick Electrical", domain: "fenwickelectrical.co.uk" },
    serviceName: "Service Landing Page",
    opportunity: opp({
      id: "o3",
      title: "EV charger installation is unlisted",
      confidence: 0.55,
      priceMin: 900,
      priceMax: 1800,
    }),
  },
];

const active = entries[0]!;

const page = h(
  MemoryRouter,
  { initialEntries: ["/opportunities"] },
  h(
    "div",
    { className: "app-frame" },
    h(
      "aside",
      { className: "app-sidebar" },
      h("a", { className: "brand app-brand", href: "#" }, h("span", { className: "brand-word" }, "Client Growth")),
      h("div", { className: "app-sidebar-label" }, "Revenue workspace"),
      h(
        "nav",
        { className: "app-nav" },
        ["Opportunities", "Clients", "Services"].map((label, i) =>
          h("a", { key: label, className: "app-nav-item" + (i === 0 ? " active" : ""), href: "#" }, label),
        ),
      ),
    ),
    h(
      "main",
      { className: "content work-surface" },
      h(
        "div",
        { className: "page-enter" },
        h(
          "div",
          { className: "page" },
          h(
            "div",
            { className: "pagehead" },
            h(
              "div",
              { className: "pagehead-copy" },
              h("span", { className: "eyebrow" }, "Portfolio"),
              h("h1", { className: "title-page" }, "Opportunities"),
            ),
          ),
          h(
            "div",
            { className: "signal-desk" },
            h(
              "section",
              { className: "signal-main" },
              h(
                "div",
                { className: "signal-toolbar" },
                h(
                  "div",
                  { className: "feed-head-copy" },
                  h("h2", null, "Everything worth a conversation"),
                  h(
                    "div",
                    { className: "feed-head-meta" },
                    h("span", null, "3 of 4 analyzed · ranked by potential value"),
                  ),
                ),
              ),
              h(
                "div",
                { className: "signal-list-head", "aria-hidden": "true" },
                h("span", null, "Opportunity"),
                h("span", null, "Value"),
                h("span", null, "Evidence"),
                h("span", null, "Status"),
              ),
              h(
                "ul",
                { className: "signal-list" },
                entries.map((entry) =>
                  h(OpportunitySignalRow, {
                    key: entry.opportunity.id,
                    entry,
                    selected: entry.opportunity.id === active.opportunity.id,
                    selectHref: "#",
                  }),
                ),
              ),
            ),
            h(OpportunityInspector, { entry: active, closeHref: "#" }),
          ),
        ),
      ),
    ),
  ),
);

const css = [
  readFileSync("app/styles/app.css", "utf8"),
  readFileSync("app/styles/signal-desk.css", "utf8"),
].join("\n");

process.stdout.write(`<!doctype html>
<html lang="en" data-theme="light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<title>Design harness</title><style>${css}</style></head>
<body>${renderToStaticMarkup(page)}</body></html>`);
