import { describe, expect, it } from "vitest";

import { parseHtml } from "@/adapters/evidence/parseHtml";
import { loadRawHtml } from "./helpers/fixtures";

const BASE = "https://coolbreezehvac.example/";

describe("parseHtml", () => {
  it("extracts title, h1s, and sub-headings without markup or entities", () => {
    const parsed = parseHtml(loadRawHtml("home.html"), BASE);
    expect(parsed.page.title).toBe("Cool Breeze HVAC | Heating & Cooling in Denver");
    expect(parsed.page.h1s).toEqual(["Denver's Trusted Heating & Cooling Team"]);
    expect(parsed.page.headings).toContain("Our Services");
    expect(parsed.page.headings).toContain("Financing Available");
  });

  it("extracts nav labels from the nav block", () => {
    const parsed = parseHtml(loadRawHtml("home.html"), BASE);
    expect(parsed.nav).toEqual([
      "Home",
      "Air Conditioning Repair",
      "Furnace Installation",
      "Duct Cleaning",
      "About",
      "Contact",
    ]);
  });

  it("keeps only same-origin links and strips fragments", () => {
    const parsed = parseHtml(loadRawHtml("home.html"), BASE);
    for (const link of parsed.sameSiteLinks) {
      expect(link.startsWith("https://coolbreezehvac.example/")).toBe(true);
    }
    expect(parsed.sameSiteLinks).toContain("https://coolbreezehvac.example/contact");
    expect(parsed.sameSiteLinks.some((l) => l.includes("facebook.com"))).toBe(false);
    expect(parsed.sameSiteLinks.some((l) => l.includes("#"))).toBe(false);
  });

  it("drops script and style content from the text excerpt", () => {
    const parsed = parseHtml(loadRawHtml("home.html"), BASE);
    expect(parsed.page.textExcerpt).not.toContain("analytics noise");
    expect(parsed.page.textExcerpt).not.toContain("color: #003");
    expect(parsed.page.wordCount).toBeGreaterThan(0);
  });

  it("captures tel:/mailto: links with scheme, and aria-label on links", () => {
    const html = `<!doctype html><html><body>
      <a href="tel:+1-555-867-5309">Call us</a>
      <a href="mailto:hi@x.example">Email</a>
      <a href="/quote" aria-label="Get a free quote" title="Quote">Start</a>
    </body></html>`;
    const parsed = parseHtml(html, "https://x.example/");

    const tel = parsed.links.find((l) => l.scheme === "tel");
    expect(tel?.href).toBe("tel:+1-555-867-5309");
    expect(tel?.label).toBe("Call us");
    expect(parsed.links.some((l) => l.scheme === "mailto")).toBe(true);

    const quote = parsed.links.find((l) => l.href.endsWith("/quote"));
    expect(quote?.ariaLabel).toBe("Get a free quote");
    expect(quote?.title).toBe("Quote");
    expect(parsed.sameSiteLinks).toEqual(["https://x.example/quote"]); // http only
  });

  it("captures <form> action, method and whether it has a submit control", () => {
    const html = `<!doctype html><html><body>
      <form action="/contact/submit" method="post">
        <input type="text" name="name" />
        <button type="submit">Send</button>
      </form>
      <form action="/search"><input type="search" /></form>
      <form><button>Go</button></form>
    </body></html>`;
    const parsed = parseHtml(html, "https://x.example/");

    expect(parsed.page.forms).toHaveLength(3);
    expect(parsed.page.forms[0]).toEqual({ action: "/contact/submit", method: "POST", hasSubmit: true });
    expect(parsed.page.forms[1]).toEqual({ action: "/search", method: "GET", hasSubmit: false });
    // a bare <button> inside a form defaults to type=submit
    expect(parsed.page.forms[2]).toEqual({ action: "", method: "GET", hasSubmit: true });
  });
});
