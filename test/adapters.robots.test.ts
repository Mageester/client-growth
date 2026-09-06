import { describe, expect, it } from "vitest";

import { isAllowed, policyFor, robotsPath } from "@/adapters/evidence/robots";

const UA = "AxiomOrbitBot/1.0 (+https://getaxiom.ca/bot)";
const allows = (text: string, path: string) => isAllowed(policyFor(text, UA), path);

describe("reading robots.txt", () => {
  it("allows everything when the file is empty or has no groups", () => {
    for (const text of ["", "   ", "# just a comment\n", "Sitemap: /sitemap.xml\n"]) {
      expect(allows(text, "/services/heat-pumps"), JSON.stringify(text)).toBe(true);
    }
  });

  it("obeys a wildcard group", () => {
    const text = "User-agent: *\nDisallow: /admin/\n";
    expect(allows(text, "/admin/settings")).toBe(false);
    expect(allows(text, "/services/heat-pumps")).toBe(true);
  });

  it("treats an empty Disallow as no restriction at all", () => {
    expect(allows("User-agent: *\nDisallow:\n", "/anything")).toBe(true);
  });

  it("lets the longest matching rule win, and Allow win a tie", () => {
    const text = "User-agent: *\nDisallow: /\nAllow: /services/\n";
    expect(allows(text, "/services/heat-pumps")).toBe(true);
    expect(allows(text, "/about")).toBe(false);

    const tie = "User-agent: *\nDisallow: /page\nAllow: /page\n";
    expect(allows(tie, "/page")).toBe(true);
  });

  it("uses the group naming this crawler and ignores the wildcard group entirely", () => {
    // Even when the specific group is more permissive: an operator who names
    // this crawler has said something deliberate about it.
    const text = ["User-agent: *", "Disallow: /", "", "User-agent: AxiomOrbitBot", "Disallow: /private/"].join("\n");
    expect(allows(text, "/services/heat-pumps")).toBe(true);
    expect(allows(text, "/private/x")).toBe(false);
  });

  it("matches the user agent case-insensitively on the product token only", () => {
    const text = "User-agent: axiomorbitbot\nDisallow: /nope\n";
    expect(allows(text, "/nope")).toBe(false);
  });

  it("does not treat a different named crawler's group as ours", () => {
    const text = ["User-agent: GPTBot", "Disallow: /", "", "User-agent: *", "Disallow: /admin"].join("\n");
    expect(allows(text, "/services")).toBe(true);
    expect(allows(text, "/admin")).toBe(false);
  });

  it("groups consecutive user-agent lines together", () => {
    const text = ["User-agent: SomeBot", "User-agent: AxiomOrbitBot", "Disallow: /shared", ""].join("\n");
    expect(allows(text, "/shared")).toBe(false);
  });

  it("supports * wildcards and the $ end anchor", () => {
    expect(allows("User-agent: *\nDisallow: /*.pdf$\n", "/files/report.pdf")).toBe(false);
    expect(allows("User-agent: *\nDisallow: /*.pdf$\n", "/files/report.pdf?v=2")).toBe(true);
    expect(allows("User-agent: *\nDisallow: /private/*/secret\n", "/private/a/secret")).toBe(false);
    expect(allows("User-agent: *\nDisallow: /exact$\n", "/exact")).toBe(false);
    expect(allows("User-agent: *\nDisallow: /exact$\n", "/exact/more")).toBe(true);
  });

  it("ignores comments, blank lines and fields it does not understand", () => {
    const text = [
      "# leading comment",
      "Sitemap: https://example.com/sitemap.xml",
      "User-agent: *   # trailing",
      "Crawl-delay: 10",
      "Disallow: /admin  # why",
      "not-a-field-line",
    ].join("\n");
    expect(allows(text, "/admin")).toBe(false);
    expect(allows(text, "/services")).toBe(true);
  });

  it("matches rules against the path and query together", () => {
    const url = new URL("https://example.com/search?q=heat+pumps");
    expect(robotsPath(url)).toBe("/search?q=heat+pumps");
    expect(allows("User-agent: *\nDisallow: /*?\n", robotsPath(url))).toBe(false);
  });
});
