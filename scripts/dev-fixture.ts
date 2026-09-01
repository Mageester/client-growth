/**
 * Dev tool. Prints SQL that fills ONE existing local workspace with a portfolio
 * covering every client state, so the UI can be exercised without waiting on
 * real crawls.
 *
 *   pnpm dev:fixture <workspace-id> | wrangler d1 execute client-growth-dev --local
 *
 * Local only. It writes into a workspace you already own, never creates users or
 * sessions, and is never referenced by the Worker.
 */
import { createHash } from "node:crypto";

const workspaceId = process.argv[2];
if (!workspaceId) {
  console.error("usage: tsx scripts/dev-fixture.ts <workspace-id>");
  process.exit(1);
}

const now = new Date();
const iso = (offsetMinutes: number) =>
  new Date(now.getTime() - offsetMinutes * 60_000).toISOString();
const q = (value: string) => `'${value.replace(/'/g, "''")}'`;
const key = (clientId: string, ruleId: string, subject: string) =>
  createHash("sha256").update(`${clientId}|${ruleId}|${subject}`).digest("hex").slice(0, 32);

const services = [
  {
    id: "dev-svc-landing",
    name: "Service Landing Page",
    description:
      "A dedicated, conversion-focused page for one service line: copy, on-page SEO, and a lead-capture call to action.",
    min: 900,
    max: 1800,
    tags: ["landing-page"],
  },
  {
    id: "dev-svc-conversion",
    name: "Conversion Path Fix",
    description:
      "Diagnose and repair a broken conversion element so the client stops losing enquiries.",
    min: 300,
    max: 900,
    tags: ["conversion-fix"],
  },
  {
    id: "dev-svc-retainer",
    name: "Monthly Care Plan",
    description: "Ongoing hosting, updates and small content changes.",
    min: 250,
    max: 700,
    tags: [],
  },
];

const clients = [
  {
    id: "dev-client-harbourside",
    name: "Harbourside Dental",
    domain: "harboursidedental.example",
    offerings: [
      "dental implants",
      "invisalign clear aligners",
      "teeth whitening",
      "emergency dentistry",
    ],
    notes: "Two locations. The owner wants more implant enquiries this year.",
    run: {
      outcome: "findings",
      summary: "2 evidence-backed opportunities found.",
      limitation: null as string | null,
      pagesRead: 9,
      pagesFetched: 10,
      minutesAgo: 42,
    },
  },
  {
    id: "dev-client-northfield",
    name: "Northfield Roofing",
    domain: "northfieldroofing.example",
    offerings: ["roof replacement", "gutter installation", "storm damage repair"],
    notes: "",
    run: {
      outcome: "clean",
      summary: "Read 8 pages and found no unmet billable work.",
      limitation: null,
      pagesRead: 8,
      pagesFetched: 8,
      minutesAgo: 60 * 26,
    },
  },
  {
    id: "dev-client-verdant",
    name: "Verdant Landscape Architecture & Garden Maintenance Collective",
    domain: "verdant-landscape-architecture-and-garden-maintenance.example",
    offerings: ["garden design", "hardscaping", "irrigation systems"],
    notes: "Long name and long domain — kept here on purpose as a layout test.",
    run: {
      outcome: "inconclusive",
      summary: "The site could not be reached safely, so nothing was assessed.",
      limitation:
        "Requests to this domain were refused by the network policy — the address did not resolve to a public host, used an unsupported scheme, or redirected somewhere unsafe.",
      pagesRead: 0,
      pagesFetched: 0,
      minutesAgo: 60 * 5,
    },
  },
  {
    id: "dev-client-lumen",
    name: "Lumen Physiotherapy",
    domain: "lumenphysio.example",
    offerings: ["sports injury rehabilitation", "dry needling"],
    notes: "",
    run: null,
  },
];

const opportunities = [
  {
    clientId: "dev-client-harbourside",
    ruleId: "missing-service-page",
    subject: "dental implants",
    title: "No page for dental implants",
    detected:
      "Harbourside Dental sells dental implants, but no page on harboursidedental.example covers them. The site navigation, every crawled page, and the sitemap were checked.",
    rationale:
      "Implants are this practice's highest-value treatment and the one prospective patients research most before booking. With no page to land on, that search demand reaches a competitor instead — and there is nothing to point paid or referral traffic at.",
    scope: [
      "Write and build a dedicated dental implants page covering process, recovery and pricing bands.",
      "Add the page to the primary navigation and the treatments index.",
      "Set page title, meta description and internal links from the two highest-traffic pages.",
    ],
    refs: [
      "https://harboursidedental.example/treatments",
      "https://harboursidedental.example/services/cosmetic-dentistry",
      "https://harboursidedental.example/about",
      "nav:Treatments",
      "nav:About",
    ],
    serviceId: "dev-svc-landing",
    min: 900,
    max: 1800,
    confidence: 0.88,
    status: "new",
    verification: {
      conclusion: "absent",
      inspectedUrls: [
        "https://harboursidedental.example/treatments",
        "https://harboursidedental.example/services/cosmetic-dentistry",
      ],
      closeMatches: [
        {
          where: "heading",
          value: "Cosmetic dentistry",
          url: "https://harboursidedental.example/services/cosmetic-dentistry",
          score: 0.4,
          satisfied: false,
          reason: "mentions crowns and veneers but never implants",
        },
        {
          where: "nav-label",
          value: "Treatments",
          score: 0.3,
          satisfied: false,
          reason: "an index page that does not link to an implants page",
        },
      ],
      reason: "No page, heading, link or sitemap entry covers dental implants.",
    },
  },
  {
    clientId: "dev-client-harbourside",
    ruleId: "broken-conversion-path",
    subject: "Book an appointment",
    title: "The main booking button leads to a dead page",
    detected:
      'The "Book an appointment" button in the site header links to /booking-v2, which returns HTTP 404. It appears on all 9 crawled pages.',
    rationale:
      "This is the practice's primary conversion path, and it is broken on every page of the site. Every visitor who tries to book right now fails, so enquiries are being lost daily until it is fixed.",
    scope: [
      "Repoint the header booking button at the live booking system.",
      "Add a redirect from /booking-v2 so existing links and bookmarks keep working.",
      "Re-test the path from desktop and mobile after the change.",
    ],
    refs: ["https://harboursidedental.example/", "https://harboursidedental.example/contact"],
    serviceId: "dev-svc-conversion",
    min: 300,
    max: 900,
    confidence: 0.95,
    status: "new",
    defect: {
      kind: "dead-conversion-link",
      pageUrl: "https://harboursidedental.example/",
      elementText: "Book an appointment",
      elementHref: "/booking-v2",
      target: "https://harboursidedental.example/booking-v2",
      observedStatus: 404,
      seenOn: ["https://harboursidedental.example/", "https://harboursidedental.example/contact"],
      note: "Probed twice, five seconds apart, with the same result.",
    },
  },
  {
    clientId: "dev-client-harbourside",
    ruleId: "missing-service-page",
    subject: "teeth whitening",
    title: "No page for teeth whitening",
    detected: "No page covers teeth whitening, though the practice lists it as an offering.",
    rationale:
      "Whitening is a common entry treatment that often leads to larger cosmetic work later.",
    scope: ["Build a teeth whitening page with before/after examples and pricing."],
    refs: ["https://harboursidedental.example/treatments"],
    serviceId: "dev-svc-landing",
    min: 900,
    max: 1800,
    confidence: 0.72,
    status: "snoozed",
    snoozeDays: 21,
  },
  {
    clientId: "dev-client-harbourside",
    ruleId: "missing-service-page",
    subject: "emergency dentistry",
    title: "No page for emergency dentistry",
    detected: "No page covers emergency dentistry.",
    rationale: "Emergency searches convert immediately, but there is nowhere for them to land.",
    scope: ["Build an emergency dentistry page with same-day contact details."],
    refs: ["https://harboursidedental.example/contact"],
    serviceId: "dev-svc-landing",
    min: 900,
    max: 1800,
    confidence: 0.66,
    status: "dismissed",
  },
];

const lines: string[] = [
  "-- Generated by scripts/dev-fixture.ts. Local development only.",
  `DELETE FROM opportunities WHERE workspace_id = ${q(workspaceId)} AND client_id LIKE 'dev-client-%';`,
  `DELETE FROM analysis_runs WHERE workspace_id = ${q(workspaceId)} AND client_id LIKE 'dev-client-%';`,
  `DELETE FROM evidence_bundles WHERE workspace_id = ${q(workspaceId)} AND client_id LIKE 'dev-client-%';`,
  `DELETE FROM client_coverage WHERE workspace_id = ${q(workspaceId)} AND client_id LIKE 'dev-client-%';`,
  `DELETE FROM clients WHERE workspace_id = ${q(workspaceId)} AND id LIKE 'dev-client-%';`,
  `DELETE FROM services WHERE workspace_id = ${q(workspaceId)} AND id LIKE 'dev-svc-%';`,
  "",
];

for (const service of services) {
  lines.push(
    `INSERT INTO services (id, workspace_id, name, description, price_min, price_max, tags, active, updated_at) VALUES (${q(service.id)}, ${q(workspaceId)}, ${q(service.name)}, ${q(service.description)}, ${service.min}, ${service.max}, ${q(JSON.stringify(service.tags))}, 1, ${q(iso(0))});`,
  );
}
lines.push("");

for (const client of clients) {
  lines.push(
    `INSERT INTO clients (id, workspace_id, name, domain, offerings, notes, updated_at) VALUES (${q(client.id)}, ${q(workspaceId)}, ${q(client.name)}, ${q(client.domain)}, ${q(JSON.stringify(client.offerings))}, ${q(client.notes)}, ${q(iso(0))});`,
  );
  if (client.run) {
    const at = iso(client.run.minutesAgo);
    lines.push(
      `INSERT INTO analysis_runs (workspace_id, client_id, started_at, finished_at, source, outcome, summary, limitation, pages_read, pages_fetched, blocked_events, inconclusive_events, surfaced, stats) VALUES (${q(workspaceId)}, ${q(client.id)}, ${q(at)}, ${q(at)}, 'http', ${q(client.run.outcome)}, ${q(client.run.summary)}, ${client.run.limitation ? q(client.run.limitation) : "NULL"}, ${client.run.pagesRead}, ${client.run.pagesFetched}, ${client.run.outcome === "inconclusive" ? 3 : 0}, 0, ${client.run.outcome === "findings" ? 2 : 0}, '{}');`,
    );
    // A second, older run so the history section has something to show.
    const older = iso(client.run.minutesAgo + 60 * 24 * 9);
    lines.push(
      `INSERT INTO analysis_runs (workspace_id, client_id, started_at, finished_at, source, outcome, summary, limitation, pages_read, pages_fetched, blocked_events, inconclusive_events, surfaced, stats) VALUES (${q(workspaceId)}, ${q(client.id)}, ${q(older)}, ${q(older)}, 'http', 'clean', 'Read 7 pages and found no unmet billable work.', NULL, 7, 7, 0, 0, 0, '{}');`,
    );
  }
}
lines.push("");

for (const opp of opportunities) {
  const snoozeUntil =
    opp.status === "snoozed" && opp.snoozeDays
      ? q(new Date(now.getTime() + opp.snoozeDays * 86_400_000).toISOString())
      : "NULL";
  lines.push(
    `INSERT INTO opportunities (id, workspace_id, dedupe_key, client_id, rule_id, title, detected, evidence_refs, rationale, suggested_service_id, suggested_scope, price_min, price_max, confidence, billable_status, status, snooze_until, proposal_md, verification, conversion_defect, updated_at) VALUES (${q("dev-opp-" + key(opp.clientId, opp.ruleId, opp.subject).slice(0, 12))}, ${q(workspaceId)}, ${q(key(opp.clientId, opp.ruleId, opp.subject))}, ${q(opp.clientId)}, ${q(opp.ruleId)}, ${q(opp.title)}, ${q(opp.detected)}, ${q(JSON.stringify(opp.refs))}, ${q(opp.rationale)}, ${q(opp.serviceId)}, ${q(JSON.stringify(opp.scope))}, ${opp.min}, ${opp.max}, ${opp.confidence}, 'billable', ${q(opp.status)}, ${snoozeUntil}, NULL, ${opp.verification ? q(JSON.stringify(opp.verification)) : "NULL"}, ${opp.defect ? q(JSON.stringify(opp.defect)) : "NULL"}, ${q(iso(30))});`,
  );
}

console.log(lines.join("\n"));
