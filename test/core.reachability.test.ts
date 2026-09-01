import { describe, expect, it } from "vitest";

import { assessReachability } from "@/core/reachability";
import { EvidenceBundleSchema, type EvidenceBundle } from "@/core/schema";

function bundle(partial: {
  pages?: Array<{ url: string; status: number }>;
  networkEvents?: EvidenceBundle["networkEvents"];
}): EvidenceBundle {
  return EvidenceBundleSchema.parse({
    clientId: "c1",
    source: "http",
    capturedAt: new Date().toISOString(),
    site: { pages: partial.pages ?? [], nav: [], links: [], sitemapUrls: [] },
    networkEvents: partial.networkEvents ?? [],
  });
}

describe("site reachability", () => {
  it("reports a healthy crawl as reached", () => {
    const r = assessReachability(
      bundle({ pages: [{ url: "https://a.example/", status: 200 }] }),
    );
    expect(r.reached).toBe(true);
    expect(r.pagesOk).toBe(1);
  });

  it("does NOT report a policy-blocked domain as reached", () => {
    const r = assessReachability(
      bundle({
        networkEvents: [
          { url: "[unparseable URL]", outcome: "blocked", reason: "URL could not be parsed" },
        ],
      }),
    );
    expect(r.reached).toBe(false);
    expect(r.blocked).toBe(1);
    expect(r.reason).toContain("Check the client's website domain");
  });

  it("does NOT report an unreachable host as reached", () => {
    const r = assessReachability(
      bundle({
        networkEvents: [
          { url: "https://gone.example/", outcome: "inconclusive", reason: "network request failed" },
        ],
      }),
    );
    expect(r.reached).toBe(false);
    expect(r.inconclusive).toBe(1);
    expect(r.reason).toContain("could not be reached");
  });

  it("does NOT treat an all-error crawl as reached", () => {
    const r = assessReachability(
      bundle({ pages: [{ url: "https://a.example/", status: 503 }] }),
    );
    expect(r.reached).toBe(false);
    expect(r.pagesSeen).toBe(1);
    expect(r.pagesOk).toBe(0);
  });
});
