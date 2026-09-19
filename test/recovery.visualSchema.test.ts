import { describe, expect, it } from "vitest";
import {
  RenderedPageObservationSchema,
  VisualEvidenceReferenceSchema,
  VisualPageUrlSchema,
  VisualScreenshotSchema,
  isCredentialBearingIdentifier,
} from "@/core/visualSchema";

describe("recovered visual evidence boundaries", () => {
  it("rejects credential-bearing identifiers and URLs", () => {
    expect(isCredentialBearingIdentifier("https://example.com/?access_token=secret")).toBe(true);
    expect(() => VisualPageUrlSchema.parse("https://example.com/?token=secret")).toThrow();
    expect(() => VisualScreenshotSchema.parse({
      id: "shot-1",
      pageUrl: "https://example.com/",
      viewport: "desktop",
      width: 1440,
      height: 900,
      capturedAt: "2026-09-19T00:00:00.000Z",
      label: "Homepage",
    })).not.toThrow();
  });

  it("binds rendered observations to their screenshot identity", () => {
    const valid = {
      runId: "run-1",
      screenshotId: `shot_${"a".repeat(64)}`,
      pageUrl: "https://example.com/",
      viewport: "mobile",
      width: 390,
      height: 844,
      capturedAt: "2026-09-19T00:00:00.000Z",
      source: "rendered",
      elements: [],
    } as const;
    expect(RenderedPageObservationSchema.parse(valid)).toEqual(valid);
    expect(() => RenderedPageObservationSchema.parse({
      ...valid,
      elements: [{
        runId: "other-run",
        screenshotId: valid.screenshotId,
        pageUrl: valid.pageUrl,
        viewport: valid.viewport,
        viewportWidth: valid.width,
        viewportHeight: valid.height,
        elementKey: "cta",
        kind: "button",
        geometry: { left: 10, top: 10, width: 100, height: 40, horizontallyClipped: false, verticallyClipped: false },
        labelState: "present",
        label: "Contact",
        accessibleName: "Contact",
        source: "rendered",
      }],
    })).toThrow();
  });

  it("normalizes legacy visual evidence field names", () => {
    const parsed = VisualEvidenceReferenceSchema.parse({
      screenshotId: "shot-1",
      pageUrl: "https://example.com/",
      viewport: "desktop",
      viewportWidth: 1440,
      viewportHeight: 900,
      region: { left: 0, top: 0, width: 300, height: 200 },
    });
    expect(parsed.visibleRegion).toEqual({ left: 0, top: 0, width: 300, height: 200 });
    expect(parsed.width).toBe(1440);
  });
});
