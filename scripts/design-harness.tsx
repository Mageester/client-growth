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
import ClientsImport from "../app/routes/clients.import";
import ServicesIndex from "../app/routes/services._index";
import OpportunityDetail from "../app/routes/opportunities.$id";
import ClientDetail from "../app/routes/clients.$id";
import Onboarding from "../app/routes/onboarding";
import Changes from "../app/routes/changes";
import OpportunitiesIndex from "../app/routes/opportunities._index";
import Login from "../app/routes/login";
import Operations from "../app/routes/operations";
import { tierForRule } from "../src/core/rules/registry";
import { jobsToPayback, paybackSentence } from "../src/core/clientValue";
import ProposalShare from "../app/routes/proposal.share";
import { assessAnalysisReadiness } from "@/core/analysisReadiness";
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
    evidenceRefs: [],
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
    name: "Cambridge Heating",
    domain: "cambridgeheating.ca",
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
    tags: ["conversion-fix"],
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
    title: "Water Heater Replacement",
    evidenceRefs: ["https://cambridgeheating.ca/services"],
    confidence: 0.75,
    priceMin: 900,
    priceMax: 1800,
  }),
  opp({
    id: "o2",
    title: "Contact form fails silently on mobile",
    evidenceRefs: ["https://haltonplumbing.com/contact"],
    clientId: "c2",
    suggestedServiceId: "svc-conversion",
    confidence: 0.71,
    priceMin: 600,
    priceMax: 1100,
    status: "proposal_prepared",
    proposalMd: "# Repair the mobile contact journey\n\nFix and validate the contact form so mobile visitors can complete an enquiry.",
  }),
  opp({
    id: "o3",
    title: "EV charger installation is unlisted",
    evidenceRefs: ["https://fenwickelectrical.co.uk/services/ev-chargers"],
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
        h(
          "span",
          { className: "brand-mark", "aria-hidden": "true" },
          h("img", {
            className: "brand-art",
            src: "/brand/axiom-orbit-icon-chrome-transparent.png",
            alt: "",
          }),
        ),
        h(
          "span",
          { className: "brand-copy" },
          h("span", { className: "brand-word" }, "Axiom Orbit"),
          h("small", null, "Client Growth"),
        ),
      ),
      h(
        "nav",
        { className: "app-nav" },
        [
          ["Home", "home"],
          ["Clients", "users"],
          ["Opportunities", "target"],
          ["Settings", "settings"],
        ].map(([label, icon]) =>
          h(
            "a",
            {
              key: label,
              className: "app-nav-item" + (label === active ? " active" : ""),
              href: "#",
            },
            h(Icon, { name: icon as never, size: 20 }),
            h("span", null, label),
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
          h("span", { className: "avatar" }, "AM"),
          h(
            "span",
            { className: "ws-copy" },
            h("span", { className: "ws-name" }, "Aidan Magee"),
            h("small", null, "Agency Workspace"),
          ),
          h(Icon, { name: "chevron-down", size: 14 }),
        ),
      ),
    ),
    h("main", { className: "content work-surface" }, h("div", { className: "page-enter" }, children)),
  );
}

const opportunitiesScreen = h(OpportunitiesIndex, {
  loaderData: {
    groups: clients.map((client) => ({
      client,
      opportunities: opportunities.filter((opportunity) => opportunity.clientId === client.id),
      totals: totalsFor(opportunities.filter((opportunity) => opportunity.clientId === client.id)),
      run: runByClient[client.id]
        ? {
            ...runByClient[client.id],
            newCount: 0,
            resolvedCount: 0,
            trigger: "manual",
          }
        : null,
      monitoring: { cadence: "off", nextDueAt: null },
      state: enrichedClients.find((entry) => entry.id === client.id)!.state,
    })),
    serviceName: Object.fromEntries(services.map((service) => [service.id, service.name])),
    // A workspace with a short sales history: enough for the queue to be
    // ordered by evidence rather than by price alone.
    winRates: [
      {
        ruleId: "missing-service-page",
        tier: "commercial",
        decided: 8,
        sold: 6,
        soldValue: 8700,
        valuedSales: 6,
        rate: 0.75,
        averageSale: 1450,
      },
      {
        ruleId: "missing-image-alt",
        tier: "health",
        decided: 5,
        sold: 0,
        soldValue: 0,
        valuedSales: 0,
        rate: 0,
        averageSale: null,
      },
    ],
    monitoring: {
      monitored: 0,
      due: 0,
      unhealthy: 0,
      newFindings: 0,
      resolvedFindings: 0,
      checks: 0,
    },
  },
} as never);

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

  const allCorpusEntries: SignalDeskEntry[] = fixture.candidates.map((row) => ({
    client: { id: row.clientId, name: row.clientName, domain: row.clientDomain },
    opportunity: row.opportunity,
    serviceName: row.serviceName,
  }));
  // Split exactly as the real route does. Before this, the harness showed one
  // mixed list in which a broken internal link led and the two "no page for
  // water heater replacement" findings sat six rows down behind duplicate
  // titles and missing meta descriptions — a faithful picture of the bug, and
  // a misleading picture of the product now that the route no longer does it.
  const corpusEntries = allCorpusEntries.filter(
    (entry) => tierForRule(entry.opportunity.ruleId) === "commercial",
  );
  const corpusHealthEntries = allCorpusEntries.filter(
    (entry) => tierForRule(entry.opportunity.ruleId) === "health",
  );

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
                `${readable} of ${fixture.clients.length} real sites analyzed · ${corpusEntries.length} worth selling, ${corpusHealthEntries.length} site-health checks`,
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
        corpusHealthEntries.length > 0
          ? h(
              "section",
              { className: "signal-section-break" },
              h(
                "div",
                { className: "feed-head-copy" },
                h("h2", null, "Site health"),
                h(
                  "div",
                  { className: "feed-head-meta" },
                  h(
                    "span",
                    null,
                    `${corpusHealthEntries.length} checks worth fixing — titles, headings, descriptions and links. Supporting work rather than the reason to call.`,
                  ),
                ),
              ),
              h(
                "ul",
                { className: "signal-list" },
                corpusHealthEntries.map((entry) =>
                  h(OpportunitySignalRow, {
                    key: entry.opportunity.id,
                    entry,
                    selected: false,
                    selectHref: "#",
                  }),
                ),
              ),
            )
          : null,
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

/** A client whose profile is too thin to analyze — the state being designed for. */
const thinClient: Client = {
  id: "c9",
  name: "Ardley Roofing",
  domain: "ardleyroofing.co.uk",
  offerings: [],
  notes: "",
};

const clientDetailScreen = h(ClientDetail, {
  loaderData: {
    client: thinClient,
    services,
    coveredIds: [],
    opportunities: [],
    totals: { open: 0, closed: 0, priceMin: 0, priceMax: 0 },
    runs: [],
    monitoring: { cadence: "off", nextDueAt: null, lastAttemptAt: null, lastSuccessAt: null, lastOutcome: null },
    firstRunFailed: false,
    readiness: assessAnalysisReadiness({ catalog: services, offerings: 0 }),
    suggestions: [],
    // A client with two competitors named: the state where the Compare control
    // is live and the comparison would actually be allowed to draw a conclusion.
    competitors: [
      { id: "cmp_1", clientId: thinClient.id, name: "Northwind Roofing", domain: "northwindroofing.co.uk", createdAt: "2026-09-01T00:00:00.000Z" },
      { id: "cmp_2", clientId: thinClient.id, name: "Cotswold Roofline", domain: "cotswoldroofline.co.uk", createdAt: "2026-09-01T00:00:00.000Z" },
    ],
    maxCompetitors: 3,
    hasEvidence: false,
    state: "never",
  },
} as never);

/**
 * Onboarding, both stages.
 *
 * Rendered without the app shell, because root.tsx hides the nav on this route:
 * someone finishing setup has nowhere else to go yet. The confirm stage is the
 * screen worth looking at — it is where the crawl's suggestions become the
 * client's offering list, and where the first analysis stops being guaranteed
 * to come back inconclusive.
 */
const onboardingSuggestions = [
  {
    label: "Heat Pump Installation",
    confidence: "high" as const,
    evidence: [
      { kind: "service-section-page" as const, detail: "Has its own page under /services" },
      { kind: "navigation-link" as const, detail: "Linked from the main navigation" },
    ],
  },
  {
    label: "Boiler Repair",
    confidence: "high" as const,
    evidence: [
      { kind: "service-section-page" as const, detail: "Has its own page under /services" },
    ],
  },
  {
    label: "Underfloor Heating",
    confidence: "high" as const,
    evidence: [{ kind: "navigation-link" as const, detail: "Linked from the main navigation" }],
  },
  {
    label: "Power Flushing",
    confidence: "medium" as const,
    evidence: [{ kind: "homepage-card" as const, detail: "Named in a card on the homepage" }],
  },
  {
    label: "Landlord Gas Safety Checks",
    confidence: "medium" as const,
    evidence: [{ kind: "sitemap-url" as const, detail: "Listed in the site's own sitemap" }],
  },
];

const onboardingClient = {
  id: "client-northwind",
  name: "Northwind Heating",
  domain: "northwindheating.co.uk",
  offerings: [],
};

const screens: Record<string, { nav: string; node: ReactNode; bare?: boolean; standalone?: boolean }> = {
  ...corpusScreens(),
  "clients-import": {nav:"Clients",node:h(ClientsImport,{loaderData:{existingCount:4},actionData:{
    stage:"preview",ok:true,raw:"Northwind Heating,northwind.example,heat pump installation;duct cleaning",issues:[],
    rows:[{line:1,name:"Northwind Heating",domain:"northwind.example",offerings:["heat pump installation","duct cleaning"]}],
  }} as never)},
  "branded-proposal": {nav:"",standalone:true,node:h(ProposalShare,{loaderData:{
    shareId:"fixture",createdAt:"2026-09-04T10:00:00.000Z",expiresAt:"2026-10-04T10:00:00.000Z",
    snapshot:{agencyName:"Northstar Digital",logo:null,preparedBy:"Alex at Northstar Digital",clientName:"Northwind Heating",clientDomain:"northwindheating.co.uk",
      proposalMd:"# A clearer path to boiler installation enquiries\n\nWe recommend a **dedicated boiler installation page** covering the process, available options, and how to request a quote.\n\n- Write clear service copy\n- Add an enquiry action",
      opportunity:{...opportunities[0],title:"Boiler installation needs a dedicated page",priceMin:900,priceMax:1800,suggestedScope:["Write the boiler installation page","Add internal links and a clear enquiry action"],serviceName:"Service landing page"}},
  }} as never)},
  "email-verification": {
    nav: "", bare: true,
    node: h(Login, {loaderData:{resetSuccess:false,verificationSent:true,verificationSuccess:false},
      actionData:{verificationRequired:true,email:"owner@example.test",error:"Verify your email before logging in."}} as never),
  },
  "check-health": {
    nav: "Settings",
    node: h(Operations, {loaderData:{since:"2026-08-28",until:"2026-09-04",
      current:{checks:10,clean:1,findings:3,inconclusive:6,evaluatorErrors:2,evaluatorCalls:14},previous:{checks:10,clean:4,findings:5,inconclusive:1,evaluatorErrors:0,evaluatorCalls:12},
      rate:0.6,previousRate:0.1,alert:"Axiom Orbit could not fully assess 6 of 10 checks this week. Review client setup and recent check results before relying on this portfolio.",
      incompleteStarts:1,failedStarts:1,recentErrors:[{id:1,clientName:"Halton Plumbing",finishedAt:"2026-09-04T10:00:00.000Z",outcome:"inconclusive",summary:"This site could not be read well enough to assess.",evaluatorErrors:0}],
      email:{deliverable:true,detail:"Verification and password-reset email is configured."},
      sales:{totalSold:7,totalSoldValue:9400,rows:[
        {ruleId:"missing-service-page",label:"A missing service page",tier:"commercial",decided:8,sold:6,averageSale:1450},
        {ruleId:"broken-conversion-path",label:"A broken conversion path",tier:"commercial",decided:2,sold:1,averageSale:700},
        {ruleId:"missing-image-alt",label:"Add missing image alt attributes",tier:"health",decided:5,sold:0,averageSale:null},
      ]},
    }} as never),
  },
  home: {
    nav: "Home",
    node: h(Changes, { loaderData: {
      since:"2026-08-29T12:00:00.000Z", until:"2026-09-05T12:00:00.000Z",
      firstName:"Aidan",
      attention:entries.map((entry) => ({
        client:entry.client,
        opportunity:entry.opportunity,
        serviceName:entry.serviceName,
      })),
      portfolio:{clients:clients.length,open:3,closed:0,priceMin:2700,priceMax:5300},
      summary:{checks:3,clientsChecked:2,newFindings:2,resolvedFindings:1,inconclusive:1},
      runs:[
        {id:3,clientId:"c2",clientName:"Halton Plumbing",finishedAt:"2026-09-04T10:00:00.000Z",outcome:"inconclusive",summary:"This site could not be read well enough to assess.",trigger:"scheduled",newCount:0,resolvedCount:0},
        {id:2,clientId:"c1",clientName:"Northwind Heating",finishedAt:"2026-09-03T10:00:00.000Z",outcome:"findings",summary:"2 evidence-backed opportunities found.",trigger:"scheduled",newCount:2,resolvedCount:1,offeringDrift:["Heat Pump Servicing"]},
      ],
      findings:[{id:"o1",clientId:"c1",clientName:"Northwind Heating",title:"Broken appointment link",status:"resolved"}],
    }} as never),
  },
  "onboarding-setup": {
    nav: "Opportunities",
    bare: true,
    node: h(Onboarding, {
      loaderData: {
        stage: "setup",
        hasWorkspace: false,
        client: null,
        readFailed: false,
        crawl: null,
        suggestions: [],
      },
    } as never),
  },
  "onboarding-confirm": {
    nav: "Opportunities",
    bare: true,
    node: h(Onboarding, {
      loaderData: {
        stage: "confirm",
        hasWorkspace: true,
        client: onboardingClient,
        readFailed: false,
        crawl: { readablePages: 9, fetchedPages: 10 },
        suggestions: onboardingSuggestions,
      },
    } as never),
  },
  // The honest failure. A site that could not be reached must not be described
  // as one that was read and found empty.
  "onboarding-unreadable": {
    nav: "Opportunities",
    bare: true,
    node: h(Onboarding, {
      loaderData: {
        stage: "confirm",
        hasWorkspace: true,
        client: onboardingClient,
        readFailed: true,
        crawl: { readablePages: 0, fetchedPages: 0 },
        suggestions: [],
      },
    } as never),
  },
  "client-thin": { nav: "Clients", node: clientDetailScreen },
  tour: { nav: "Opportunities", node: tourScreen },
  opportunities: { nav: "Opportunities", node: opportunitiesScreen },
  clients: {
    nav: "Clients",
    node: h(ClientsIndex, { loaderData: { clients: enrichedClients } } as never),
  },
  services: {
    nav: "Settings",
    node: h(ServicesIndex, { loaderData: { services } } as never),
  },
  "opportunity-detail": {
    nav: "Opportunities",
    node: h(OpportunityDetail, {
      loaderData: {
        opportunity: opportunities[0]!,
        client: { ...clients[0]!, averageJobValue: 4000 },
        service: services[0]!,
        lastRunAt: "2026-09-01T09:00:00.000Z",
        evidence: buildEvidenceCase(opportunities[0]!),
        // Present only because this fixture's client has a recorded job value.
        payback: paybackSentence(
          jobsToPayback({
            priceMin: opportunities[0]!.priceMin,
            priceMax: opportunities[0]!.priceMax,
            averageJobValue: 4000,
          }),
        ),
      },
    } as never),
  },
};

// --- emit -------------------------------------------------------------------

const css = [
  readFileSync("app/styles/app.css", "utf8"),
  readFileSync("app/styles/signal-desk.css", "utf8"),
  readFileSync("app/styles/orbit-approved.css", "utf8"),
].join("\n");

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600" +
  "&family=JetBrains+Mono:wght@400;500" +
  "&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap";

mkdirSync(outDir, { recursive: true });

for (const [name, screen] of Object.entries(screens)) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        // root.tsx drops the app nav on /onboarding, so the bare screens are
        // wrapped the way it wraps them: the public topbar and content column.
        element: screen.standalone ? screen.node : screen.bare
          ? h(
              "div",
              null,
              h(
                "header",
                { className: "topbar public-topbar" },
                h(
                  "div",
                  { className: "topbar-inner" },
                  h(
                    "a",
                    { className: "brand", href: "#" },
                    h("span", { className: "brand-word" }, "Axiom Orbit"),
                  ),
                ),
              ),
              h("main", { className: "content public-content" }, screen.node),
            )
          : h(Shell, { active: screen.nav, children: screen.node }),
      },
    ],
    { initialEntries: ["/"] },
  );
  const body = renderToStaticMarkup(h(RouterProvider, { router }));
  writeFileSync(
    join(outDir, name + ".html"),
    [
      "<!doctype html>",
      '<html lang="en" data-theme="dark"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      '<link rel="stylesheet" href="' + FONT_HREF + '">',
      "<title>" + name + " · design harness</title>",
      "<style>" + css +
        ".design-harness-viewport{width:1586px;height:992px;overflow:hidden}.design-harness-viewport>.app-frame{width:1586px;height:992px;min-height:992px}.design-harness-viewport .work-surface{min-height:992px}" +
        "@media (max-width:1585px){.design-harness-viewport,.design-harness-viewport>.app-frame{width:auto;height:auto;min-height:0;overflow:visible}.design-harness-viewport .work-surface{min-height:0}}" +
        "</style></head>",
      '<body><div class="design-harness-viewport">' + body + "</div>",
      // A dialog only paints in the top layer once showModal() is called, so the
      // harness opens it the way the app does rather than reviewing the
      // in-flow fallback.
      "<script>document.querySelectorAll('dialog[open]').forEach(function(d){d.close();d.showModal();});</script>",
      "</body></html>",
    ].join("\n"),
  );
  console.log("wrote " + join(outDir, name + ".html"));
}
