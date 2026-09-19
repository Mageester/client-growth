import { describe, expect, it } from "vitest";
import { diagnosticFromVisualFinding, validateVisualFindings, visualCandidate } from "@/core/visualReview";
import { VisualEvidenceReferenceSchema, VisualFindingSchema } from "@/core/visualSchema";

describe("recovered visual review boundaries", () => {
  it("accepts an exact screenshot-backed finding and adapts it only after validation", () => {
    const screenshot = {
      id: "shot_1",
      pageUrl: "https://example.com/",
      viewport: "desktop" as const,
      width: 1440,
      height: 900,
      capturedAt: "2026-09-19T00:00:00.000Z",
      label: "Homepage desktop",
      text: "A readable page capture with enough text to avoid a blocked or empty screenshot.",
    };
    const raw = {
      category: "enquiry-friction",
      pageUrl: screenshot.pageUrl,
      screenshotIds: [screenshot.id],
      visualEvidence: [{ screenshotId: screenshot.id, pageUrl: screenshot.pageUrl, viewport: screenshot.viewport, width: screenshot.width, height: screenshot.height, visibleRegion: { left: 10, top: 10, width: 200, height: 80 } }],
      title: "Primary enquiry action is hard to find",
      observation: "The primary enquiry action is visually easy to miss in the captured page composition.",
      impact: "Visitors may not notice the next step when deciding whether to enquire.",
      recommendation: "Give the primary action a clearer visual hierarchy and repeat it near the decision point.",
      scope: ["Review the header and hero action placement on the captured page.", "Compare the action hierarchy against the next decision point."],
      acceptanceCriteria: ["The primary action is visually distinct and easy to identify in a fresh capture."],
      effort: "small" as const,
      priority: "high" as const,
      serviceId: "visual-service",
    };
    expect(VisualEvidenceReferenceSchema.safeParse(raw.visualEvidence[0]).success).toBe(true);
    expect(VisualFindingSchema.safeParse(raw).success).toBe(true);
    const findings = validateVisualFindings([raw], [screenshot], [], [{ id: "visual-service", name: "Conversion design", description: "", priceMin: 100, priceMax: 200, tags: ["visual-review"], active: true }], { mode: "publish" });
    expect(findings).toHaveLength(1);
    expect(visualCandidate(findings[0]!).suggestedServiceId).toBe("visual-service");
    expect(diagnosticFromVisualFinding(findings[0]!).details?.kind).toBe("legacy");
  });
});
