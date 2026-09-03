import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  MarketingFooter,
  MarketingHeader,
} from "../app/components/marketing-layout";
import Landing, { meta as landingMeta } from "../app/routes/_index";

function renderMarketing(node: ReactNode) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ["/"] }, node),
  );
}

function renderLanding() {
  return renderMarketing(createElement(Landing));
}

describe("Axiom Orbit marketing shell", () => {
  it("renders the ordered public Orbit showcase with truthful CTAs", () => {
    const html = renderLanding();

    expect(html).toContain("Grow the clients you’ve already won.");
    expect(html).toContain("The work is already in your accounts.");
    expect(html).toContain("Client portfolio");
    expect(html).toMatch(/Evidence before action/i);
    expect(html).toMatch(/What Orbit watches/i);
    expect(html).toMatch(/Continuous monitoring/i);
    expect(html).toContain("Review");
    expect(html).toContain("Qualify");
    expect(html).toContain("Price");
    expect(html).toContain("Prepare");
    expect(html).toContain("Available now");
    expect(html).toContain("Direction");
    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/product"');
    expect(html).toContain('href="/login"');
    expect(html).toContain("Illustrative product view");
    expect(html).toContain("Illustrative data — not customer proof.");

    const sectionOrder = [
      "The work is already in your accounts.",
      "A review loop for the clients you already serve.",
      "Start with what the site actually returned.",
      "Know which account signals are worth reviewing.",
      "Review the portfolio again—on purpose.",
      "Evidence in. Conversation out.",
      "Build more value from the relationships already on your books.",
      "Give every client account a next review.",
    ];
    let previous = -1;
    for (const text of sectionOrder) {
      const current = html.indexOf(text);
      expect(current, `missing or misplaced section: ${text}`).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it("publishes route-specific canonical and social metadata", () => {
    const metadata = landingMeta();

    expect(metadata).toEqual(
      expect.arrayContaining([
        { title: "Axiom Orbit — Grow the clients you’ve already won." },
        { name: "description", content: expect.stringContaining("client sites") },
        { tagName: "link", rel: "canonical", href: "https://orbit.getaxiom.ca/" },
        {
          property: "og:image",
          content: "https://orbit.getaxiom.ca/brand/axiom-orbit-social-1200x630.png",
        },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: expect.stringContaining("Axiom Orbit") },
        { name: "twitter:description", content: expect.stringContaining("client sites") },
      ]),
    );
  });

  it("keeps the showcase free from fabricated proof and hype", () => {
    const html = renderLanding();

    expect(html).not.toMatch(
      /trusted by|case stud(?:y|ies)|testimonials?|revenue generated|\bROI\b|\d+%|10x|unlock hidden revenue|nothing gets missed|real-time monitoring|always-on monitoring/i,
    );
  });

  it("registers the public product route", () => {
    const source = readFileSync(new URL("../app/routes.ts", import.meta.url), "utf8");

    expect(source).toContain('route("product", "routes/product.tsx")');
  });

  it("provides crawlable product, pilot, and sign-in destinations", () => {
    const html = renderMarketing(createElement(MarketingHeader));

    expect(html).toContain('href="/product"');
    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/login"');
    expect(html).toContain("Request access");
    expect(html).toContain("Sign in");
  });

  it("keeps the restrained footer free from fabricated proof", () => {
    const html = renderMarketing(createElement(MarketingFooter));

    expect(html).toContain("An Axiom product");
    expect(html).not.toMatch(/trusted by|case stud(?:y|ies)|customers|revenue generated|\d+%/i);
  });

  it("keeps the parent-brand link at a comfortable touch target", () => {
    const html = renderMarketing(createElement(MarketingFooter));
    const css = readFileSync(new URL("../app/styles/marketing.css", import.meta.url), "utf8");

    expect(html).toContain('class="marketing-footer-parent-link"');
    expect(css).toMatch(
      /\.marketing-footer-parent-link\s*\{[^}]*min-height:\s*40px/s,
    );
  });

  it("does not expose the app loading indicator on marketing routes", () => {
    const source = readFileSync(new URL("../app/root.tsx", import.meta.url), "utf8");

    expect(source).toContain(
      '{busy && !isMarketingRoute && <div className="nav-progress" key={location.key} />}',
    );
  });

  it("uses restrained fluid type for the shell controls", () => {
    const css = readFileSync(new URL("../app/styles/marketing.css", import.meta.url), "utf8");

    expect(css).toMatch(
      /\.marketing-desktop-nav,\s*\.marketing-footer-nav\s*\{[^}]*font-size:\s*clamp\(/s,
    );
    expect(css).toMatch(/\.marketing-button\s*\{[^}]*font-size:\s*clamp\(/s);
    expect(css).toMatch(/\.marketing-footer-credit\s*\{[^}]*font-size:\s*clamp\(/s);
  });
});
