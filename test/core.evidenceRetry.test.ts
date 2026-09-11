import { describe, expect, it } from "vitest";

import {
  canRetryEvidenceRead,
  describeFailedRead,
  summarizeEvidenceFailure,
} from "@/core/evidenceDiagnostics";
import { EvidenceBundleSchema } from "@/core/schema";

/** `code` is optional on a network event; without one the reason is inferred. */
function failed(reason: string, code?: string) {
  return EvidenceBundleSchema.parse({
    clientId: "client-a",
    source: "http",
    capturedAt: "2026-09-10T00:00:00.000Z",
    site: { pages: [], nav: [], links: [], sitemapUrls: [] },
    networkEvents: [
      {
        url: "https://velvetnailsandbeautylounge.example/",
        outcome: "inconclusive",
        reason,
        ...(code ? { code } : {}),
        stage: "page",
      },
    ],
  });
}

const robots = summarizeEvidenceFailure(
  failed("robots.txt disallows this path", "robots"),
);
const timeout = summarizeEvidenceFailure(failed("request timeout", "timeout"));

describe("offering another read only when another read could change something", () => {
  it("does not offer a retry for a failure the engine already calls permanent", () => {
    // A site's robots.txt does not change because somebody pressed a button.
    // Offering the retry produced the same sentence a second time, which reads
    // as "nothing happened" — the defect observed on a live client page.
    expect(robots.retryable).toBe(false);
    expect(canRetryEvidenceRead(robots)).toBe(false);

    const policy = summarizeEvidenceFailure(failed("destination scheme not allowed", "policy"));
    expect(canRetryEvidenceRead(policy)).toBe(false);

    const shell = summarizeEvidenceFailure(
      failed("page appears to be a client-rendered JavaScript shell", "js-shell"),
    );
    expect(canRetryEvidenceRead(shell)).toBe(false);
  });

  it("still offers a retry when the site might simply have been unavailable", () => {
    expect(timeout.retryable).toBe(true);
    expect(canRetryEvidenceRead(timeout)).toBe(true);
    // No known failure is not a permanent failure. Callers legitimately hold
    // this absent, and reading it as "never retry" would hide the button that
    // is the only way forward for a client that has never been read.
    expect(canRetryEvidenceRead(null)).toBe(true);
    expect(canRetryEvidenceRead(undefined)).toBe(true);
  });

  it("tells the agency what would actually change a permanent failure", () => {
    // A dead end is only acceptable if it names the way out.
    expect(robots.resolution).toBeTruthy();
    expect(robots.resolution).toMatch(/robots\.txt/i);
    expect(robots.resolution).toMatch(/AxiomOrbitBot|site's owner|allow/i);

    // A retryable failure needs no separate resolution; the button is the way out.
    expect(timeout.resolution).toBeUndefined();
  });
});

describe("reporting a read that reached nothing", () => {
  it("says what this attempt did instead of repeating the standing diagnostic", () => {
    const message = describeFailedRead(robots);

    // The detail paragraph is already on the page above this message. Echoing
    // it verbatim is what put the same sentence on screen twice.
    expect(message).not.toContain(robots.detail);
    expect(message).toContain(robots.title);
    expect(message).toMatch(/no pages/i);
  });

  it("falls back to a plain explanation when the failure is unrecognised", () => {
    expect(describeFailedRead(null)).toMatch(/no page on this site could be read/i);

    const unknown = summarizeEvidenceFailure(failed("something unclassified"));
    expect(describeFailedRead(unknown)).toMatch(/no page on this site could be read/i);
  });
});
