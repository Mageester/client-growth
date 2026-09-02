import { describe, expect, it, vi } from "vitest";

import { analyzeClient } from "@/pipeline/analyzeClient";
import type { EvaluatorInput, OpportunityEvaluator } from "@/ports/OpportunityEvaluator";
import type { Evaluation } from "@/core/schema";

import { agencyCatalog } from "./bench/agency";
import { BenchEvidenceProvider, clientFor, type SiteSpec } from "./bench/site";

/**
 * What the evaluator's judgment is allowed to do.
 *
 * Deterministic rules establish the FACT; the evaluator only decides whether it
 * is worth bringing to this client. Today production runs MockEvaluator, which
 * surfaces every candidate it is given — so the rejection path below is never
 * exercised live, and these tests are what keeps it correct until a real
 * provider is switched on.
 */

const NOW = new Date("2026-09-02T00:00:00.000Z");

function evaluator(fn: (input: EvaluatorInput) => Evaluation): OpportunityEvaluator {
  return { evaluate: (input) => Promise.resolve(fn(input)) };
}

const surface = (confidence: number): Evaluation => ({
  verdict: "surface",
  confidence,
  rationale: "Worth raising with the client.",
  suggestedScope: ["Build the page"],
});

/**
 * A roofer whose site has a service section the crawl demonstrably reached — so
 * absence is provable — but no page for anything it actually sells. Three
 * independent gaps, which is what makes the call cap and the per-candidate
 * rejection path observable.
 */
const SITE: SiteSpec = {
  origin: "https://threegaps.test",
  nav: ["Home", "About", "Contact", "Our Services", "What We Do"],
  pages: [
    { path: "/", title: "Three Gaps Roofing", h1s: ["Three Gaps Roofing"] },
    { path: "/services", title: "Our Services", h1s: ["Our Services"] },
    { path: "/what-we-do", title: "What We Do", h1s: ["What We Do"] },
    { path: "/about", title: "About", h1s: ["About us"] },
    { path: "/contact", title: "Contact", h1s: ["Contact us"] },
  ],
  links: [
    { href: "/services", label: "Our Services", inNav: true },
    { href: "/what-we-do", label: "What We Do", inNav: true },
    { href: "/contact", label: "Contact us" },
  ],
};

const CLIENT = clientFor({
  id: "c-threegaps",
  name: "Three Gaps Roofing",
  origin: SITE.origin,
  offerings: ["chimney repointing", "skylight fitting", "lead flashing"],
});

async function analyze(ev: OpportunityEvaluator, maxAiCalls?: number) {
  return analyzeClient({
    client: CLIENT,
    catalog: agencyCatalog(),
    coverage: [],
    evidenceProvider: new BenchEvidenceProvider(CLIENT.id, SITE),
    evaluator: ev,
    now: NOW,
    maxAiCalls,
  });
}

describe("evaluator judgment", () => {
  it("produces three independent candidates to judge", async () => {
    const result = await analyze(evaluator(() => surface(0.8)));
    expect(result.stats.candidates).toBe(3);
    expect(result.stats.passedEvidenceThreshold).toBe(3);
    expect(result.opportunities).toHaveLength(3);
  });

  it("surfaces nothing the evaluator rejects, and says so in the stats", async () => {
    const result = await analyze(
      evaluator(({ candidate }) =>
        candidate.subject === "skylight fitting"
          ? surface(0.8)
          : {
              verdict: "reject",
              confidence: 0.95,
              rationale: "Deliberately retired service line.",
              suggestedScope: [],
            },
      ),
    );

    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]!.title).toMatch(/skylight/i);
    expect(result.stats.rejectedByEvaluator).toBe(2);
    // A rejection is a judgment, not a failure — it must not make the run
    // inconclusive the way an unreachable provider does.
    expect(result.stats.evaluatorErrors).toBe(0);
  });

  it("drops a low-confidence surface verdict, however confident the wording", async () => {
    const result = await analyze(evaluator(() => surface(0.49)));
    expect(result.opportunities).toHaveLength(0);
    expect(result.stats.rejectedByEvaluator).toBe(3);
  });

  it("keeps a verdict exactly at the confidence floor", async () => {
    const result = await analyze(evaluator(() => surface(0.5)));
    expect(result.opportunities).toHaveLength(3);
    expect(result.stats.rejectedByEvaluator).toBe(0);
  });

  it("stops at the per-run call cap instead of spending without a limit", async () => {
    const evaluate = vi.fn(() => Promise.resolve(surface(0.8)));

    const result = await analyze({ evaluate }, 2);

    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(result.stats.aiCalls).toBe(2);
    expect(result.opportunities).toHaveLength(2);
    // The third candidate is left unjudged rather than surfaced unjudged.
    expect(result.stats.candidates).toBe(3);
  });

  it("gives the evaluator the established fact, never a question about it", async () => {
    const seen: EvaluatorInput[] = [];
    await analyze(
      evaluator((input) => {
        seen.push(input);
        return surface(0.8);
      }),
    );

    expect(seen).toHaveLength(3);
    for (const input of seen) {
      // Everything the evaluator needs to judge, with the absence already proven
      // deterministically so the model is never asked to re-derive it.
      expect(input.candidate.verification?.conclusion).toBe("absent");
      expect(input.candidate.evidenceRefs.length).toBeGreaterThan(0);
      expect(input.client.id).toBe(CLIENT.id);
      expect(input.evidence.site.pages.length).toBeGreaterThan(0);
    }
  });
});
