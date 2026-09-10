/**
 * Where to send someone after they sign in.
 *
 * A return target is attacker-supplied text in a query string, so it gets one
 * question asked of it: does this resolve to a path on THIS origin? Anything
 * else becomes `undefined` and the caller falls back to `/`.
 *
 * `//evil.example` is the case that catches people out. It starts with a slash,
 * so a naive `startsWith("/")` check passes it, and it is a protocol-relative
 * absolute URL — a working open redirect. It is rejected explicitly, before the
 * URL parse, because the parse alone would resolve it against the base and
 * return a host that is not ours.
 *
 * This used to be two identical copies, one in login.tsx and one in signup.tsx,
 * which is one edit away from being two different sanitizers.
 */
export function safeReturnTo(value: string | null | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return undefined;
  try {
    // A base that cannot exist: if parsing produces any other origin, the value
    // escaped this site and is refused.
    const parsed = new URL(candidate, "https://orbit.invalid");
    return parsed.origin === "https://orbit.invalid"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The relative destination a request was actually asking for.
 *
 * The audit opened a private report deep link while signed out and was sent to
 * a bare `/login`; after signing in it landed on Home. The report was reachable
 * again only by finding it, and there was nowhere to find it. This is the half
 * of that fix that remembers the destination.
 *
 * The fragment is deliberately absent: a URL fragment never reaches the server,
 * so claiming to preserve one here would be inventing information.
 */
export function requestReturnTo(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}
