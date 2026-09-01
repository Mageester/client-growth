import { describe, expect, it } from "vitest";

import { classifyAnalysis, measureEvidenceReach } from "@/core/analysisOutcome";
import type { EvidenceBundle } from "@/core/schema";

function bundle(overrides: Partial<EvidenceBundle["site"]> = {}, networkEvents: EvidenceBundle["networkEvents"] = []): EvidenceBundle {
  return {
    clientId: "c1",
    source: "http",
    capturedAt: "2026-09-01T00:00:00.000Z",
    site: { pages: [], nav: [], links: [], sitemapUrls: [], ...overrides },
    networkEvents,
  };
}

function page(url: string, status = 200, wordCount = 400) {
  return {
    url,
    status,
    title: "Page",
    h1s: [],
    headings: [],
    textExcerpt: "",
    wordCount,
    forms: [],
  };
}

const CLEAN_INPUT = {
  analyzable: true,
  coverageReason: "Service coverage confirmed.",
  surfaced: 0,
  evaluatorErrors: 0,
};

describe("analysis outcome classification", () => {
  it("reports findings when work was surfaced", () => {
    const result = classifyAnalysis({
      ...CLEAN_INPUT,
      evidence: bundle({ pages: [page("https://a.example/")] }),
      surfaced: 2,
    });
    expect(result.outcome).toBe("findings");
    expect(result.summary).toContain("2 evidence-backed opportunities");
    expect(result.limitation).toBeNull();
  });

  it("reports clean only when pages were actually read", () => {
    const result = classifyAnalysis({
      ...CLEAN_INPUT,
      evidence: bundle({ pages: [page("https://a.example/"), page("https://a.example/x")] }),
    });
    expect(result.outcome).toBe("clean");
    expect(result.reach.readablePages).toBe(2);
  });

  it("NEVER reports clean when the crawl read nothing", () => {
    const result = classifyAnalysis({ ...CLEAN_INPUT, evidence: bundle() });
    expect(result.outcome).toBe("inconclusive");
    expect(result.summary).not.toMatch(/no unmet billable work/i);
  });

  it("names the network policy when requests were blocked", () => {
    const result = classifyAnalysis({
      ...CLEAN_INPUT,
      evidence: bundle({}, [
        { url: "http://10.0.0.1/", outcome: "blocked", reason: "private address" },
      ]),
    });
    expect(result.outcome).toBe("inconclusive");
    expect(result.summary).toContain("could not be reached safely");
    expect(result.limitation).toContain("network policy");
    expect(result.reach.blockedEvents).toBe(1);
  });

  it("treats a site that answered but returned no readable body as inconclusive", () => {
    const result = classifyAnalysis({
      ...CLEAN_INPUT,
      evidence: bundle({ pages: [page("https://a.example/", 200, 0)] }),
    });
    expect(result.outcome).toBe("inconclusive");
    expect(result.limitation).toContain("no page returned readable HTML");
  });

  it("treats error-status-only crawls as inconclusive, not clean", () => {
    const result = classifyAnalysis({
      ...CLEAN_INPUT,
      evidence: bundle({ pages: [page("https://a.example/", 503, 0)] }),
    });
    expect(result.outcome).toBe("inconclusive");
  });

  it("is inconclusive when the crawl never reached the service section", () => {
    const result = classifyAnalysis({
      ...CLEAN_INPUT,
      evidence: bundle({ pages: [page("https://a.example/")] }),
      analyzable: false,
      coverageReason: "Insufficient service coverage: only 0 offering(s) represented.",
    });
    expect(result.outcome).toBe("inconclusive");
    expect(result.limitation).toContain("Insufficient service coverage");
  });

  it("is inconclusive when the evaluator failed, because dropped candidates are unknowns", () => {
    const result = classifyAnalysis({
      ...CLEAN_INPUT,
      evidence: bundle({ pages: [page("https://a.example/")] }),
      evaluatorErrors: 2,
    });
    expect(result.outcome).toBe("inconclusive");
    expect(result.summary).toContain("2 candidates could not be assessed");
  });

  it("surfaced findings outrank an evaluator error, since the site was demonstrably read", () => {
    const result = classifyAnalysis({
      ...CLEAN_INPUT,
      evidence: bundle({ pages: [page("https://a.example/")] }),
      surfaced: 1,
      evaluatorErrors: 1,
    });
    expect(result.outcome).toBe("findings");
  });

  it("flags a partial failure on an otherwise clean run without downgrading it", () => {
    const result = classifyAnalysis({
      ...CLEAN_INPUT,
      evidence: bundle({ pages: [page("https://a.example/")] }, [
        { url: "https://a.example/pdf", outcome: "inconclusive", reason: "not html" },
      ]),
    });
    expect(result.outcome).toBe("clean");
    expect(result.limitation).toContain("could not be completed");
  });
});

describe("evidence reach", () => {
  it("counts only 2xx pages with readable content", () => {
    const reach = measureEvidenceReach(
      bundle({
        pages: [
          page("https://a.example/"),
          page("https://a.example/404", 404, 0),
          page("https://a.example/empty", 200, 0),
          page("https://a.example/moved", 301, 500),
        ],
      }),
    );
    expect(reach.readablePages).toBe(1);
    expect(reach.fetchedPages).toBe(4);
  });
});
