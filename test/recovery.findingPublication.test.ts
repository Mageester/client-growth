import { describe, expect, it } from "vitest";
import { INSIGHT_CATEGORIES } from "@/core/insightTaxonomy";
import { DiagnosticSchema, InsightSnapshotSchema, type Diagnostic, type EvidenceRef, type Problem } from "@/core/insightSchema";
import { buildPublishedFindings } from "@/core/findingPublication";

const pageUrl = "https://example.com/";
const assessment = { grade: "strong" as const, claimScope: "observed" as const, coverage: "complete" as const, limitations: [], counterEvidence: [], counterEvidenceState: "checked_none" as const, unassessedEvidence: [] };

function snapshotFixture() {
  const evidence: EvidenceRef = { id: "evidence-1", runId: "1", kind: "page", locator: `page:${pageUrl}`, pageUrl, observedAt: "2026-09-19T00:00:00.000Z", payload: { status: 200 } };
  const diagnostic: Diagnostic = DiagnosticSchema.parse({ id: "diagnostic-1", workspaceId: "workspace-1", runId: "1", clientId: "client-1", detectorId: "missing-title", detectorVersion: "1", category: "technical_reliability", problemType: "missing_page_title", subject: { kind: "page", key: pageUrl }, observation: "The page is missing a non-empty HTML title.", evidenceRefs: [evidence.id], assessment, state: "observed", fingerprint: "fp-1", affectedPages: [pageUrl], details: { kind: "legacy", legacyRuleId: "missing-title" }, createdAt: "2026-09-19T00:00:00.000Z" });
  const problem: Problem = { id: "problem-1", workspaceId: "workspace-1", runId: "1", clientId: "client-1", canonicalKey: "missing-title|home", category: "technical_reliability", problemType: "missing_page_title", surfaceKey: pageUrl, statement: "The home page is missing a non-empty HTML title.", whyItMatters: "Search engines and visitors lose a clear page identity.", businessConsequence: "The page is harder to identify in search results.", diagnosticIds: [diagnostic.id], evidenceRefs: [evidence.id], affectedPages: [pageUrl], assessment, validationSteps: ["Add a unique descriptive HTML title and recrawl the page."], qualityGate: "supported", rejectionReasons: [], createdAt: "2026-09-19T00:00:00.000Z" };
  return InsightSnapshotSchema.parse({ workspaceId: "workspace-1", runId: "1", clientId: "client-1", evidence: [evidence], diagnostics: [diagnostic], problems: [problem], categories: INSIGHT_CATEGORIES.map((category) => category === "technical_reliability" ? { category, state: "assessed", diagnosticCount: 1, problemCount: 1, limitations: [] } : { category, state: "unassessed", diagnosticCount: 0, problemCount: 0, reason: "No current diagnostic was produced for this category.", limitations: [] }) });
}

describe("recovered finding publication", () => {
  it("publishes a supported problem with bounded provenance and ranking", () => {
    const result = buildPublishedFindings({ snapshot: snapshotFixture(), catalog: [] });
    expect(result.withheld).toBe(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ problemType: "missing_page_title", calibration: "VERIFIED_DEFECT", source: "deterministic", evidenceIds: ["evidence-1"], rank: 8 });
  });

  it("keeps measurement limitations separate from website findings", () => {
    const snapshot = snapshotFixture();
    const limitation = { ...snapshot.problems[0]!, id: "problem-2", problemType: "rendered_experience_failure", category: "experience" as const, canonicalKey: "render-limit", surfaceKey: "home", statement: "Visibility was not established because the render budget was exhausted.", whyItMatters: "The capture cannot establish a website defect.", businessConsequence: "No website claim is made.", assessment: { ...assessment, grade: "limited" as const }, qualityGate: "limited" as const, rejectionReasons: ["The render budget was exhausted."] };
    const withLimitation = InsightSnapshotSchema.parse({ ...snapshot, diagnostics: [], problems: [limitation], categories: INSIGHT_CATEGORIES.map((category) => category === "experience" ? { category, state: "limited", diagnosticCount: 0, problemCount: 1, reason: "Render evidence was limited.", limitations: ["Render evidence was limited."] } : { category, state: "unassessed", diagnosticCount: 0, problemCount: 0, reason: "No current diagnostic was produced for this category.", limitations: [] }) });
    const result = buildPublishedFindings({ snapshot: withLimitation, catalog: [] });
    expect(result.findings).toHaveLength(0);
    expect(result.limitations[0]?.calibration).toBe("ORBIT_MEASUREMENT_LIMITATION");
  });
});
