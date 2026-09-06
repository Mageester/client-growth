/**
 * What a piece of work is worth to the CLIENT, expressed only as arithmetic on
 * numbers the agency itself recorded.
 *
 * The gap this closes: every finding already carries a price, but that price is
 * what the AGENCY charges. It tells the agency what to invoice and gives them
 * nothing to say on the phone. "Missing service page, $900-$1,800" is an
 * invoice line. "This costs less than one job" is a reason to call.
 *
 * Why it is arithmetic and not an estimate: this product's whole claim is that
 * it refuses to guess. A modelled "estimated annual value: $12,400" would be
 * exactly the kind of confident-sounding number the judgment layer was built to
 * keep out — and the calibration run that deleted model confidence scores is
 * the precedent. So there is no market model, no traffic estimate and no
 * multiplier here. There is one number the agency types in, one division, and a
 * sentence that is true by construction. When the agency has not recorded a job
 * value, the answer is nothing at all rather than a default.
 */

/** A client's typical job value is optional and, when present, must be real money. */
export function isUsableJobValue(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export interface PaybackRange {
  /** Jobs needed to cover the cheapest quote for the work. */
  min: number;
  /** Jobs needed to cover the dearest quote. */
  max: number;
}

/**
 * How many of the client's own jobs this work costs, rounded up: a partial job
 * does not pay an invoice.
 */
export function jobsToPayback(input: {
  priceMin: number;
  priceMax: number;
  averageJobValue: number | undefined;
}): PaybackRange | null {
  if (!isUsableJobValue(input.averageJobValue)) return null;
  const { priceMin, priceMax, averageJobValue } = input;
  if (!Number.isFinite(priceMin) || !Number.isFinite(priceMax)) return null;
  if (priceMin < 0 || priceMax < 0) return null;
  if (priceMax === 0 && priceMin === 0) return null;

  return {
    min: Math.max(1, Math.ceil(Math.min(priceMin, priceMax) / averageJobValue)),
    max: Math.max(1, Math.ceil(Math.max(priceMin, priceMax) / averageJobValue)),
  };
}

/**
 * The sentence an agency owner can read out on a call, or null when they have
 * not given us the number it is built from.
 */
export function paybackSentence(range: PaybackRange | null): string | null {
  if (!range) return null;
  if (range.max === 1) return "Pays for itself with one job.";
  if (range.min === range.max) return `Pays for itself with ${range.min} jobs.`;
  return `Pays for itself with ${range.min}\u2013${range.max} jobs.`;
}

/**
 * Parse the job value an agency typed into a form.
 *
 * Blank means "not recorded", which is a valid and common answer — most
 * agencies will not know this for every client, and pretending otherwise would
 * push them to invent one. Anything else must be real money or it is rejected,
 * because a wrong number here silently propagates into every payback line.
 */
export type JobValueInput =
  | { ok: true; value: number | undefined }
  | { ok: false; error: string };

export function parseJobValue(raw: string): JobValueInput {
  const trimmed = raw.trim().replace(/^[£$€]\s*/, "").replace(/,/g, "");
  if (trimmed === "") return { ok: true, value: undefined };

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: "Enter the typical job value as a number, or leave it blank." };
  }
  if (parsed <= 0) {
    return { ok: false, error: "A typical job value has to be more than zero." };
  }
  if (parsed > 10_000_000) {
    return { ok: false, error: "That job value looks too large. Enter one typical job, not a year." };
  }
  return { ok: true, value: Math.round(parsed * 100) / 100 };
}
