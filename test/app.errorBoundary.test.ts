import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { ErrorPage, errorPageView } from "../app/components/error-page";
import { meta as rootMeta } from "../app/root";

/**
 * React Router's own 404. An unmatched URL produces this shape, and its `data`
 * reaches the boundary as the framework's internal message — reproduced here
 * verbatim from a production build so the regression cannot be argued about.
 */
const routeNotFound = {
  status: 404,
  statusText: "Not Found",
  internal: true,
  data: 'Error: No route matches URL "/orbit-audit-missing-page"',
};

const serverError = {
  status: 500,
  statusText: "Internal Server Error",
  internal: true,
  data: "Unexpected Server Error",
};

function render(error: unknown, signedIn: boolean) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/orbit-audit-missing-page"] },
      createElement(ErrorPage, { error, signedIn }),
    ),
  );
}

describe("branded root error boundary", () => {
  it("names a missing page in the document title and the first heading", () => {
    const view = errorPageView(routeNotFound, false);

    expect(view.title).toBe("Page not found · Axiom Orbit");
    expect(view.heading).toBe("Page not found");
  });

  it("distinguishes an unexpected failure from a missing page", () => {
    const view = errorPageView(serverError, false);

    expect(view.title).toBe("Something went wrong · Axiom Orbit");
    expect(view.heading).toBe("Something went wrong");
  });

  it("never shows the framework exception, a thrown message, or a stack", () => {
    const thrown = new Error("D1_ERROR: no such table: opportunities");
    thrown.stack = "Error: D1_ERROR\n    at secretModule (/app/lib/d1.server.ts:12:3)";

    for (const error of [routeNotFound, serverError, thrown, undefined, "boom"]) {
      const view = errorPageView(error, false);
      const text = `${view.title} ${view.heading} ${view.message}`;

      expect(text).not.toMatch(/No route matches URL/);
      expect(text).not.toMatch(/Unexpected Server Error/);
      expect(text).not.toMatch(/D1_ERROR|no such table|d1\.server/);
      expect(text).not.toMatch(/\bat \w+ \(/);
      expect(view.message.length).toBeGreaterThan(0);
    }
  });

  it("offers a public destination to everyone and the queue only to signed-in staff", () => {
    const signedOut = errorPageView(routeNotFound, false);
    const signedIn = errorPageView(routeNotFound, true);

    expect(signedOut.actions.map((action) => action.to)).toEqual(["/", "/login"]);
    expect(signedIn.actions.map((action) => action.to)).toEqual(["/", "/opportunities"]);
    // The audit's defect: a signed-out visitor was sent to a protected route,
    // which silently redirected them to /login from a page that said 404.
    for (const action of signedOut.actions) {
      expect(action.to).not.toBe("/opportunities");
    }
  });

  it("renders exactly one top-level heading and no lower heading above it", () => {
    const html = render(routeNotFound, false);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(">Page not found</h1>");
    expect(html).not.toContain("<h2");
  });

  it("renders the recovery actions as real links", () => {
    const signedOut = render(routeNotFound, false);
    const signedIn = render(routeNotFound, true);

    expect(signedOut).toContain('href="/"');
    expect(signedOut).toContain('href="/login"');
    expect(signedOut).not.toContain('href="/opportunities"');
    expect(signedIn).toContain('href="/opportunities"');
  });

  it("gives the document a title through the root route's own metadata", () => {
    expect(rootMeta({ error: routeNotFound } as never)).toEqual([
      { title: "Page not found · Axiom Orbit" },
    ]);
    expect(rootMeta({ error: serverError } as never)).toEqual([
      { title: "Something went wrong · Axiom Orbit" },
    ]);
    // No error means no root-level title, so every route keeps the metadata it
    // already publishes.
    expect(rootMeta({} as never)).toEqual([]);
  });
});
