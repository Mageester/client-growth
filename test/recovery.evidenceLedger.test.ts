import { describe, expect, it } from "vitest";
import { buildEvidenceLedger, resolveLegacyEvidenceRefs, sanitizeEvidenceUrl } from "@/core/evidenceLedger";

const bundle = {
  clientId: "client-1",
  source: "fixture" as const,
  capturedAt: "2026-09-19T00:00:00.000Z",
  site: {
    pages: [{
      url: "https://example.com/",
      status: 200,
      title: "Example",
      h1s: ["Welcome"],
      headings: ["Welcome"],
      textExcerpt: "A readable homepage.",
      wordCount: 100,
      forms: [{ action: "/contact", method: "POST" as const, hasSubmit: true }],
      images: [{ src: "/hero.jpg" }],
    }],
    nav: ["Services"],
    links: [{
      href: "/contact",
      label: "Contact",
      scheme: "http" as const,
      ariaLabel: "",
      title: "",
      inNav: true,
      inServiceNav: false,
      foundOn: ["https://example.com/"],
    }],
    sitemapUrls: [],
    crawlExhaustive: true,
  },
  networkEvents: [],
};

describe("recovered evidence ledger", () => {
  it("creates stable typed rows and resolves legacy aliases", () => {
    const ledger = buildEvidenceLedger({ runId: "run-1", bundle });
    expect(ledger.length).toBeGreaterThanOrEqual(4);
    expect(ledger.every((entry) => entry.runId === "run-1")).toBe(true);
    const resolved = resolveLegacyEvidenceRefs(ledger, ["page:https://example.com/", "title:missing", "form:https://example.com/#0"]);
    expect(resolved.ids.length).toBeGreaterThanOrEqual(1);
    expect(resolved.unresolved).toContain("title:missing");
  });

  it("redacts credentials before URLs enter evidence", () => {
    expect(sanitizeEvidenceUrl("https://example.com/?access_token=secret&next=https%3A%2F%2Fupstream.test%2F%3Ftoken%3Dabc")).toContain("[redacted]");
    expect(sanitizeEvidenceUrl("https://user:pass@example.com/")).toBe("https://example.com/");
  });
});
