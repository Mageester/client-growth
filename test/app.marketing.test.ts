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
import Product, { meta as productMeta } from "../app/routes/product";

function renderMarketing(node: ReactNode) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ["/"] }, node),
  );
}

function renderLanding() {
  return renderMarketing(createElement(Landing));
}

function renderProduct() {
  return renderMarketing(createElement(Product));
}

describe("Axiom Orbit marketing shell", () => {
  it("renders the ordered public Orbit showcase with truthful CTAs", () => {
    const html = renderLanding();

    expect(html).toContain("Grow the clients you’ve already won.");
    expect(html).toContain("The work is already in your accounts.");
    expect(html).toMatch(/How it works/i);
    expect(html).toMatch(/Straight answers/i);
    expect(html).toMatch(/For your agency/i);
    expect(html).toContain("Watch");
    expect(html).toContain("Find");
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
      "Watch, find, prepare.",
      "Straight answers. No invented wins.",
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

  it("keeps the hero product fragment out of the page heading hierarchy", () => {
    const html = renderLanding();
    const firstPageHeading = html.indexOf("<h2");

    expect(firstPageHeading).toBeGreaterThan(-1);
    expect(html.slice(0, firstPageHeading)).not.toContain("<h3");
  });

  it("uses a genuinely compact hero evidence fragment", () => {
    const html = renderLanding();
    const compactCard = html.match(
      /<article class="marketing-evidence-card marketing-evidence-card--compact"[\s\S]*?<\/article>/,
    )?.[0];

    expect(compactCard).toBeDefined();
    expect(compactCard).toContain("Northstar HVAC");
    expect(compactCard).toContain("Checked source paths");
    expect(compactCard).not.toContain("marketing-evidence-case");
    expect(compactCard).not.toContain("What was found");
  });

  it("draws the Watch / Find / Prepare steps in order with a decorative line", () => {
    const html = renderLanding();
    const css = readFileSync(new URL("../app/styles/marketing.css", import.meta.url), "utf8");

    expect(html).toContain('class="marketing-steps-line" aria-hidden="true"');
    expect(html).toContain("marketing-steps-line-fill");
    const watch = html.indexOf(">Watch<");
    const find = html.indexOf(">Find<");
    const prepare = html.indexOf(">Prepare<");
    expect(watch).toBeGreaterThan(-1);
    expect(find).toBeGreaterThan(watch);
    expect(prepare).toBeGreaterThan(find);
    expect(css).toMatch(
      /\.marketing-motion \.marketing-steps\.is-revealed \.marketing-steps-line-fill/s,
    );
    expect(css).toMatch(/--step-index/);
  });

  it("keeps reveal motion opt-in and reduced-motion safe", () => {
    const html = renderLanding();
    const css = readFileSync(new URL("../app/styles/marketing.css", import.meta.url), "utf8");
    const layout = readFileSync(
      new URL("../app/components/marketing-layout.tsx", import.meta.url),
      "utf8",
    );

    expect(html).toContain("data-reveal");
    expect(css).toMatch(/\.marketing-motion \[data-reveal\]/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.marketing-motion \[data-reveal\]/s,
    );
    expect(layout).toContain("prefers-reduced-motion");
    expect(layout).toContain("IntersectionObserver");
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

  it("sends signed-in users into the app instead of the showcase", () => {
    const root = readFileSync(new URL("../app/root.tsx", import.meta.url), "utf8");
    const login = readFileSync(new URL("../app/routes/login.tsx", import.meta.url), "utf8");
    const signup = readFileSync(new URL("../app/routes/signup.tsx", import.meta.url), "utf8");

    expect(root).toContain('redirect("/opportunities")');
    expect(root).toMatch(/if \(error instanceof Response\) throw error;/);
    expect(login.match(/redirect\("\/opportunities"/g)?.length).toBe(2);
    expect(signup).toContain('redirect("/opportunities")');
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

  it("scopes generic document metadata away from marketing routes", () => {
    const source = readFileSync(new URL("../app/root.tsx", import.meta.url), "utf8");
    const genericMetadataBlock = source.match(
      /\{!isMarketingRoute\s*&&\s*\(\s*<>[\s\S]*?<\/>\s*\)\}/,
    )?.[0];

    expect(genericMetadataBlock).toBeDefined();
    for (const marker of [
      'property="og:description"',
      'property="og:image"',
      'name="twitter:card"',
      'name="description"',
    ]) {
      expect(genericMetadataBlock).toContain(marker);
      expect(source.match(new RegExp(marker, "g"))).toHaveLength(1);
    }
    expect(source).toContain('property="og:site_name"');
    expect(source).toContain('property="og:type"');
  });
});

describe("Axiom Orbit public product detail", () => {
  it("has one ordered product story with the five public chapters", () => {
    const html = renderProduct();

    expect(html).toContain("Grow the clients you’ve already won.");
    for (const chapter of ["monitor", "understand", "find", "act", "grow"]) {
      expect(html).toContain(`id=\"${chapter}\"`);
    }
    expect(html.indexOf('id="monitor"')).toBeLessThan(html.indexOf('id="understand"'));
    expect(html.indexOf('id="understand"')).toBeLessThan(html.indexOf('id="find"'));
    expect(html.indexOf('id="find"')).toBeLessThan(html.indexOf('id="act"'));
    expect(html.indexOf('id="act"')).toBeLessThan(html.indexOf('id="grow"'));
  });

  it("keeps availability language adjacent to each chapter", () => {
    const html = renderProduct();

    expect(html).toContain("Available now · opt-in, per-client weekly monitoring");
    expect(html).toContain("Available now · bounded public-site evidence");
    expect(html).toContain("Available now · three detection categories");
    expect(html).toContain("Available now · review + proposal draft");
    expect(html).toContain("Direction · revenue and outcome tracking");
  });

  it("offers truthful product and pilot destinations", () => {
    const html = renderProduct();

    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="#monitor"');
    expect(html).toContain("See how it works");
    expect(html).toContain("Request access");
  });

  it("names the bounded workflow without fabricated proof or hype", () => {
    const html = renderProduct();

    expect(html).toContain("Not a CRM. Not a generic scanner.");
    expect(html).toContain("focused post-sale growth workflow");
    expect(html).toContain("Missing service page");
    expect(html).toContain("No service pages only when the read supports it");
    expect(html).toContain("Broken conversion path");
    expect(html).toContain("Nothing is sent");
    expect(html).not.toMatch(
      /trusted by|case stud(?:y|ies)|testimonials?|revenue generated|\bROI\b|\d+%|10x|unlock hidden revenue|nothing gets missed|real-time monitoring|always-on monitoring/i,
    );
  });

  it("publishes a route-specific absolute product metadata set", () => {
    const metadata = productMeta();

    expect(metadata).toEqual(
      expect.arrayContaining([
        { title: "Axiom Orbit Product — Grow the clients you’ve already won." },
        { name: "description", content: expect.stringContaining("client sites") },
        { tagName: "link", rel: "canonical", href: "https://orbit.getaxiom.ca/product" },
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
});
