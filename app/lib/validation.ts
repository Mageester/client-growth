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
