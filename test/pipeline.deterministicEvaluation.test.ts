import { describe, expect, it, vi } from "vitest";

import { analyzeClient } from "@/pipeline/analyzeClient";
import { deterministicEvaluationFor } from "@/core/rules/deterministicEvaluation";
import { assembleOpportunity } from "@/core/assembleOpportunity";
import { judge } from "@/core/judgment";
import {
  CandidateSchema,
  ClientSchema,
  EvidenceBundleSchema,
  ServiceSchema,
  type Candidate,
  type Service,
} from "@/core/schema";
import type { OpportunityEvaluator } from "@/ports/OpportunityEvaluator";
import type { EvidenceProvider } from "@/ports/EvidenceProvider";

/**
 * Findings that carry their own judgment.
 *
 * no-service-pages was shipped without teaching either evaluator about it, and
 * the result was silent: the candidate was generated, passed the evidence
 * threshold, reached the evaluator and was rejected. MockEvaluator — the
 * default — has no branch for the rule and rejects anything it does not
 * recognise, and the live provider would have been handed the service-judgment
 * prompt with a DOMAIN as the subject, asking it whether "kids-connect.ca" is a
 * distinct service line.
 *
 * Measured against the analyzability corpus that cost two of four findings and
 * every AI call spent on them. These pin the fix.
 */

const SERVICE: Service = ServiceSchema.parse({
  id: "svc-service-pages-build",
  name: "Service pages build",
  description: "",
  priceMin: 2500,
  priceMax: 6000,
  tags: ["service-pages-build"],
  active: true,
});

const candidate = (over: Partial<Candidate> = {}): Candidate =>
  CandidateSchema.parse({
    ruleId: "no-service-pages",
    subject: "northwind.example",
    detected: "The crawl followed every link and none of it describes a service.",
    evidenceRefs: ["https://northwind.example/", "https://northwind.example/about"],
    rawConfidence: 0.9,
    suggestedServiceId: SERVICE.id,
    ...over,
  });

/**
 * A brochure site: readable, exhaustively crawled, and selling nothing.
 *
 * Built by hand rather than with BenchEvidenceProvider, which never sets
 * crawlExhaustive — so the bench fixtures cannot represent a thin site at all,
 * and that is exactly why the whole suite passed while this rule was being
 * rejected on every real site it fired on.
 */
function thinSiteProvider(clientId: string): EvidenceProvider {
  const page = (path: string, title: string, words: number) => ({
    url: "https://northwind.example" + path,
    status: 200,
    title,
    h1s: [title],
    headings: [],
    textExcerpt: "",
    wordCount: words,
    forms: [],
  });

  return {
    getEvidence: () =>
      Promise.resolve(
        EvidenceBundleSchema.parse({
          clientId,
          source: "http",
          capturedAt: "2026-09-04T00:00:00.000Z",
          site: {
            pages: [page("/", "Northwind", 220), page("/about", "About us", 180), page("/contact", "Contact", 140)],
            nav: ["About us", "Contact"],
            links: [],
            sitemapUrls: [],
            crawlExhaustive: true,
          },
          networkEvents: [],
        }),
      ),
  };
}

const client = ClientSchema.parse({
  id: "c-northwind",
  name: "Northwind",
  domain: "northwind.example",
  offerings: ["Boiler installation", "Emergency repair"],
  notes: "",
});

describe("deterministic evaluation", () => {
  it("judges no-service-pages without a model", () => {
    const evaluation = deterministicEvaluationFor(candidate());

    expect(evaluation).not.toBeNull();
    expect(evaluation!.verdict).toBe("surface");
    expect(evaluation!.commerciallyActionable).toBe(true);
    // The rules' own evidence strength, never a number a model chose.
    expect(evaluation!.confidence).toBe(0.9);
    expect(evaluation!.suggestedScope.length).toBeGreaterThan(0);
    expect(evaluation!.rationale.length).toBeGreaterThan(40);
  });

  it("passes the commercial gate that rejected it before", () => {
    const c = candidate();
    expect(judge(c, deterministicEvaluationFor(c)!).surface).toBe(true);
  });

  it("sends every other rule to the evaluator", () => {
    // Widening this is how a guess reaches an agency's client, so it is the
    // assertion that matters most in this file.
    expect(deterministicEvaluationFor(candidate({ ruleId: "missing-service-page" }))).toBeNull();
    expect(deterministicEvaluationFor(candidate({ ruleId: "broken-conversion-path" }))).toBeNull();
  });

  it("titles the finding as a site, not as one missing page", () => {
    const opportunity = assembleOpportunity({
      candidate: candidate(),
      evaluation: deterministicEvaluationFor(candidate())!,
      billableStatus: "billable",
      service: SERVICE,
      clientId: client.id,
      now: new Date("2026-09-04T00:00:00.000Z"),
    });

    // The default path would title this "Northwind.Example — dedicated service
    // page", which is the headline an agency puts in front of their client.
    expect(opportunity.title).toBe("northwind.example describes none of its services");
    expect(opportunity.priceMin).toBe(2500);
  });
});

describe("the pipeline with a self-judging finding", () => {
  const run = (evaluator: OpportunityEvaluator, maxAiCalls = 10) =>
    analyzeClient({
      client,
      catalog: [SERVICE],
      coverage: [],
      existing: [],
      evidenceProvider: thinSiteProvider(client.id),
      evaluator,
      maxAiCalls,
    });

  it("surfaces the finding without calling the evaluator at all", async () => {
    const evaluate = vi.fn();
    const result = await run({ evaluate } as unknown as OpportunityEvaluator);

    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]?.ruleId).toBe("no-service-pages");
    expect(evaluate).not.toHaveBeenCalled();
    expect(result.stats.aiCalls).toBe(0);
    expect(result.stats.rejectedByEvaluator).toBe(0);
  });

  it("is not dropped when the run has no AI budget left", async () => {
    // The cap bounds spend. A finding that costs nothing must not be discarded
    // by it, or a chatty portfolio silently loses fully-evidenced work.
    const evaluate = vi.fn();
    const result = await run({ evaluate } as unknown as OpportunityEvaluator, 0);

    expect(result.opportunities).toHaveLength(1);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("still fails closed if the deterministic judgment ever stops surfacing", async () => {
    // Guards the seam itself: nothing here bypasses judge().
    const c = candidate();
    const evaluation = deterministicEvaluationFor(c)!;
    expect(judge(c, { ...evaluation, verdict: "reject" }).surface).toBe(false);
    expect(judge(c, { ...evaluation, commerciallyActionable: false }).surface).toBe(false);
    expect(judge(c, { ...evaluation, confidence: 0.2 }).surface).toBe(false);
  });
});
