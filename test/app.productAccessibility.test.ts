import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const marketingCss = readFileSync(new URL("../app/styles/marketing.css", import.meta.url), "utf8");
const appCss = readFileSync(new URL("../app/styles/app.css", import.meta.url), "utf8");

/**
 * Every `rem` on the public pages resolves against this, not against the
 * browser default. `0.54rem` is 8.1px here and 8.6px at 16px, which is the
 * difference between reproducing the audit's measurement and guessing at it —
 * so the assumption is pinned rather than assumed.
 */
const ROOT_FONT_PX = 15;

type Rule = { selector: string; declarations: string };

/** A flat rule list. Selectors inside `@media` blocks are kept, the query is not. */
function rules(css: string): Rule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: Rule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutComments))) {
    const selector = match[1]!.trim();
    if (selector.startsWith("@")) continue;
    found.push({ selector, declarations: match[2]! });
  }
  return found;
}

function declaration(rule: Rule, property: string): string | null {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i").exec(rule.declarations);
  return match ? match[1]!.replace(/!important/i, "").trim() : null;
}

function channel(value: number): number {
  const ratio = value / 255;
  return ratio <= 0.03928 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((part) => part + part)
          .join("")
      : value;
  const [r, g, b] = [0, 2, 4].map((index) => channel(parseInt(full.slice(index, index + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** `--token: #hex` definitions, wherever they are declared. */
function tokens(css: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, name, hex] of css.matchAll(/(--[a-z-]+)\s*:\s*(#[0-9a-f]{3,8})\s*;/gi)) {
    map.set(name!, hex!.toLowerCase());
  }
  return map;
}

const productRules = rules(marketingCss).filter((rule) => rule.selector.includes(".marketing-product"));
const productTokens = tokens(marketingCss);

/** The three grounds any product text can sit on. */
const PRODUCT_SURFACES = ["--marketing-background", "--product-surface", "--product-raised"] as const;

/**
 * Colour used as decoration rather than as text: a generated glyph, and a
 * chevron the markup already hides from assistive technology. WCAG 1.4.3 is
 * about text, and holding these to 4.5:1 would brighten ornament while
 * teaching the suite nothing.
 */
const DECORATIVE_SELECTORS = new Set([".marketing-product-review-chevron"]);

function isDecorative(selector: string): boolean {
  return (
    selector.includes("::before") ||
    selector.includes("::after") ||
    selector
      .split(",")
      .every((part) => DECORATIVE_SELECTORS.has(part.trim()))
  );
}

describe("the product page's own assumptions", () => {
  it("still sizes rem against a 15px root", () => {
    expect(appCss).toMatch(/html,\s*body\s*\{[^}]*font-size:\s*15px/s);
  });

  it("declares every product surface and the tokens drawn on them", () => {
    for (const surface of PRODUCT_SURFACES) expect(productTokens.get(surface)).toBeTruthy();
    expect(productRules.length).toBeGreaterThan(40);
  });
});

describe("normal informational text on /product reaches WCAG AA", () => {
  it("keeps every text colour at 4.5:1 or better on all three product surfaces", () => {
    const failures: string[] = [];

    for (const rule of productRules) {
      const color = declaration(rule, "color");
      if (!color || isDecorative(rule.selector)) continue;
      const token = /var\((--[a-z-]+)\)/i.exec(color)?.[1];
      const hex = token ? productTokens.get(token) : /^#[0-9a-f]{3,8}$/i.test(color) ? color : null;
      if (!hex) continue;

      for (const surface of PRODUCT_SURFACES) {
        const ratio = contrast(hex, productTokens.get(surface)!);
        if (ratio < 4.5) {
          failures.push(
            `${rule.selector} — ${token ?? hex} (${hex}) on ${surface} is ${ratio.toFixed(2)}:1`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps the dimmest text token visibly dimmer than the muted one", () => {
    // The fix must not flatten the hierarchy into one grey. Both clear AA; the
    // subtle token stays the quieter of the two.
    const subtle = contrast(productTokens.get("--product-subtle")!, productTokens.get("--product-raised")!);
    const muted = contrast(productTokens.get("--product-muted")!, productTokens.get("--product-raised")!);

    expect(subtle).toBeGreaterThanOrEqual(4.5);
    expect(subtle).toBeLessThan(muted);
  });
});

describe("product example text stays readable when it reflows", () => {
  it("never renders meaningful copy below 12px at any width", () => {
    const tooSmall: string[] = [];

    for (const rule of productRules) {
      // `font:` packs the size in with everything else, which is exactly where a
      // sub-12px value hides from a `font-size:` search.
      const fontSize = declaration(rule, "font-size") ?? declaration(rule, "font");
      if (!fontSize) continue;
      // A clamp's smallest term is what a narrow viewport actually gets.
      const rems = [...fontSize.matchAll(/([\d.]+)rem/g)].map((match) => Number(match[1]));
      const pixels = [...fontSize.matchAll(/([\d.]+)px/g)].map((match) => Number(match[1]));
      const smallest = Math.min(
        ...rems.map((rem) => rem * ROOT_FONT_PX),
        ...(pixels.length > 0 ? pixels : [Infinity]),
      );
      if (Number.isFinite(smallest) && smallest < 12) {
        tooSmall.push(`${rule.selector} — ${fontSize} resolves to ${smallest.toFixed(1)}px`);
      }
    }

    expect(tooSmall).toEqual([]);
  });

  it("names one example type scale rather than sprinkling sizes", () => {
    const scale = /\.marketing-product\s*\{([^}]*)\}/s.exec(marketingCss)?.[1] ?? "";
    const size = (name: string) =>
      Number(new RegExp(`${name}:\\s*([\\d.]+)rem`).exec(scale)?.[1] ?? 0) * ROOT_FONT_PX;

    // Labels hold the 12px floor; supporting copy aims at the 14px target.
    expect(size("--product-example-label")).toBeGreaterThanOrEqual(12);
    expect(size("--product-example-copy")).toBeGreaterThanOrEqual(14);
  });
});

describe("mobile touch targets on the signed-out surfaces", () => {
  const appRules = rules(appCss);

  function target(selector: string): Rule {
    const rule = appRules.find((candidate) => candidate.selector === selector);
    expect(rule, `expected a rule for ${selector}`).toBeTruthy();
    return rule!;
  }

  it("gives the shared topbar sign-in link a 44px target", () => {
    const rule = target(".public-nav > a:not(.btn)");

    expect(declaration(rule, "min-height")).toBe("44px");
    expect(declaration(rule, "display")).toMatch(/inline-flex/);
  });

  it("gives the password-recovery link a 44px target", () => {
    const rule = target(".auth-aside .link");

    expect(declaration(rule, "min-height")).toBe("44px");
    expect(declaration(rule, "display")).toMatch(/inline-flex/);
  });

  it("keeps the standalone parent-brand credit above the 24px minimum", () => {
    const rule = target(".axiom-credit");
    const minHeight = Number((declaration(rule, "min-height") ?? "0").replace("px", ""));

    expect(minHeight).toBeGreaterThanOrEqual(24);
  });
});
