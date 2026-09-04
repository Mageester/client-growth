import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OfferingGuidance } from "../app/components/offering-guidance";

function render(props: Parameters<typeof OfferingGuidance>[0]): string {
  return renderToStaticMarkup(createElement(OfferingGuidance, props));
}

describe("offering guidance", () => {
  it("explains that an empty list is allowed but cannot support a service-page claim", () => {
    const html = render({ raw: "" });

    expect(html).toContain("No offerings are listed yet");
    expect(html).toContain("can still be saved");
    expect(html).toContain("heat pump installation");
    expect(html).toContain("air conditioning repair");
    expect(html).toContain("duct cleaning");
  });

  it("warns immediately when only one offering is present", () => {
    const html = render({ raw: "heat pump installation" });

    expect(html).toContain("One offering is listed");
    expect(html).toContain("at least two concrete offerings");
  });

  it("keeps vague entries and explains the consequence without changing them", () => {
    const html = render({ offerings: ["fully insured", "heat pump installation"] });

    expect(html).toContain("fully insured");
    expect(html).toContain("claim about the business");
    expect(html).toContain("Nothing is changed automatically");
  });
});
