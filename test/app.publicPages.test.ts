import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import routes from "../app/routes";

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
