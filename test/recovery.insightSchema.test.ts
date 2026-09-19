import { describe, expect, it } from "vitest";
import {
  DiagnosticSchema,
  EvidenceAssessmentSchema,
  EvidenceRefSchema,
  ProblemSchema,
} from "@/core/insightSchema";

describe("recovered insight schemas", () => {
  it("backfills legacy counter-evidence state without weakening the boundary", () => {
    const result = EvidenceAssessmentSchema.parse({
      grade: "strong",
      claimScope: "observed",
      coverage: "complete",
      limitations: [],
      counterEvidence: [],
      unassessedEvidence: [],
    });
    expect(result.counterEvidenceState).toBe("not_checked");
    expect(() => EvidenceRefSchema.parse({
      id: "evidence-1",
      runId: "run-1",
      kind: "page",
      locator: "https://example.com",
      observedAt: "2026-09-19T00:00:00.000Z",
      payload: { status: 200, readable: true },
    })).not.toThrow();
  });

  it("rejects category drift between a problem and its taxonomy", () => {
    const base = {
      id: "diag-1",
      workspaceId: "ws-1",
      runId: "run-1",
      clientId: "client-1",
      detectorId: "detector-1",
      detectorVersion: "v1",
      category: "conversion",
      problemType: "missing_service_path",
      subject: { kind: "site", key: "site" },
      observation: "The evidence describes a missing service path.",
      evidenceRefs: ["evidence-1"],
      assessment: {
        grade: "strong",
        claimScope: "observed",
        coverage: "complete",
        limitations: [],
        counterEvidence: [],
        counterEvidenceState: "checked_none",
        unassessedEvidence: [],
      },
      state: "observed",
      fingerprint: "fingerprint-1",
      createdAt: "2026-09-19T00:00:00.000Z",
    };
    expect(() => DiagnosticSchema.parse(base)).toThrow();
    expect(() => ProblemSchema.parse({
      ...base,
      canonicalKey: "missing_service_path:site",
      surfaceKey: "site",
      statement: "A service path is missing from the website.",
      whyItMatters: "Visitors may not find the offering.",
      businessConsequence: "The service may be harder to discover.",
      diagnosticIds: ["diag-1"],
      affectedPages: [],
      validationSteps: [],
      qualityGate: "supported",
      rejectionReasons: [],
    })).toThrow();
  });
});
