import { describe, expect, it } from "vitest";

import { describeEvidenceRef, parseEvidenceRef } from "@/core/evidenceRef";
import { generateProposalDraft } from "@/core/proposal";
import { buildEvidenceCase } from "../app/lib/evidence";
import { ClientSchema, OpportunitySchema, ServiceSchema } from "@/core/schema";

/**
 * Evidence refs are stored tagged (`page:`, `status:`, `element:`) because the
 * tag is what makes the value meaningful. Anything that shows one to a human has
 * to read the tag first — rendering the raw string produced `href="status:404"`
 * in the evidence panel and lines like `- status:404` in a draft the agency was
 * expected to put in front of their client.
 */

const CLIENT = ClientSchema.parse({
  id: "c1",
  name: "Meridian Dental",
  domain: "meridiandental.test",
  offerings: ["dental implants", "invisalign"],
});

const SERVICE = ServiceSchema.parse({
  id: "svc-conversion-fix",
  name: "Conversion-path repair",
  description: "Repair a broken conversion element and re-test the path.",
  priceMin: 300,
  priceMax: 1000,
  tags: ["conversion-fix"],
});

function conversionOpportunity(refs: string[]) {
  return OpportunitySchema.parse({
    id: "opp1",
    dedupeKey: "broken-conversion-path__x__deadbeef",
    clientId: "c1",
    ruleId: "broken-conversion-path",
    title: 'Broken "Book an appointment" link',
    detected: "The booking button links to a page that returns HTTP 404.",
    evidenceRefs: refs,
    rationale: "Every affected visit is a lost enquiry until it is fixed.",
    suggestedServiceId: "svc-conversion-fix",
    suggestedScope: ["Repair the dead call-to-action link"],
    conversionDefect: {
      kind: "dead-conversion-link",
      pageUrl: "https://meridiandental.test/",
      elementText: "Book an appointment",
      elementHref: "https://meridiandental.test/book-online",
      target: "https://meridiandental.test/book-online",
      observedStatus: 404,
      seenOn: ["https://meridiandental.test/"],
      note: "the booking button links to an address that returns HTTP 404",
    },
    priceMin: 300,
    priceMax: 1000,
    confidence: 0.9,
    billableStatus: "billable",
    status: "new",
    updatedAt: "2026-09-02T00:00:00.000Z",
  });
}

const REFS = [
  "page:https://meridiandental.test/",
  "page:https://meridiandental.test/dental-implants",
  "element:https://meridiandental.test/book-online",
  "target:https://meridiandental.test/book-online",
  "status:404",
];

describe("evidence ref parsing", () => {
  it("reads the tag rather than treating the whole ref as a URL", () => {
    expect(parseEvidenceRef("page:https://a.example/x")).toEqual({
      kind: "page",
      value: "https://a.example/x",
      url: "https://a.example/x",
    });
    expect(parseEvidenceRef("status:404")).toEqual({ kind: "status", value: "404", url: null });
  });

  it("keeps a value that itself contains a colon intact", () => {
    // The proof for a malformed click-to-call link IS its href, colon and all.
    expect(parseEvidenceRef("element:tel:call us today")).toEqual({
      kind: "element",
      value: "tel:call us today",
      url: null,
    });
  });

  it("treats an untagged URL as a page, as the missing-service-page rule emits", () => {
    const parsed = parseEvidenceRef("https://a.example/services");
    expect(parsed.kind).toBe("page");
    expect(parsed.url).toBe("https://a.example/services");
  });

  it("never offers a non-http value as a link", () => {
    for (const ref of ["status:404", "element:tel:0000", "nav:Services", "javascript:alert(1)"]) {
      expect(parseEvidenceRef(ref).url).toBeNull();
    }
  });

  it("describes each kind as a fact a client could read", () => {
    expect(describeEvidenceRef(parseEvidenceRef("status:404"))).toBe("Server response: HTTP 404");
    expect(describeEvidenceRef(parseEvidenceRef("element:tel:x"))).toBe("Broken element: tel:x");
  });

  it("describes deterministic observation metrics instead of leaking storage tokens", () => {
    expect(describeEvidenceRef(parseEvidenceRef("images-without-alt:4"))).toBe(
      "4 images without alt text",
    );
    expect(describeEvidenceRef(parseEvidenceRef("word-count:12"))).toBe("Observed word count: 12");
    expect(describeEvidenceRef(parseEvidenceRef("title:missing"))).toBe("No page title observed");
    expect(describeEvidenceRef(parseEvidenceRef("h1:missing"))).toBe("No H1 heading observed");
    expect(describeEvidenceRef(parseEvidenceRef("meta-description:missing"))).toBe(
      "No meta description observed",
    );
    expect(
      describeEvidenceRef(parseEvidenceRef("structured-data:localbusiness-or-service-missing")),
    ).toBe("No LocalBusiness or Service structured data observed");
  });

  it("describes competitor provenance without exposing its storage tag", () => {
    expect(describeEvidenceRef(parseEvidenceRef("competitor:competitor.example"))).toBe(
      "Competitor site: competitor.example",
    );
  });

  it("describes an external profile source without counting it as a crawled page", () => {
    const parsed = parseEvidenceRef("external:https://business.google.com/locations/123");
    expect(parsed).toEqual({
      kind: "external",
      value: "https://business.google.com/locations/123",
      url: "https://business.google.com/locations/123",
    });
    expect(describeEvidenceRef(parsed)).toMatch(/official business-profile source/i);
  });
});

describe("evidence panel", () => {
  it("links only real page URLs, never a tagged value", () => {
    const evidence = buildEvidenceCase(conversionOpportunity(REFS));
    for (const item of [...evidence.primary, ...evidence.secondary]) {
      if (item.url === null) continue;
      expect(item.url).toMatch(/^https?:\/\//);
    }
  });

  it("counts pages, not defect facts, in the pages-checked total", () => {
    const evidence = buildEvidenceCase(conversionOpportunity(REFS));
    // Two crawled pages. `element:`, `target:` and `status:` are the defect, and
    // the defect item already states them.
    expect(evidence.inspectedCount).toBe(2);
  });

  it("shows external provenance but keeps it out of the pages-checked total", () => {
    const evidence = buildEvidenceCase(
      conversionOpportunity([
        "external:https://business.google.com/locations/123",
        "page:https://meridiandental.test/",
      ]),
    );
    expect(evidence.primary.some((item) => item.kind === "external")).toBe(true);
    expect(evidence.inspectedCount).toBe(1);
    expect(evidence.headline).toMatch(/across 1 page/);
  });

  it("states the defect once instead of restating the mechanism three times", () => {
    const evidence = buildEvidenceCase(conversionOpportunity(REFS));
    const defect = evidence.primary.find((item) => item.kind === "defect");
    expect(defect).toBeDefined();
    expect(defect!.note).toContain("Anyone who clicks it never reaches the page.");
    // The status is already in the note; it must not be appended a second time.
    expect(defect!.note.match(/404/g)).toHaveLength(1);
  });
});

describe("proposal draft", () => {
  it("contains no raw internal ref tags", () => {
    const draft = generateProposalDraft({
      opportunity: conversionOpportunity(REFS),
      client: CLIENT,
      service: SERVICE,
    });
    for (const tag of ["- page:", "- status:", "- target:", "- element:", "- verified:"]) {
      expect(draft).not.toContain(tag);
    }
    expect(draft).toContain("- https://meridiandental.test/");
    expect(draft).toContain("Server response: HTTP 404");
  });

  it("renders an external source in proposal language", () => {
    const draft = generateProposalDraft({
      opportunity: conversionOpportunity([
        "external:https://business.google.com/locations/123",
        "page:https://meridiandental.test/",
      ]),
      client: CLIENT,
      service: SERVICE,
    });
    expect(draft).toContain("Official business-profile source: https://business.google.com/locations/123");
    expect(draft).not.toContain("- external:");
  });

  it("does not list the same address twice under two labels", () => {
    const draft = generateProposalDraft({
      opportunity: conversionOpportunity(REFS),
      client: CLIENT,
      service: SERVICE,
    });
    expect(draft).toContain("Broken element: https://meridiandental.test/book-online");
    expect(draft).not.toContain("Link target: https://meridiandental.test/book-online");
  });

  it("keeps a distinct link target when it differs from the element", () => {
    const draft = generateProposalDraft({
      opportunity: conversionOpportunity([
        "page:https://meridiandental.test/",
        "element:/book-online",
        "target:https://booking.example/meridian",
        "status:410",
      ]),
      client: CLIENT,
      service: SERVICE,
    });
    expect(draft).toContain("Broken element: /book-online");
    expect(draft).toContain("Link target: https://booking.example/meridian");
  });
});
