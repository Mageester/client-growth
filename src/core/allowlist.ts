/**
 * Address-allowlist matching, shared by the product's two operator-managed
 * guest lists: who may create a workspace ([[signupAccess]]) and who has the
 * paid MONITOR feature ([[entitlements]]).
 *
 * Both answer the same shaped question — is this email named, directly or by
 * its whole domain, in a small list an operator maintains by hand — so the
 * matching rule lives once, here. It is deliberately stricter than a mail
 * server: an admission gate should err toward refusing, not toward admitting a
 * malformed address.
 *
 * Pure: no environment, no clock, no I/O.
 */

/** Normalize one address for comparison. Never used for delivery. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Parse a comma/whitespace-separated list into lowercased, non-empty entries.
 * A full address ("owner@agency.example") names one person; a bare domain
 * ("@agency.example") names everyone at it.
 */
export function parseAllowlist(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Split an address into its local part and "@domain", or null if it is not a
 * shape this gate is willing to reason about.
 *
 * Exactly one "@" is required. Taking the LAST "@" of a multi-"@" string would
 * read `someone@evil.test?@agency.example` as belonging to `@agency.example`
 * and admit a stranger on a domain entry — so a string with two of them is
 * refused outright rather than interpreted.
 */
export function splitAddress(email: string): { local: string; domain: string } | null {
  const normalized = normalizeEmail(email);
  const parts = normalized.split("@");
  if (parts.length !== 2) return null;
  const [local, host] = parts as [string, string];
  if (!local || !host) return null;
  return { local, domain: `@${host}` };
}

/**
 * Does `email` match any entry in `allowlist`? A full-address entry admits
 * exactly that person; a bare "@domain" entry admits everyone at it. An
 * unparseable address matches nothing.
 */
export function matchesAllowlist(allowlist: readonly string[], email: string): boolean {
  const address = splitAddress(email);
  if (!address) return false;
  const normalized = `${address.local}${address.domain}`;
  return allowlist.some((entry) => entry === normalized || entry === address.domain);
}
