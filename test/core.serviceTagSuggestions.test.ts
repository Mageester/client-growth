import { describe, expect, it } from "vitest";

import {
  suggestServiceTags,
  updateServiceTagSelection,
} from "@/core/serviceTagSuggestions";

describe("service tag suggestions", () => {
  it("maps clear page and metadata language to the matching catalog gaps", () => {
    const suggestions = suggestServiceTags({
      name: "SEO titles and meta descriptions",
      description: "Repair missing page title tags and write missing meta descriptions.",
    });

    expect(suggestions.map((suggestion) => suggestion.tag)).toEqual([
      "missing-title",
      "missing-meta-description",
    ]);
    expect(suggestions.map((suggestion) => suggestion.label)).toEqual([
      "Repair a missing page title",
      "Repair a missing meta description",
    ]);
    expect(suggestions.every((suggestion) => suggestion.reason.length > 0)).toBe(true);
  });

  it("recognizes conversion work without guessing an unrelated SEO service", () => {
    const tags = suggestServiceTags({
      name: "Contact form and phone link repair",
      description: "Fix broken calls to action so visitors can contact the business.",
    }).map((suggestion) => suggestion.tag);

    expect(tags).toEqual(["conversion-fix"]);
  });

  it("keeps multiple service pages distinct from one missing page", () => {
    expect(
      suggestServiceTags({
        name: "Service pages build",
        description: "Create multiple service pages with clear internal navigation.",
      }).map((suggestion) => suggestion.tag),
    ).toEqual(["service-pages-build"]);

    expect(
      suggestServiceTags({
        name: "Service page design",
        description: "Build a consistent page set for service offerings.",
      }).map((suggestion) => suggestion.tag),
    ).toEqual(["service-pages-build"]);

    expect(
      suggestServiceTags({
        name: "Landing page",
        description: "Build one focused page for a service line.",
      }).map((suggestion) => suggestion.tag),
    ).toEqual(["landing-page"]);
  });

  it("returns no match for broad or unrelated marketing language", () => {
    expect(
      suggestServiceTags({
        name: "Social media management",
        description: "Grow the brand with regular posts and campaign planning.",
      }),
    ).toEqual([]);
    expect(
      suggestServiceTags({
        name: "SEO audit",
        description: "A general review of website performance and visibility.",
      }),
    ).toEqual([]);
  });

  it("does not confuse link building with repairing a broken internal link", () => {
    expect(
      suggestServiceTags({
        name: "Link building",
        description: "Earn backlinks through outreach.",
      }),
    ).toEqual([]);
  });

  it("preserves the other proposed mappings on the first override", () => {
    expect(
      updateServiceTagSelection({
        selectedTags: [],
        proposedTags: ["missing-title", "missing-meta-description"],
        manual: false,
        tag: "missing-title",
        checked: false,
      }),
    ).toEqual(["missing-meta-description"]);
  });
});
