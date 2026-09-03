/**
 * Dev-only design harness. Server-renders the real product surfaces with
 * representative data into standalone HTML files, so the presentation layer can
 * be reviewed without a running Worker or a signed-in session.
 *
 *   pnpm tsx scripts/design-harness.tsx [outDir]
 *
 * Route components in this app take `loaderData` as a prop rather than reading
 * it from a hook, so they can be rendered directly with fixture data. Local
 * only; never imported by the Worker.
 */
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Client, Opportunity, Service } from "../src/core/schema";
import { OpportunitySignalRow, OpportunityInspector } from "../app/components/signal-desk";
import type { SignalDeskEntry } from "../app/components/signal-desk";
import { buildEvidenceCase } from "../app/lib/evidence";
import { clientState, totalsFor } from "../app/lib/portfolio";
import ClientsIndex from "../app/routes/clients._index";
import ServicesIndex from "../app/routes/services._index";
import OpportunityDetail from "../app/routes/opportunities.$id";
import { TOUR_STEPS } from "../app/components/tour";
import { Icon } from "../app/components/ui";

const outDir = process.argv[2] ?? ".design-harness";

// --- fixtures ---------------------------------------------------------------

const opp = (o: Partial<Opportunity> & { id: string; title: string }): Opportunity =>
  ({
    dedupeKey: o.id,
    clientId: "c1",
    ruleId: "missing-service-page",
    detected: "No page on the site covers this service.",
    evidenceRefs: ["https://northwindheating.co.uk/services"],
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

const clients: Client[] = [
  {
    id: "c1",
    name: "Northwind Heating",
    domain: "northwindheating.co.uk",
    offerings: ["Boiler installation", "Emergency repair", "Annual servicing"],
    notes: "",
  },
  {
    id: "c2",
    name: "Halton Plumbing",
    domain: "haltonplumbing.com",
    offerings: ["Bathroom fitting", "Leak detection"],
    notes: "",
  },
  {
    id: "c3",
    name: "Fenwick Electrical",
    domain: "fenwickelectrical.co.uk",
    offerings: ["Rewiring", "EV charger installation"],
    notes: "",
  },
  {
    id: "c4",
    name: "Ardley Roofing",
    domain: "ardleyroofing.co.uk",
    offerings: ["Flat roofing"],
    notes: "",
  },
];

const services: Service[] = [
  {
    id: "svc-landing",
    name: "Service Landing Page",
    description:
      "A dedicated, conversion-focused page for one service line: copy, on-page SEO, and a lead-capture call to action.",
    priceMin: 900,
    priceMax: 1800,
    tags: ["landing-page"],
    active: true,
  },
  {
    id: "svc-conversion",
    name: "Conversion Path Fix",
    description:
      "Diagnose and repair a broken conversion element so the client stops losing enquiries.",
    priceMin: 600,
    priceMax: 1100,
    tags: ["conversion"],
    active: true,
  },
  {
    id: "svc-local",
    name: "Local SEO Foundation",
    description:
      "Location pages, schema, and listings cleanup for a business that sells to a catchment area.",
    priceMin: 1400,
    priceMax: 2600,
    tags: ["seo"],
    active: false,
  },
];

const opportunities: Opportunity[] = [
  opp({
    id: "o1",
    title: "No page for emergency boiler repair",
    confidence: 0.88,
    priceMin: 1200,
    priceMax: 2400,
  }),
  opp({
    id: "o2",
    title: "Contact form fails silently on mobile",
    clientId: "c2",
    suggestedServiceId: "svc-conversion",
    confidence: 0.71,
    priceMin: 600,
    priceMax: 1100,
    status: "proposal_prepared",
  }),
  opp({
    id: "o3",
    title: "EV charger installation is unlisted",
    clientId: "c3",
    confidence: 0.55,
    priceMin: 900,
    priceMax: 1800,
  }),
];

const entries: SignalDeskEntry[] = opportunities.map((opportunity) => ({
  client: clients.find((c) => c.id === opportunity.clientId)!,
  opportunity,
  serviceName: services.find((s) => s.id === opportunity.suggestedServiceId)!.name,
}));

const runByClient: Record<
  string,
  { finishedAt: string | null; summary: string | null; outcome: string | null }
> = {
  c1: { finishedAt: "2026-09-01T09:00:00.000Z", summary: "Read 24 pages.", outcome: "ok" },
  c2: { finishedAt: "2026-08-29T09:00:00.000Z", summary: "Read 11 pages.", outcome: "ok" },
  c3: { finishedAt: "2026-08-30T09:00:00.000Z", summary: "Read 8 pages.", outcome: "ok" },
  c4: { finishedAt: "2026-08-28T09:00:00.000Z", summary: null, outcome: "inconclusive" },
};

const enrichedClients = clients.map((client) => {
  const totals = totalsFor(opportunities.filter((o) => o.clientId === client.id));
  const run = runByClient[client.id]!;
  return {
    ...client,
    totals,
    lastRunAt: run.finishedAt,
    runSummary: run.summary,
    state: clientState({ outcome: run.outcome as never, openCount: totals.open }),
  };
});

// --- page shell -------------------------------------------------------------

function Shell({ active, children }: { active: string; children: ReactNode }) {
  return h(
    "div",
    { className: "app-frame" },
    h(
      "aside",
      { className: "app-sidebar" },
      h(
        "a",
        { className: "brand app-brand", href: "#" },
        h("span", { className: "brand-word" }, "Axiom Orbit"),
      ),
      h("div", { className: "app-sidebar-label" }, "Revenue workspace"),
      h(
        "nav",
        { className: "app-nav" },
        ["Opportunities", "Clients", "Services"].map((label) =>
          h(
            "a",
            {
              key: label,
              className: "app-nav-item" + (label === active ? " active" : ""),
              href: "#",
            },
            label,
          ),
        ),
      ),
      h("div", { className: "app-sidebar-spacer" }),
      h(
        "div",
        { className: "menu" },
        h(
          "button",
          { type: "button", className: "ws-trigger" },
          h("span", { className: "avatar" }, "AW"),
          h("span", { className: "ws-name" }, "Axiom Web"),
        ),
        h(
          "div",
          { className: "menu-pop align-end", role: "menu" },
          h(
            "div",
            { className: "menu-head" },
            h("strong", null, "Axiom Web"),
            h("span", null, "aidan.magee2@icloud.com"),
          ),
          h("a", { className: "menu-item", href: "#", role: "menuitem" }, "Settings"),
          h("div", { className: "menu-sep" }),
          h("button", { className: "menu-item", type: "button", role: "menuitem" }, "Log out"),
        ),
      ),
    ),
    h("main", { className: "content work-surface" }, h("div", { className: "page-enter" }, children)),
  );
}

const opportunitiesScreen = h(
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
            h("span", null, "3 of 4 analyzed · 1 could not be read · ranked by potential value"),
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
            selected: entry.opportunity.id === entries[0]!.opportunity.id,
            selectHref: "#",
          }),
        ),
      ),
    ),
    h(OpportunityInspector, { entry: entries[0]!, closeHref: "#" }),
  ),
);

// The tour is a <dialog>, which only paints once script calls showModal(). The
// harness renders it with the open attribute so its styling can be reviewed.
const tourStep = TOUR_STEPS[1]!;
const tourScreen = h(
  "div",
  null,
  opportunitiesScreen,
  h(
    "dialog",
    { className: "tour", open: true },
    h(
      "div",
      { className: "tour-body" },
      h("p", { className: "eyebrow" }, `Guided tour · 2 of ${TOUR_STEPS.length}`),
      h(
        "h2",
        { className: "tour-title" },
        h(Icon, { name: tourStep.icon, size: 18 }),
        tourStep.title,
      ),
      tourStep.body.map((paragraph) =>
        h("p", { className: "tour-para", key: paragraph.slice(0, 32) }, paragraph),
      ),
    ),
    h(
      "ol",
      { className: "tour-dots" },
      TOUR_STEPS.map((step, i) => h("li", { key: step.title, className: i === 1 ? "on" : undefined })),
    ),
    h(
      "div",
      { className: "tour-actions" },
      h("button", { className: "btn btn-quiet", type: "button" }, "Skip tour"),
      h(
        "div",
        { className: "tour-actions-end" },
        h("button", { className: "btn", type: "button" }, "Back"),
        h(
          "button",
          { className: "btn btn-primary", type: "button" },
          "Next",
          h(Icon, { name: "arrow-right", size: 15 }),
        ),
      ),
    ),
  ),
);

/**
 * The analyzability corpus rendered through the real screens.
 *
 * Everything here came out of scripts/analyzability/ui-fixture.ts: real crawls
 * of 24 real websites, the product's own coverage assessment, and candidates
 * from the actual rule modules. The AI evaluator does not run, so confidence is
 * each candidate's raw score and nothing has been filtered by judgment.
 */
interface CorpusFixture {
  clients: Array<{
    client: Client;
    outcome: string;
    summary: string;
    limitation: string | null;
    open: number;
    pagesRead?: number;
  }>;
  candidates: Array<{
    clientId: string;
    clientName: string;
    clientDomain: string;
    serviceName: string;
    opportunity: Opportunity;
  }>;
}

function corpusScreens(): Record<string, { nav: string; node: ReactNode }> {
  const path = ".analyzability-ui.json";
  if (!existsSync(path)) return {};
  const fixture = JSON.parse(readFileSync(path, "utf8")) as CorpusFixture;

  const byClient = new Map<string, typeof fixture.candidates>();
  for (const row of fixture.candidates) {
    byClient.set(row.clientId, [...(byClient.get(row.clientId) ?? []), row]);
  }

  const corpusClients = fixture.clients.map((row) => {
    const found = byClient.get(row.client.id) ?? [];
    return {
      ...row.client,
      totals: {
        open: found.length,
        closed: 0,
        priceMin: found.reduce((n, r) => n + r.opportunity.priceMin, 0),
        priceMax: found.reduce((n, r) => n + r.opportunity.priceMax, 0),
      },
      lastRunAt: "2026-09-03T16:00:00.000Z",
      runSummary: row.summary,
      state: clientState({
        outcome: (row.outcome === "inconclusive" ? "inconclusive" : "ok") as never,
        openCount: found.length,
      }),
    };
  });

  const corpusEntries: SignalDeskEntry[] = fixture.candidates.map((row) => ({
    client: { id: row.clientId, name: row.clientName, domain: row.clientDomain },
    opportunity: row.opportunity,
    serviceName: row.serviceName,
  }));

  const readable = fixture.clients.filter((c) => c.outcome !== "inconclusive").length;

  const feed = h(
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
              h(
                "span",
                null,
                `${readable} of ${fixture.clients.length} real sites analyzed · ranked by potential value`,
              ),
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
          corpusEntries.map((entry) =>
            h(OpportunitySignalRow, {
              key: entry.opportunity.id,
              entry,
              selected: entry.opportunity.id === corpusEntries[0]?.opportunity.id,
              selectHref: "#",
            }),
          ),
        ),
      ),
      corpusEntries[0]
        ? h(OpportunityInspector, { entry: corpusEntries[0], closeHref: "#" })
        : null,
    ),
  );

  return {
    "corpus-opportunities": { nav: "Opportunities", node: feed },
    "corpus-clients": {
      nav: "Clients",
      node: h(ClientsIndex, { loaderData: { clients: corpusClients } } as never),
    },
  };
}

const screens: Record<string, { nav: string; node: ReactNode }> = {
  ...corpusScreens(),
  tour: { nav: "Opportunities", node: tourScreen },
  opportunities: { nav: "Opportunities", node: opportunitiesScreen },
  clients: {
    nav: "Clients",
    node: h(ClientsIndex, { loaderData: { clients: enrichedClients } } as never),
  },
  services: {
    nav: "Services",
    node: h(ServicesIndex, { loaderData: { services } } as never),
  },
  "opportunity-detail": {
    nav: "Opportunities",
    node: h(OpportunityDetail, {
      loaderData: {
        opportunity: opportunities[0]!,
        client: clients[0]!,
        service: services[0]!,
        lastRunAt: "2026-09-01T09:00:00.000Z",
        evidence: buildEvidenceCase(opportunities[0]!),
      },
    } as never),
  },
};

// --- emit -------------------------------------------------------------------

const css = [
  readFileSync("app/styles/app.css", "utf8"),
  readFileSync("app/styles/signal-desk.css", "utf8"),
].join("\n");

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600" +
  "&family=JetBrains+Mono:wght@400;500" +
  "&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap";

mkdirSync(outDir, { recursive: true });

for (const [name, screen] of Object.entries(screens)) {
  const router = createMemoryRouter(
    [{ path: "/", element: h(Shell, { active: screen.nav, children: screen.node }) }],
    { initialEntries: ["/"] },
  );
  const body = renderToStaticMarkup(h(RouterProvider, { router }));
  writeFileSync(
    join(outDir, name + ".html"),
    [
      "<!doctype html>",
      '<html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      '<link rel="stylesheet" href="' + FONT_HREF + '">',
      "<title>" + name + " · design harness</title>",
      "<style>" + css + "</style></head>",
      "<body>" + body,
      // A dialog only paints in the top layer once showModal() is called, so the
      // harness opens it the way the app does rather than reviewing the
      // in-flow fallback.
      "<script>document.querySelectorAll('dialog[open]').forEach(function(d){d.close();d.showModal();});</script>",
      "</body></html>",
    ].join("\n"),
  );
  console.log("wrote " + join(outDir, name + ".html"));
}
