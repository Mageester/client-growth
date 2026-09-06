import { describe, expect, it } from "vitest";

import { isUsableJobValue, jobsToPayback, paybackSentence } from "@/core/clientValue";

describe("what a finding is worth to the client", () => {
  it("says nothing at all when the agency has not recorded a job value", () => {
    // Silence is the correct answer. Inventing a default would be exactly the
    // confident-sounding guess this product refuses to make.
    for (const value of [undefined, 0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        jobsToPayback({ priceMin: 900, priceMax: 1800, averageJobValue: value as number }),
        String(value),
      ).toBeNull();
    }
    expect(paybackSentence(null)).toBeNull();
  });

  it("counts whole jobs, because half a job pays no invoice", () => {
    expect(jobsToPayback({ priceMin: 900, priceMax: 1800, averageJobValue: 4000 })).toEqual({
      min: 1,
      max: 1,
    });
    expect(jobsToPayback({ priceMin: 900, priceMax: 1800, averageJobValue: 800 })).toEqual({
      min: 2,
      max: 3,
    });
  });

  it("never claims a job value covers work for free", () => {
    const range = jobsToPayback({ priceMin: 1, priceMax: 1, averageJobValue: 1_000_000 });
    expect(range).toEqual({ min: 1, max: 1 });
  });

  it("reads as a sentence someone could say on a call", () => {
    expect(
      paybackSentence(jobsToPayback({ priceMin: 900, priceMax: 1800, averageJobValue: 4000 })),
    ).toBe("Pays for itself with one job.");
    expect(
      paybackSentence(jobsToPayback({ priceMin: 900, priceMax: 1800, averageJobValue: 800 })),
    ).toBe("Pays for itself with 2\u20133 jobs.");
    expect(
      paybackSentence(jobsToPayback({ priceMin: 1200, priceMax: 1600, averageJobValue: 800 })),
    ).toBe("Pays for itself with 2 jobs.");
  });

  it("tolerates a price range recorded the wrong way round", () => {
    expect(jobsToPayback({ priceMin: 1800, priceMax: 900, averageJobValue: 800 })).toEqual({
      min: 2,
      max: 3,
    });
  });

  it("refuses a finding with no price at all", () => {
    expect(jobsToPayback({ priceMin: 0, priceMax: 0, averageJobValue: 4000 })).toBeNull();
  });

  it("recognises a usable job value", () => {
    expect(isUsableJobValue(4000)).toBe(true);
    expect(isUsableJobValue(0)).toBe(false);
    expect(isUsableJobValue(undefined)).toBe(false);
  });
});
