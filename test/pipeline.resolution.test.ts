import { describe, expect, it } from "vitest";

import { analyzeClient } from "@/pipeline/analyzeClient";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import { dedupeKey } from "@/core/dedupe";
import { OpportunitySchema, ServiceSchema, type Opportunity } from "@/core/schema";
import type { OpportunityEvaluator } from "@/ports/OpportunityEvaluator";

import { agencyCatalog } from "./bench/agency";
import { CASES, clientOf } from "./bench/cases";
import { BenchEvidenceProvider, type SiteSpec } from "./bench/site";

/**
 * Closing out findings the client has fixed.
 *
 * Re-analysis only ever upserted what it found, so a repaired 404 CTA stayed
 * `new` and `billable` forever — it kept counting toward the client's open
 * opportunities and toward estimated potential value, and the agency could not
 * tell a live gap from one the client had already dealt with.
 *
 * The dangerous version of this fix is a run that resolves everything because it
 * could not look, which would quietly delete real pipeline. Most of what follows
 * is about that: the cases where resolution must NOT happen.
 */

const NOW = new Date("2026-09-02T00:00:00.000Z");
const DENTAL = CASES.find((c) => c.id === "broken-cta-404")!;

/** The same site, with the booking CTA now pointing at a page that works. */
function repairedSite(): SiteSpec {
  return {
    ...DENTAL.site,
    pages: DENTAL.site.pages.map((p) =>
      p.path === "/book-online" ? { ...p, status: 200, title: "Book online", words: 300 } : p,
    ),
  };
}

function priorFinding(overrides: Partial<Opportunity> = {}): Opportunity {
  const client = clientOf(DENTAL);
  const subject = "dead-conversion-link:https://meridiandental.test/book-online";
  return OpportunitySchema.parse({
    id: "opp-prior",
    dedupeKey: dedupeKey(client.id, "broken-conversion-path", subject),
    clientId: client.id,
    ruleId: "broken-conversion-path",
    title: 'Broken "Book an appointment" link',
    detected: "The booking button returned HTTP 404 when we last looked.",
    evidenceRefs: ["page:https://meridiandental.test/", "status:404"],
    rationale: "Every affected visit is a lost enquiry until it is fixed.",
    suggestedServiceId: "svc-conversion-fix",
    suggestedScope: [],
    priceMin: 300,
    priceMax: 1000,
    confidence: 0.9,
    billableStatus: "billable",
    status: "new",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  });
}

async function reanalyze(options: {
  site?: SiteSpec;
  existing?: Opportunity[];
  catalog?: ReturnType<typeof agencyCatalog>;
  evaluator?: OpportunityEvaluator;
  maxAiCalls?: number;
}) {
  const client = clientOf(DENTAL);
  return analyzeClient({
    client,
    catalog: options.catalog ?? agencyCatalog(),
    coverage: [],
    existing: options.existing ?? [priorFinding()],
    evidenceProvider: new BenchEvidenceProvider(client.id, options.site ?? repairedSite()),
    evaluator: options.evaluator ?? new MockEvaluator(),
    now: NOW,
    maxAiCalls: options.maxAiCalls,
  });
}

describe("resolving findings the client has fixed", () => {
  it("marks a repaired defect resolved instead of billing it forever", async () => {
    const result = await reanalyze({});

    expect(result.opportunities).toHaveLength(0);
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]!.status).toBe("resolved");
    expect(result.resolved[0]!.id).toBe("opp-prior");
    expect(result.stats.resolved).toBe(1);
  });

  it("leaves a finding that is still there completely alone", async () => {
    const result = await reanalyze({ site: DENTAL.site });

    expect(result.resolved).toHaveLength(0);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]!.id).toBe("opp-prior");
  });

  it("keeps the proposal when a finding the agency had drafted for is fixed", async () => {
    const result = await reanalyze({
      existing: [
        priorFinding({ status: "proposal_prepared", proposalMd: "# Draft the agency wrote" }),
      ],
    });

    // The work is gone, so it must stop counting as open pipeline — but the
    // draft is the agency's writing and is not thrown away.
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]!.status).toBe("resolved");
    expect(result.resolved[0]!.proposalMd).toBe("# Draft the agency wrote");
  });

  it("never overwrites a decision the agency already made", async () => {
    for (const status of ["dismissed", "snoozed", "already_covered"] as const) {
      const result = await reanalyze({
        existing: [
          priorFinding({
            status,
            snoozeUntil: status === "snoozed" ? "2027-01-01T00:00:00.000Z" : undefined,
            billableStatus: status === "already_covered" ? "already_covered" : "billable",
          }),
        ],
      });
      expect(result.resolved, `${status} must not be resolved`).toHaveLength(0);
    }
  });

  it("resolves nothing when the site could not be read", async () => {
    const result = await reanalyze({
      site: { origin: DENTAL.site.origin, pages: [], blockedPaths: ["/"] },
    });

    // Absence of evidence is not evidence of repair. This is the case that would
    // silently wipe a client's whole pipeline on one bad crawl.
    expect(result.resolved).toHaveLength(0);
  });

  it("resolves nothing when the rule that found it could not run this time", async () => {
    // The agency deactivated their conversion-fix service, so the rule never
    // ran. Its previous findings are unverified, not fixed.
    const catalog = agencyCatalog().map((s) =>
      s.id === "svc-conversion-fix" ? ServiceSchema.parse({ ...s, active: false }) : s,
    );
    const result = await reanalyze({ site: DENTAL.site, catalog });

    expect(result.catalogCoverage.matched).toBe(1);
    expect(result.resolved).toHaveLength(0);
  });

  it("resolves nothing when the evaluator failed, because the run is incomplete", async () => {
    const throwing: OpportunityEvaluator = {
      evaluate: () => Promise.reject(new Error("provider unreachable")),
    };
    // A finding for the OTHER rule is present and will be evaluated (and fail),
    // so the run cannot vouch for what it did not get through.
    const result = await analyzeClient({
      client: clientOf(CASES.find((c) => c.id === "missing-service-page")!),
      catalog: agencyCatalog(),
      coverage: [],
      existing: [priorFinding()],
      evidenceProvider: new BenchEvidenceProvider(
        clientOf(CASES.find((c) => c.id === "missing-service-page")!).id,
        CASES.find((c) => c.id === "missing-service-page")!.site,
      ),
      evaluator: throwing,
      now: NOW,
    });

    expect(result.stats.evaluatorErrors).toBeGreaterThan(0);
    expect(result.resolved).toHaveLength(0);
  });

  it("resolves nothing when the call cap truncated the run", async () => {
    const result = await reanalyze({ site: DENTAL.site, maxAiCalls: 1 });

    // One candidate, one call — the cap was reached exactly, so candidates may
    // have gone unjudged and nothing may be declared fixed.
    expect(result.stats.aiCalls).toBe(1);
    expect(result.resolved).toHaveLength(0);
  });

  it("does not resolve a missing-service-page finding from a crawl that never reached the services", async () => {
    const thin = CASES.find((c) => c.id === "service-section-never-reached")!;
    const client = clientOf(thin);
    const prior = OpportunitySchema.parse({
      ...priorFinding(),
      clientId: client.id,
      ruleId: "missing-service-page",
      dedupeKey: dedupeKey(client.id, "missing-service-page", "curtains and blinds"),
      suggestedServiceId: "svc-landing-page",
    });

    const result = await analyzeClient({
      client,
      catalog: agencyCatalog(),
      coverage: [],
      existing: [prior],
      evidenceProvider: new BenchEvidenceProvider(client.id, thin.site),
      evaluator: new MockEvaluator(),
      now: NOW,
    });

    expect(result.coverage.analyzable).toBe(false);
    expect(result.resolved).toHaveLength(0);
  });

  it("stops a resolved finding counting toward open work and pipeline value", async () => {
    const { totalsFor, isOpen, statusBadge } = await import("../app/lib/portfolio");
    const result = await reanalyze({});
    const resolved = result.resolved[0]!;

    expect(isOpen(resolved, NOW)).toBe(false);
    expect(totalsFor([resolved], NOW)).toEqual({
      open: 0,
      closed: 1,
      priceMin: 0,
      priceMax: 0,
    });
    expect(statusBadge(resolved, NOW).label).toBe("Fixed by the client");
  });
});
