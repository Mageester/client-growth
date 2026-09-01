import { describe, expect, it } from "vitest";

import { buildEvidenceCase, hostOf, readableUrl, titleFromUrl } from "../app/lib/evidence";
import type { Opportunity } from "@/core/schema";

function opp(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "o1",
    dedupeKey: "k1",
    clientId: "c1",
    ruleId: "missing-service-page",
    title: "No page for heat pumps",
    detected: "detected",
    evidenceRefs: [],
    rationale: "why",
    suggestedServiceId: "s1",
    suggestedScope: [],
    priceMin: 900,
    priceMax: 1800,
    confidence: 0.8,
    billableStatus: "billable",
    status: "new",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

describe("URL readability", () => {
  it("shows the path, not the address", () => {
    expect(readableUrl("https://acme.example/services/heat-pumps")).toBe("/services/heat-pumps");
    expect(readableUrl("https://acme.example/")).toBe("acme.example");
  });

  it("turns a path into words a person can scan", () => {
    expect(titleFromUrl("https://acme.example/services/heat-pump-install")).toBe(
      "Services / Heat pump install",
    );
    expect(titleFromUrl("https://acme.example/about_us.html")).toBe("About us");
  });

  it("calls the origin the home page instead of repeating the host", () => {
    expect(titleFromUrl("https://acme.example/")).toBe("Home page");
    expect(titleFromUrl("https://acme.example")).toBe("Home page");
  });

  it("degrades gracefully on input that is not an http URL", () => {
    // Nav labels are handled separately and never reach this path, but a
    // readable fallback beats leaking a scheme into the interface.
    expect(titleFromUrl("nav:Services")).toBe("Services");
    expect(titleFromUrl("")).toBe("");
    expect(hostOf("not a url")).toBe("not a url");
  });
});

describe("evidence case", () => {
  it("leads with the concrete defect when there is one", () => {
    const result = buildEvidenceCase(
      opp({
        ruleId: "broken-conversion-path",
        conversionDefect: {
          kind: "dead-conversion-link",
          pageUrl: "https://acme.example/",
          elementText: "Book now",
          elementHref: "/book",
          target: "https://acme.example/book",
          observedStatus: 404,
          seenOn: ["https://acme.example/"],
          note: "",
        },
      }),
    );
    expect(result.primary[0]?.kind).toBe("defect");
    expect(result.primary[0]?.title).toContain("Book now");
    expect(result.primary[0]?.note).toContain("404");
    expect(result.headline).toContain("probed directly");
  });

  it("keeps the row compact and moves the rest behind a disclosure", () => {
    const refs = Array.from({ length: 9 }, (_, i) => `https://acme.example/p${i}`);
    const result = buildEvidenceCase(opp({ evidenceRefs: refs }));
    expect(result.primary).toHaveLength(4);
    expect(result.secondary.length).toBeGreaterThan(0);
    expect(result.primary.length + result.secondary.length).toBeGreaterThanOrEqual(9);
  });

  it("never repeats the same URL twice", () => {
    const result = buildEvidenceCase(
      opp({
        evidenceRefs: ["https://acme.example/a", "https://acme.example/a"],
        verification: {
          conclusion: "absent",
          inspectedUrls: ["https://acme.example/a"],
          closeMatches: [],
          reason: "",
        },
      }),
    );
    const urls = [...result.primary, ...result.secondary]
      .filter((item) => item.kind === "inspected")
      .map((item) => item.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("explains the near-misses that were ruled out", () => {
    const result = buildEvidenceCase(
      opp({
        verification: {
          conclusion: "absent",
          inspectedUrls: ["https://acme.example/services"],
          closeMatches: [
            {
              where: "heading",
              value: "Heating & cooling",
              url: "https://acme.example/services",
              score: 0.4,
              satisfied: false,
              reason: "covers furnaces, never heat pumps",
            },
          ],
          reason: "",
        },
      }),
    );
    const nearMiss = result.secondary.find((item) => item.kind === "near-miss");
    expect(nearMiss?.title).toBe("Heating & cooling");
    expect(nearMiss?.note).toContain("Heading on the site");
    expect(nearMiss?.note).toContain("never heat pumps");
    expect(result.headline).toContain("ruled out");
  });

  it("groups navigation labels into one readable statement, not one row each", () => {
    const result = buildEvidenceCase(
      opp({ evidenceRefs: ["nav:Services", "nav:About", "nav:Contact"] }),
    );
    const nav = [...result.primary, ...result.secondary].filter((item) => item.kind === "nav");
    expect(nav).toHaveLength(1);
    expect(nav[0]?.title).toBe("Services · About · Contact");
  });

  it("counts inspected pages without counting nav labels as pages", () => {
    const result = buildEvidenceCase(
      opp({ evidenceRefs: ["https://acme.example/a", "https://acme.example/b", "nav:Services"] }),
    );
    expect(result.inspectedCount).toBe(2);
    expect(result.headline).toContain("2 pages");
  });

  it("produces an empty, non-crashing case when nothing was recorded", () => {
    const result = buildEvidenceCase(opp());
    expect(result.primary).toHaveLength(0);
    expect(result.secondary).toHaveLength(0);
    expect(result.inspectedCount).toBe(0);
  });
});
