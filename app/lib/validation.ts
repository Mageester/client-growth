/**
 * Form validation shared by the create and edit paths.
 *
 * Both paths must agree, or a client can be created in a shape the edit form
 * refuses to save. The messages are written for an agency owner, not a
 * developer: they say what to do, not which constraint failed.
 */

/** Strip scheme, credentials, trailing slash and path noise down to a hostname. */
export function normalizeDomain(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const withoutCredentials = withoutScheme.replace(/^[^@/]*@/, "");
  const host = withoutCredentials.split(/[/?#]/, 1)[0] ?? "";
  return host.replace(/\.+$/, "");
}

/**
 * Hostname shape only. Deliberately not a reachability or safety check — the
 * crawler's URL policy is the security boundary and it runs at request time
 * against the real address. This just stops obvious typos reaching it.
 */
const HOSTNAME = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export const MAX_NAME_LENGTH = 120;
export const MAX_OFFERINGS = 40;

export interface ClientInput {
  name: string;
  domain: string;
  offerings: string;
}

export function validateClientInput(input: ClientInput): string | null {
  const name = input.name.trim();
  if (!name) return "Give this client a name.";
  if (name.length > MAX_NAME_LENGTH) {
    return `Client names are limited to ${MAX_NAME_LENGTH} characters.`;
  }

  const domain = normalizeDomain(input.domain);
  if (!domain) return "Enter the client's website.";
  if (domain.length > 253) return "That website address is too long to be a real domain.";
  if (!HOSTNAME.test(domain)) {
    return `"${input.domain.trim()}" does not look like a website address. Try something like example.com.`;
  }

  const offerings = input.offerings
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (offerings.length > MAX_OFFERINGS) {
    return `List up to ${MAX_OFFERINGS} offerings. Group the rest — the analysis works best on the main service lines.`;
  }
  if (offerings.some((line) => line.length > MAX_NAME_LENGTH)) {
    return "Keep each offering short — a service name, not a sentence.";
  }
  return null;
}

/**
 * Entries that are almost certainly not services.
 *
 * The offerings box is free text, and what goes in it is priced: every entry is
 * checked against the site and a genuine gap becomes a landing-page quote. So
 * "fully insured" typed into this box is how a client ends up being pitched a
 * $900-$1,800 page for a claim about their insurance.
 *
 * This is a deliberately SMALL phrase list, not a taxonomy of industries. It
 * only catches the marketing furniture agencies actually paste in - credentials,
 * offers and filler - and it never edits or drops what was typed. It warns; the
 * agency decides. The evaluator is the layer that judges genuinely borderline
 * subjects; this one just stops the obvious cases early, for free.
 */
const NON_SERVICE_PATTERNS: Array<{ kind: OfferingWarning["kind"]; test: RegExp }> = [
  // Credentials and reassurances the business states about itself.
  { kind: "trust signal", test: /\b(fully\s+)?insured\b/ },
  { kind: "trust signal", test: /\b(fully\s+)?licen[cs]ed\b/ },
  { kind: "trust signal", test: /\b(certified|accredited|approved installer)\b/ },
  { kind: "trust signal", test: /\bfamily[\s-](owned|run|business)\b/ },
  { kind: "trust signal", test: /\baward[\s-]winning\b/ },
  { kind: "trust signal", test: /\b\d+\+?\s*years?\b[\s\S]*\bexperience\b/ },
  { kind: "trust signal", test: /\bexperienced\s+(team|staff|engineers?|technicians?)\b/ },
  { kind: "trust signal", test: /\b((dbs|crb)\s*checked|vetted|police\s*checked)\b/ },
  { kind: "trust signal", test: /\b(gas\s*safe|niceic|checkatrade|trustmark)\b/ },

  // Offers and commercial mechanics.
  { kind: "promotion", test: /\bfree\s+(quotes?|quotation|consultations?|estimates?|surveys?|advice|call[\s-]?outs?)\b/ },
  { kind: "promotion", test: /\bno\s+(obligation|call[\s-]?out\s+fee|hidden\s+(costs?|fees?))\b/ },
  { kind: "promotion", test: /\b(financing|finance available|pay\s+monthly)\b|\b0%\s*(apr|interest)\b/ },
  { kind: "promotion", test: /\b(satisfaction\s+)?guarantee[ds]?\b|\bwarrant(y|ies)\b/ },
  { kind: "promotion", test: /\bdiscounts?\b|\b\d+%\s*off\b|\bspecial offers?\b/ },

  // Claims that name no specific work.
  { kind: "generic claim", test: /\bquality\s+(service|work|workmanship)\b|\bhigh[\s-]quality\b/ },
  { kind: "generic claim", test: /\b(fast|quick|rapid|same[\s-]day)\s+(response|turnaround|service)\b/ },
  { kind: "generic claim", test: /\b(affordable|cheap)\b|\bcompetitive\s+(prices?|pricing|rates?)\b|\bbest\s+prices?\b/ },
  { kind: "generic claim", test: /\b(friendly|reliable|professional|trusted)\s+(service|team|staff)\b/ },
  { kind: "generic claim", test: /\bcustomer\s+(satisfaction|service)\b|\b5[\s-]star\b/ },
];

export interface OfferingWarning {
  /** The line exactly as the agency typed it. Never rewritten. */
  value: string;
  kind: "trust signal" | "promotion" | "generic claim";
}

/**
 * Flag entries that look like marketing copy rather than work customers buy.
 *
 * Advisory only: it returns what to say, changes nothing, and blocks no save.
 */
export function offeringWarnings(offerings: string[]): OfferingWarning[] {
  const warnings: OfferingWarning[] = [];
  for (const raw of offerings) {
    const value = raw.trim();
    if (!value) continue;
    const lower = value.toLowerCase();
    const hit = NON_SERVICE_PATTERNS.find((p) => p.test.test(lower));
    if (hit) warnings.push({ value, kind: hit.kind });
  }
  return warnings;
}

/** Split a textarea's contents into trimmed, non-empty offering lines. */
export function parseOfferings(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export const MAX_PRICE = 10_000_000;

export interface ServiceInput {
  name: string;
  priceMin: number;
  priceMax: number;
  description: string;
}

export function validateServiceInput(input: ServiceInput): string | null {
  const name = input.name.trim();
  if (!name) return "Give this service a name.";
  if (name.length > MAX_NAME_LENGTH) {
    return `Service names are limited to ${MAX_NAME_LENGTH} characters.`;
  }
  if (!Number.isFinite(input.priceMin) || !Number.isFinite(input.priceMax)) {
    return "Enter both ends of the price range as numbers.";
  }
  if (input.priceMin < 0 || input.priceMax < 0) return "Prices cannot be negative.";
  if (input.priceMax > MAX_PRICE) return "That price looks like a typo — check the range.";
  if (input.priceMax < input.priceMin) {
    return "The top of the range has to be at least the bottom of the range.";
  }
  if (input.description.length > 600) {
    return "Keep the description under 600 characters — it goes straight into proposals.";
  }
  return null;
}
