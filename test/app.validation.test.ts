import { describe, expect, it } from "vitest";

import {
  MAX_OFFERINGS,
  normalizeDomain,
  offeringWarnings,
  parseOfferings,
  validateClientInput,
  validateServiceInput,
} from "../app/lib/validation";

describe("domain normalization", () => {
  it("strips scheme, path, query, port-less noise and trailing dots", () => {
    expect(normalizeDomain("https://Example.COM/services?x=1")).toBe("example.com");
    expect(normalizeDomain("http://example.com/")).toBe("example.com");
    expect(normalizeDomain("  example.com.  ")).toBe("example.com");
    expect(normalizeDomain("example.com#top")).toBe("example.com");
  });

  it("drops embedded credentials rather than treating them as the host", () => {
    expect(normalizeDomain("https://user:pass@evil.example/path")).toBe("evil.example");
  });

  it("returns empty for empty input", () => {
    expect(normalizeDomain("   ")).toBe("");
  });
});

describe("client validation", () => {
  const base = { name: "Acme", domain: "acme.example", offerings: "roofing\nsiding" };

  it("accepts a well-formed client", () => {
    expect(validateClientInput(base)).toBeNull();
  });

  it("requires a name and a domain", () => {
    expect(validateClientInput({ ...base, name: "  " })).toMatch(/name/i);
    expect(validateClientInput({ ...base, domain: "" })).toMatch(/website/i);
  });

  it("rejects things that are not hostnames", () => {
    expect(validateClientInput({ ...base, domain: "not a domain" })).toMatch(/website address/i);
    expect(validateClientInput({ ...base, domain: "localhost" })).toMatch(/website address/i);
    expect(validateClientInput({ ...base, domain: "-bad.example" })).toMatch(/website address/i);
  });

  it("accepts a URL pasted with its scheme, since that is what people do", () => {
    expect(validateClientInput({ ...base, domain: "https://sub.acme.co.uk/services" })).toBeNull();
  });

  it("caps the offering list and the length of each line", () => {
    const many = Array.from({ length: MAX_OFFERINGS + 1 }, (_, i) => "svc" + i).join("\n");
    expect(validateClientInput({ ...base, offerings: many })).toMatch(/up to/i);
    expect(validateClientInput({ ...base, offerings: "x".repeat(200) })).toMatch(/short/i);
  });

  it("allows a client with no offerings, since one can be added later", () => {
    expect(validateClientInput({ ...base, offerings: "" })).toBeNull();
  });
});

describe("service validation", () => {
  const base = { name: "Landing Page", priceMin: 900, priceMax: 1800, description: "" };

  it("accepts a well-formed service", () => {
    expect(validateServiceInput(base)).toBeNull();
  });

  it("accepts a single fixed price", () => {
    expect(validateServiceInput({ ...base, priceMin: 500, priceMax: 500 })).toBeNull();
  });

  it("rejects an inverted range", () => {
    expect(validateServiceInput({ ...base, priceMin: 1800, priceMax: 900 })).toMatch(/top of the range/i);
  });

  it("rejects negative and non-numeric prices", () => {
    expect(validateServiceInput({ ...base, priceMin: -1 })).toMatch(/negative/i);
    expect(validateServiceInput({ ...base, priceMax: Number.NaN })).toMatch(/numbers/i);
  });

  it("rejects an implausible price rather than storing a typo", () => {
    expect(validateServiceInput({ ...base, priceMax: 99_000_000 })).toMatch(/typo/i);
  });

  it("requires a name and caps the description", () => {
    expect(validateServiceInput({ ...base, name: " " })).toMatch(/name/i);
    expect(validateServiceInput({ ...base, description: "x".repeat(700) })).toMatch(/600/);
  });
});

/**
 * The offerings box is the highest-leverage free-text field in the product:
 * every line in it is checked against the site, and a gap becomes a priced
 * recommendation. These are the entries that must never quietly become a quote.
 */
describe("offering quality warnings", () => {
  it.each([
    "fully insured",
    "Licensed Technicians",
    "family owned business",
    "award winning practice",
    "24 years experience",
    "DBS checked staff",
  ])("flags the trust signal %j", (entry) => {
    expect(offeringWarnings([entry])).toEqual([{ value: entry, kind: "trust signal" }]);
  });

  it.each([
    "free quotes",
    "free consultation",
    "financing",
    "satisfaction guarantee",
    "12 month workmanship warranty",
    "no obligation",
    "20% off first service",
  ])("flags the promotion %j", (entry) => {
    expect(offeringWarnings([entry])).toEqual([{ value: entry, kind: "promotion" }]);
  });

  it.each([
    "quality workmanship",
    "fast response times",
    "affordable pricing",
    "friendly professional team",
    "customer satisfaction",
  ])("flags the generic claim %j", (entry) => {
    expect(offeringWarnings([entry])).toEqual([{ value: entry, kind: "generic claim" }]);
  });

  it.each([
    "heat pump installation",
    "ev charger installation",
    "commercial kitchen deep cleaning",
    "invisalign",
    "gas safety certificates",
    "emergency plumber",
    "free standing bath installation",
    "dealership vehicle servicing",
    "insurance claim roof repairs",
    "carpet cleaning",
  ])("leaves the real service %j alone", (entry) => {
    // A warning on genuine work would train agencies to ignore the warning, so
    // the phrase list stays small and specific rather than clever.
    expect(offeringWarnings([entry])).toEqual([]);
  });

  it("reports every flagged entry and touches none of them", () => {
    const typed = ["ev charger installation", "fully insured", "free quotes"];
    const warnings = offeringWarnings(typed);

    expect(warnings).toEqual([
      { value: "fully insured", kind: "trust signal" },
      { value: "free quotes", kind: "promotion" },
    ]);
    // Advisory only: nothing is rewritten, reordered or dropped.
    expect(typed).toEqual(["ev charger installation", "fully insured", "free quotes"]);
    expect(validateClientInput({ name: "X", domain: "x.com", offerings: typed.join("\n") })).toBeNull();
  });

  it("splits a textarea the way a browser actually submits one", () => {
    expect(parseOfferings(["boiler repair", "", "  drain cleaning  ", ""].join("\r\n"))).toEqual([
      "boiler repair",
      "drain cleaning",
    ]);
  });
});
