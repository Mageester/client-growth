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
    for (const link of parsed.sameOriginLinks) {
      expect(link.startsWith("https://coolbreezehvac.example/")).toBe(true);
    }
    expect(parsed.sameOriginLinks).toContain("https://coolbreezehvac.example/contact");
    expect(parsed.sameOriginLinks.some((l) => l.includes("facebook.com"))).toBe(false);
    expect(parsed.sameOriginLinks.some((l) => l.includes("#"))).toBe(false);
  });

  it("drops script and style content from the text excerpt", () => {
    const parsed = parseHtml(loadRawHtml("home.html"), BASE);
    expect(parsed.page.textExcerpt).not.toContain("analytics noise");
    expect(parsed.page.textExcerpt).not.toContain("color: #003");
    expect(parsed.page.wordCount).toBeGreaterThan(0);
  });
});
