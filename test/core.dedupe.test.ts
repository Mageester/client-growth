import { describe, expect, it } from "vitest";

import { dedupeKey } from "@/core/dedupe";

describe("dedupeKey", () => {
  it("is stable for the same inputs", () => {
    const a = dedupeKey("client-coolbreeze", "missing-service-page", "heat pump installation");
    const b = dedupeKey("client-coolbreeze", "missing-service-page", "heat pump installation");
    expect(a).toBe(b);
  });

  it("is insensitive to case and surrounding punctuation in the subject", () => {
    const a = dedupeKey("c1", "missing-service-page", "Heat Pump Installation");
    const b = dedupeKey("c1", "missing-service-page", "  heat-pump   installation!");
    expect(a).toBe(b);
  });

  it("differs across clients, rules, and subjects", () => {
    const base = dedupeKey("c1", "missing-service-page", "heat pump installation");
    expect(base).not.toBe(dedupeKey("c2", "missing-service-page", "heat pump installation"));
    expect(base).not.toBe(dedupeKey("c1", "missing-service-page", "furnace installation"));
  });

  it("uses one explicit site-level identity for every technical repair", () => {
    expect(dedupeKey("c1", "missing-image-alt", "https://site.example/")).toBe(
      "technical::c1::missing-image-alt",
    );
    expect(dedupeKey("c1", "missing-image-alt", "https://site.example/about")).toBe(
      "technical::c1::missing-image-alt",
    );
  });
});
