import { describe, expect, it } from "vitest";
import { buildEvidenceLedger } from "@/core/evidenceLedger";
import { materializeDiagnostics, problemKey, synthesizeProblems } from "@/core/problemSynthesis";

const bundle = {
  clientId: "client-1",
  source: "fixture" as const,
  capturedAt: "2026-09-19T00:00:00.000Z",
  site: {
    pages: [{ url: "https://example.com/", status: 200, title: "", h1s: ["Welcome"], headings: ["Welcome"], textExcerpt: "Readable page", wordCount: 80, forms: [] }],
    nav: [], links: [], sitemapUrls: [], crawlExhaustive: true,
  },
  networkEvents: [],
};

describe("recovered diagnostic and problem synthesis", () => {
  it("resolves legacy evidence into a typed diagnostic and problem", () => {
    const ledger = buildEvidenceLedger({ runId: "run-1", bundle });
    const drafts = [{
      detectorId: "missing-title",
      detectorVersion: "1",
      category: "technical_reliability",
      problemType: "missing_page_title",
      subject: { kind: "page", key: "https://example.com/" },
      observation: "The page has no non-empty HTML title in the supplied evidence.",
      legacyEvidenceRefs: ["page:https://example.com/", "title:missing"],
      rawConfidence: 0.95,
      state: "observed",
      details: { kind: "legacy", legacyRuleId: "missing-title" },
      origin: "SOURCE_HTTP",
    }];
    const diagnostics = materializeDiagnostics({
      workspaceId: "workspace-1",
      runId: "run-1",
      clientId: "client-1",
      coverage: "complete",
      drafts,
      ledger,
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.evidenceRefs.length).toBeGreaterThan(0);
    const problems = synthesizeProblems({ workspaceId: "workspace-1", runId: "run-1", clientId: "client-1", diagnostics });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.qualityGate).toBe("supported");
    expect(problemKey(diagnostics)).toContain("missing_page_title");
  });
});
