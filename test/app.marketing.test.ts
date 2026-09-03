import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  MarketingFooter,
  MarketingHeader,
} from "../app/components/marketing-layout";

function renderMarketing(node: ReactNode) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ["/"] }, node),
  );
}

describe("Axiom Orbit marketing shell", () => {
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
});
