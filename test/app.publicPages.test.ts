import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import routes from "../app/routes";
import Privacy from "../app/routes/privacy";

const root = process.cwd();
const robots = readFileSync(join(root, "public", "robots.txt"), "utf8");
const sitemap = readFileSync(join(root, "public", "sitemap.xml"), "utf8");

/** Every path the route table serves, without its parameters. */
const routePaths = (routes as Array<{ path?: string }>)
  .map((entry) => entry.path)
  .filter((path): path is string => typeof path === "string");

describe("what the public internet is told about this app", () => {
  it("serves a privacy page and terms of service", () => {
    expect(routePaths).toContain("privacy");
    expect(routePaths).toContain("terms");
  });

  it("disallows every signed-in area and the private share links", () => {
    // A proposal share URL is a bearer token in a link. Indexing one would
    // publish a client's proposal to anyone who searched for it.
    for (const disallowed of [
      "/proposal/",
      "/opportunities",
      "/clients",
      "/settings",
      "/export/",
      "/internal/",
      "/invite/",
      "/reset-password",
    ]) {
      expect(robots, disallowed).toContain(`Disallow: ${disallowed}`);
    }
  });

  it("does not point at a sitemap that is not there", () => {
    const declared = robots.match(/^Sitemap:\s*(\S+)$/m)?.[1];
    expect(declared).toBe("https://orbit.getaxiom.ca/sitemap.xml");
    expect(sitemap).toContain("<urlset");
  });

  it("lists only pages that are genuinely public", () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      const path = new URL(loc).pathname.replace(/^\//, "");
      // "" is the index route; every other entry must be a declared public page.
      if (path === "") continue;
      expect(routePaths, loc).toContain(path);
      expect(robots).not.toContain(`Disallow: /${path}`);
    }
  });

  it("discloses conditional delivery and the complete evaluator data categories without provider guarantees", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(Privacy)),
    );

    expect(html).toContain("candidate evaluation");
    expect(html).toContain("9 September 2026");
    expect(html).toContain("rule and observed detection facts");
    expect(html).toContain("agency-entered offering names");
    expect(html).toContain("public-page URLs, titles, headings, and navigation labels");
    expect(html).toContain("verification conclusion and reason");
    expect(html).toContain("rejected nearby matches");
    expect(html).toContain("page on which it appeared");
    expect(html).toContain("element text, its link destination or form target");
    expect(html).toContain("observed HTTP result, related pages, and explanatory note");
    expect(html).toContain("Depending on the kind of review");
    expect(html).toContain("summary you provide");
    expect(html).toContain("bounded excerpts");
    expect(html).toContain("verification links, password resets, and team invitations");
    expect(html).toContain("When Resend is configured and a digest is actually sent");
    expect(html).toContain("monitoring-digest recipient and content");
    expect(html).toContain("provider’s own terms");
    expect(html).not.toContain("It does not receive page content, your notes, your catalog");
    expect(html).not.toContain("provider retention or training guarantees");
  });
});
