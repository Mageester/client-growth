import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  UnavailableDocument,
  unavailableDocumentTitle,
} from "../app/components/unavailable-document";
import * as proposalShare from "../app/routes/proposal.share";
import * as reportShare from "../app/routes/report.share";

function render(kind: "proposal" | "report") {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [`/${kind}/share`] },
      createElement(UnavailableDocument, { kind }),
    ),
  );
}

const expired = new Response("This proposal link has expired or is no longer available.", {
  status: 404,
});

describe("unavailable shared document", () => {
  it("names the document in its title and its first heading", () => {
    expect(unavailableDocumentTitle("proposal")).toBe("Proposal unavailable · Axiom Orbit");
    expect(unavailableDocumentTitle("report")).toBe("Report unavailable · Axiom Orbit");

    const proposal = render("proposal");
    expect(proposal.match(/<h1\b/g)).toHaveLength(1);
    expect(proposal).toContain("This proposal link is no longer available");
    expect(proposal).not.toContain("<h2");

    const report = render("report");
    expect(report.match(/<h1\b/g)).toHaveLength(1);
    expect(report).toContain("This report link is no longer available");
  });

  it("identifies the product so a real proposal does not look like a broken link", () => {
    for (const kind of ["proposal", "report"] as const) {
      const html = render(kind);

      expect(html).toContain('aria-label="Axiom Orbit"');
      expect(html).toContain("brand-lockup");
    }
  });

  it("tells the recipient what to do next and offers one safe destination", () => {
    for (const kind of ["proposal", "report"] as const) {
      const html = render(kind);

      expect(html).toMatch(/expired/i);
      expect(html).toMatch(/ask the agency/i);
      // One non-sensitive fallback, and nothing that points a recipient at the
      // agency's own signed-in product.
      expect(html).toContain('href="/"');
      expect(html).not.toContain('href="/login"');
      expect(html).not.toContain('href="/opportunities"');
      expect(html).not.toContain('href="/signup"');
    }
  });

  it("reveals nothing about the token, the agency, or the client", () => {
    for (const kind of ["proposal", "report"] as const) {
      const html = render(kind);

      expect(html).not.toMatch(/token/i);
      expect(html).not.toMatch(/revoked by/i);
    }
  });

  it("keeps both share routes owning their own failure state", () => {
    for (const route of [proposalShare, reportShare]) {
      expect(typeof route.ErrorBoundary).toBe("function");
      // The no-store/noindex contract is what keeps a client-facing failure out
      // of caches and search results; it has to survive the error path too.
      const headers = route.headers();
      expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow");
      expect(headers["Cache-Control"]).toBe("no-store, private");
    }
  });

  it("does not paint the report's pale ground under a card that has no report", () => {
    const approved = readFileSync(new URL("../app/styles/orbit-approved.css", import.meta.url), "utf8");
    const signalDesk = readFileSync(new URL("../app/styles/signal-desk.css", import.meta.url), "utf8");

    // root.tsx adds client-report-share-content for every /report/share request,
    // success or failure, so the light report theme has to depend on a report
    // actually being on the page. Without this the heading was dark on dark.
    expect(approved).toContain(
      ".content.client-report-share-content:has(.client-report-public-page) {",
    );
    expect(approved).not.toMatch(/^\.content\.client-report-share-content\s*\{/m);
    // And the card states its own ink rather than inheriting whatever ground it
    // happens to land on.
    expect(signalDesk).toMatch(/\.document-unavailable h1\s*\{[^}]*color:\s*var\(--ink\)/s);
  });

  it("publishes the descriptive title from each route's own metadata", () => {
    expect(proposalShare.meta({ error: expired } as never)).toEqual([
      { title: "Proposal unavailable · Axiom Orbit" },
    ]);
    expect(reportShare.meta({ error: expired } as never)).toEqual([
      { title: "Report unavailable · Axiom Orbit" },
    ]);
  });

  it("leaves a delivered document's own title untouched", () => {
    const proposal = proposalShare.meta({
      data: { snapshot: { clientName: "Northstar HVAC", agencyName: "Cedar Studio" } },
    } as never);
    expect(proposal).toEqual([{ title: "Northstar HVAC proposal · Cedar Studio" }]);

    const report = reportShare.meta({
      data: { snapshot: { client: { name: "Northstar HVAC" }, agency: { name: "Cedar Studio" } } },
    } as never);
    expect(report).toEqual([{ title: "Northstar HVAC report · Cedar Studio" }]);
  });
});
