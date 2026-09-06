import { describe, expect, it } from "vitest";

import { CASES } from "./bench/cases";
import { JUDGMENT_CASES } from "./bench/judgmentCases";
import { runBenchmark, runCase } from "./bench/harness";
import { AGENCY_SERVICES, UNREACHABLE_SERVICE_IDS, agencyCatalog } from "./bench/agency";
import { assessCatalogCoverage } from "@/core/rules/registry";

/**
 * The opportunity-engine benchmark, run as a regression test.
 *
 * `pnpm bench` prints this as a readable scorecard; this file is what stops a
 * change quietly re-introducing a false positive. The asymmetry is deliberate
 * and load-bearing: a BAD grade fails the suite outright, because surfacing work
 * an agency cannot defend to their client is the one failure this product
 * cannot absorb. Finding less than it could is a worse product, not a broken
 * promise, so those are asserted per-case instead of in aggregate.
 */
describe("opportunity engine benchmark", () => {
  it("surfaces no work an agency could not defend, across every labeled case", async () => {
    const card = await runBenchmark();

    const bad = card.results.filter((r) => r.grade === "BAD").map((r) => `${r.id}: ${r.why}`);
    expect(bad).toEqual([]);
    expect(card.falsePositives).toBe(0);
  });

  it("finds every finding a human labeled as real, and nothing else", async () => {
    const card = await runBenchmark();

    const missed = card.results
      .filter((r) => r.falseNegatives.length > 0)
      .map((r) => `${r.id}: ${r.why}`);
    expect(missed).toEqual([]);
    expect(card.good).toBe(card.results.length);
  });

  it("never calls the evaluator for a candidate it has already decided not to sell", async () => {
    const card = await runBenchmark();

    for (const r of card.results) {
      const suppressed = r.stats.suppressedByCoverage + r.stats.suppressedByPriorDecision;
      // Cost control is structural: everything dropped by the evidence threshold,
      // by contract coverage or by a prior decision is dropped BEFORE any spend.
      expect(r.stats.evaluated).toBe(r.stats.passedEvidenceThreshold - suppressed);
      expect(r.stats.aiCalls).toBe(r.stats.evaluated);
    }
    // One call per surfaced finding and nothing more, over thirteen sites.
    expect(card.evaluatorCalls).toBe(5);
  });

  it("stays inside its per-run network budget on every case", async () => {
    for (const c of CASES) {
      const r = await runCase(c);
      expect(r.fetches).toBeLessThanOrEqual(12);
      expect(r.probes).toBeLessThanOrEqual(8);
    }
  });

  it("keeps a run inconclusive rather than clean whenever the site was not read", async () => {
    const blocked = await runCase(CASES.find((c) => c.id === "blocked-network")!);
    expect(blocked.outcome).toBe("inconclusive");
    expect(blocked.limitation).toMatch(/network policy/i);

    const thin = await runCase(CASES.find((c) => c.id === "service-section-never-reached")!);
    expect(thin.outcome).toBe("inconclusive");
    expect(thin.summary).toMatch(/never reached/i);
  });

  it("prices every surfaced finding from a service the benchmark agency actually sells", async () => {
    const card = await runBenchmark();
    const byName = new Map(agencyCatalog().map((s) => [s.name, s]));

    for (const r of card.results) {
      for (const surfaced of r.surfaced) {
        const service = [...byName.values()].find(
          (s) => s.priceMin === surfaced.priceMin && s.priceMax === surfaced.priceMax,
        );
        expect(service, `${surfaced.title} was priced outside the catalog`).toBeDefined();
      }
    }
  });

  it("records which catalog services no rule can reach, so the gap is measured not assumed", () => {
    const coverage = assessCatalogCoverage(agencyCatalog());
    // The benchmark agency only has the three original services configured;
    // the expanded technical rules, and the competitor-gap page, remain visibly
    // unmatched until an agency opts into their starter services.
    expect(coverage.matched).toBe(3);
    expect(coverage.total).toBe(12);

    const reachableTags = coverage.rules.map((r) => r.tag);
    const unreachable = AGENCY_SERVICES.filter(
      (s) => !s.tags.some((tag) => reachableTags.includes(tag)),
    ).map((s) => s.id);
    // A real agency sells more than two rules can detect. When a third rule
    // lands, this list shrinks and the assertion says so.
    expect(unreachable).toEqual([...UNREACHABLE_SERVICE_IDS]);
  });
});

/**
 * The measured cost of shipping with MockEvaluator.
 *
 * MockEvaluator surfaces every candidate the deterministic rules hand it, so on
 * a judgment case it can only be as good as the rules are. These assertions pin
 * the CURRENT behaviour rather than the desired behaviour, so the gap is a
 * tracked number instead of a surprise: when a real evaluator is switched on,
 * this suite fails and the numbers get updated deliberately.
 *
 * Measured against DeepSeek (deepseek-chat, temperature 0) after the structured
 * judgment contract landed — 37 adversarial cases x 3 samples, 114 calls, $0.05:
 *   - 12/12 real service lines surfaced, 3/3 samples each
 *   - 0/7 trust signals, 0/7 promotions, 0/4 generic claims surfaced, ever
 *   - "free quotes", previously surfaced 3/5, is now rejected as a promotion
 *     in every sample
 * The instability the previous sprint measured came from asking for a verdict
 * and a confidence number; asking WHAT THE SUBJECT IS removed it. See
 * `pnpm bench --deepseek --samples=N` and test/bench/adversarialCases.ts.
 */
describe("judgment cases — what the deterministic engine cannot decide alone", () => {
  it("still refuses to invent a gap the rules cannot prove", async () => {
    const card = await runBenchmark(undefined, JUDGMENT_CASES);
    for (const r of card.results) {
      // Whatever the evaluator decides, every surfaced item traces to a
      // candidate the rules established deterministically.
      expect(r.stats.surfaced).toBeLessThanOrEqual(r.stats.passedEvidenceThreshold);
    }
  });

  it("surfaces a client's marketing claims as billable pages, because the mock never rejects", async () => {
    const result = await runCase(
      JUDGMENT_CASES.find((c) => c.id === "marketing-claims-as-offerings")!,
    );

    // "Free quotes" and "fully insured" are things the business says, not things
    // it sells. The rules cannot tell the difference — that is a judgment — so
    // with MockEvaluator they are priced as $900–$1,800 landing pages.
    expect(result.grade).toBe("BAD");
    expect(result.falsePositives).toHaveLength(2);
    expect(result.falsePositives.join(" ")).toMatch(/free quotes/i);
    expect(result.falsePositives.join(" ")).toMatch(/fully insured/i);
  });

  it("still gets the cases that need no judgment right", async () => {
    const stale = await runCase(
      JUDGMENT_CASES.find((c) => c.id === "stale-duplicate-contact-link")!,
    );
    expect(stale.grade).toBe("GOOD");
    expect(stale.surfaced).toHaveLength(1);
  });

  it("records the deterministic miss on a high-intent variant of an existing page", async () => {
    const variant = await runCase(
      JUDGMENT_CASES.find((c) => c.id === "high-intent-variant-of-existing-page")!,
    );

    // No evaluator can recover this one: the rule concluded "emergency boiler
    // repair" is already covered by /boiler-repair and produced no candidate at
    // all. It is a rule-level false negative, and a conservative one.
    expect(variant.stats.candidates).toBe(0);
    expect(variant.grade).toBe("QUESTIONABLE");
  });
});
