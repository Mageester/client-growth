import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

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
});

/**
 * The privacy page has to describe the software that exists.
 *
 * It said DeepSeek receives "only the client's business name, their website
 * domain, and the single subject being judged", and "does not receive page
 * content, your notes, your catalog". That was true of the evaluator and untrue
 * of the catalog assistant, which sends the agency's own written summary plus
 * the URL, title, headings and text excerpts of the agency's public pages to
 * the same provider. A visitor reading that paragraph would have been
 * misinformed about their own data, not a client's.
 *
 * So the inventory is per feature. Each entry names what that feature sends.
 */
describe("the privacy page inventories outbound data by feature", () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Privacy)));

  it("keeps the narrow evaluator claim scoped to candidate evaluation", () => {
    expect(html).toMatch(/candidate evaluation/i);
    expect(html).toContain("heat pump installation");
    // The old sentence claimed this for the provider as a whole.
    expect(html).not.toMatch(
      /does not receive page content, your notes, your catalog, your prices, or anything about you/i,
    );
  });

  it("discloses what the catalog assistant sends about the agency itself", () => {
    expect(html).toMatch(/catalog assistant/i);
    expect(html).toMatch(/summary you write|your written summary|the summary you provide/i);
    expect(html).toMatch(/headings/i);
    expect(html).toMatch(/excerpt/i);
  });

  it("lists account email and the monitoring digest separately", () => {
    expect(html).toMatch(/account email/i);
    expect(html).toMatch(/monitoring digest/i);
    expect(html).toMatch(/recipient/i);
  });

  it("makes no retention or training promise on the provider's behalf", () => {
    // We cannot observe another company's retention, so we do not assert it.
    expect(html).not.toMatch(/DeepSeek does not (?:retain|store|train)/i);
    expect(html).not.toMatch(/deleted (?:immediately|within \d+) by DeepSeek/i);
  });
});
