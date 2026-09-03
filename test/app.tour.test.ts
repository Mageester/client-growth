import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { TOUR_STEPS } from "../app/components/tour";
import { AppNavigation } from "../app/root";
import { RULE_SERVICE_LINKS } from "@/core/rules/registry";

const navHtml = () =>
  renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ["/opportunities"] }, createElement(AppNavigation)),
  );

describe("product tour", () => {
  it("points every highlighted step at a destination the nav actually has", () => {
    // A renamed route would otherwise leave the step silently highlighting
    // nothing, which looks like a broken tour rather than a broken link.
    const html = navHtml();
    const highlighted = TOUR_STEPS.filter((step) => step.highlight);

    expect(highlighted.length).toBeGreaterThan(0);
    for (const step of highlighted) {
      expect(html).toContain(`href="${step.highlight}"`);
    }
  });

  it("explains the honesty guarantee, which is the whole reason to trust an empty feed", () => {
    const prose = TOUR_STEPS.flatMap((step) => [step.title, ...step.body])
      .join(" ")
      .toLowerCase();

    expect(prose).toContain("clean");
    expect(prose).toContain("inconclusive");
    expect(prose).toContain("evidence");
  });

  it("covers each screen the product actually has", () => {
    const highlights = TOUR_STEPS.map((step) => step.highlight).filter(Boolean);
    expect(highlights).toEqual(
      expect.arrayContaining(["/opportunities", "/clients", "/services"]),
    );
  });

  it("does not promise a number of rules that can fall behind the registry", () => {
    // "two kinds of gap" was left in onboarding copy when a third rule landed.
    const prose = TOUR_STEPS.flatMap((step) => step.body).join(" ");
    expect(prose).not.toMatch(/\b(one|two|three|four) kinds? of (gap|finding)\b/i);
    expect(RULE_SERVICE_LINKS.length).toBeGreaterThan(0);
  });

  it("gives every step a title and something to read", () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
      for (const paragraph of step.body) expect(paragraph.length).toBeGreaterThan(40);
    }
  });
});
