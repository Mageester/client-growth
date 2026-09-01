import { describe, expect, it } from "vitest";

import { describeEvidenceRef, formatEvidenceRef } from "@/core/evidenceRef";

describe("evidence reference presentation", () => {
  it("splits a tagged URL ref into a label and a linkable URL", () => {
    expect(describeEvidenceRef("page:https://x.example/contact")).toEqual({
      label: "Page",
      value: "https://x.example/contact",
      href: "https://x.example/contact",
    });
  });

  it("never offers a non-URL ref as a link", () => {
    expect(describeEvidenceRef("status:404")).toEqual({
      label: "HTTP status",
      value: "404",
      href: null,
    });
    expect(describeEvidenceRef("element:tel:XXX-XXX-XXXX")).toEqual({
      label: "Element",
      value: "tel:XXX-XXX-XXXX",
      href: null,
    });
  });

  it("passes an untagged URL through as a link", () => {
    expect(describeEvidenceRef("https://x.example/")).toEqual({
      label: null,
      value: "https://x.example/",
      href: "https://x.example/",
    });
  });

  it("does not mistake an unknown prefix for a tag", () => {
    expect(describeEvidenceRef("mailto:hi@x.example").label).toBeNull();
  });

  it("formats a readable line for a proposal draft", () => {
    expect(formatEvidenceRef("target:https://x.example/quote")).toBe(
      "Link target: https://x.example/quote",
    );
    expect(formatEvidenceRef("https://x.example/")).toBe("https://x.example/");
  });
});
