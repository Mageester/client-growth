/**
 * URL policy for user-controlled website destinations.
 *
 * WHATWG URL parsing happens before every policy decision. This is important:
 * Node/workerd canonicalize alternate IPv4 spellings and IPv6 forms while
 * parsing, so policy must inspect the canonical hostname rather than the raw
 * input string.
 *
 * This is deliberately a hostname/IP-literal policy. Cloudflare Workers does
 * not expose authoritative DNS resolution for an arbitrary hostname before
 * fetch, so a public-looking hostname may still resolve or rebind to a private
 * address outside this layer's control.
 */

export type UrlPolicyFailureKind =
  | "malformed-url"
  | "unsupported-scheme"
  | "credentials"
  | "private-host"
  | "internal-hostname"
  | "cross-origin";

export interface UrlPolicyFailure {
  ok: false;
  kind: UrlPolicyFailureKind;
  reason: string;
}

export interface UrlPolicySuccess {
  ok: true;
  url: URL;
}

export type UrlPolicyResult = UrlPolicySuccess | UrlPolicyFailure;

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

function parseIpv4(hostname: string): [number, number, number, number] | null {
  if (!/^\d+(?:\.\d+){3}$/.test(hostname)) return null;
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

function ipv4FromWords(words: number[]): [number, number, number, number] {
  const low = words[6] ?? 0;
  const high = words[7] ?? 0;
  return [(low >> 8) & 0xff, low & 0xff, (high >> 8) & 0xff, high & 0xff];
}

/** Parse a canonical IPv6 hostname, including IPv4-embedded forms. */
function parseIpv6(hostname: string): number[] | null {
  const value = hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (!value.includes(":")) return null;

  const halves = value.split("::");
  if (halves.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const parts = side.split(":");
    const words: number[] = [];
    for (const part of parts) {
      if (part.includes(".")) {
        const ipv4 = parseIpv4(part);
        if (!ipv4) return null;
        words.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      words.push(Number.parseInt(part, 16));
    }
    return words;
  };

  const left = parseSide(halves[0] ?? "");
  const right = parseSide(halves.length === 2 ? halves[1] ?? "" : "");
  if (!left || !right) return null;

  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }

  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function isUnspecifiedIpv4(ip: [number, number, number, number]): boolean {
  return ip.every((part) => part === 0);
}

/** RFC1918, link-local, CGNAT, documentation, multicast, and reserved IPv4. */
function isNonPublicIpv4(ip: [number, number, number, number]): boolean {
  const [a, b, c] = ip;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b >= 18 && b <= 19) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

function isNonPublicIpv6(hostname: string): boolean {
  const words = parseIpv6(hostname);
  if (!words) return false;

  const isAllZero = words.every((word) => word === 0);
  const isLoopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  const first = words[0] ?? 0;
  const isLinkLocal = (first & 0xffc0) === 0xfe80;
  const isSiteLocal = (first & 0xffc0) === 0xfec0;
  const isUniqueLocal = (first & 0xfe00) === 0xfc00;
  const isMulticast = (first & 0xff00) === 0xff00;
  const isDocumentation = first === 0x2001 && words[1] === 0x0db8;

  if (isAllZero || isLoopback || isLinkLocal || isSiteLocal || isUniqueLocal || isMulticast || isDocumentation) return true;

  // IPv4-mapped and IPv4-compatible IPv6 addresses inherit the IPv4 policy.
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const compatible = words.slice(0, 6).every((word) => word === 0);
  if (mapped || compatible) return isNonPublicIpv4(ipv4FromWords(words));

  return false;
}

function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^\[/, "").replace(/\]$/, "").replace(/\.+$/, "").toLowerCase();
}

function hostnamePolicy(url: URL): UrlPolicyFailure | null {
  const hostname = normalizedHostname(url);
  const ipv4 = parseIpv4(hostname);
  if (ipv4) {
    if (isUnspecifiedIpv4(ipv4) || isNonPublicIpv4(ipv4)) {
      return { ok: false, kind: "private-host", reason: "destination is a non-public IPv4 address" };
    }
    return null;
  }

  if (isNonPublicIpv6(hostname)) {
    return { ok: false, kind: "private-host", reason: "destination is a non-public IPv6 address" };
  }

  // A syntactically valid public IPv6 literal is not a single-label hostname.
  if (hostname.includes(":")) return null;

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".intranet") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".corp") ||
    hostname === "home.arpa" ||
    hostname.endsWith(".home.arpa") ||
    hostname.endsWith(".onion") ||
    !hostname.includes(".")
  ) {
    return {
      ok: false,
      kind: "internal-hostname",
      reason: "destination is an internal-style or single-label hostname",
    };
  }

  return null;
}

/**
 * Parse, canonicalize, and then apply the fetch policy. Relative URLs require
 * a base URL and are resolved by WHATWG URL before any policy decision.
 */
export function normalizeAndValidateUrl(input: string | URL, base?: string | URL): UrlPolicyResult {
  let url: URL;
  try {
    url = base === undefined ? new URL(String(input)) : new URL(String(input), String(base));
  } catch {
    return { ok: false, kind: "malformed-url", reason: "URL could not be parsed" };
  }

  if (!HTTP_PROTOCOLS.has(url.protocol)) {
    return { ok: false, kind: "unsupported-scheme", reason: `unsupported URL scheme: ${url.protocol || "(none)"}` };
  }
  if (url.username || url.password) {
    return { ok: false, kind: "credentials", reason: "URL userinfo credentials are not permitted" };
  }

  // Fragments are not sent over HTTP and only create duplicate crawl keys.
  url.hash = "";

  const hostFailure = hostnamePolicy(url);
  if (hostFailure) return hostFailure;

  return { ok: true, url };
}

/** Normalize a client domain into the canonical HTTP(S) origin. */
export function normalizeOrigin(domain: string): UrlPolicyResult {
  const trimmed = domain.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return { ok: false, kind: "malformed-url", reason: "client domain is empty" };
  }

  // Preserve an explicit scheme so file:/, ftp:/, javascript:, and custom
  // schemes are rejected by the same policy as every other user URL.
  const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const candidate = hasExplicitScheme ? trimmed : `https://${trimmed}`;
  return normalizeAndValidateUrl(candidate);
}

export function sameOrigin(a: URL | string, b: URL | string): boolean {
  try {
    return new URL(String(a)).origin === new URL(String(b)).origin;
  } catch {
    return false;
  }
}

/** Redact credentials before a URL is put into persisted network evidence. */
export function redactUrl(input: string | URL): string {
  try {
    const url = new URL(String(input));
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "[unparseable URL]";
  }
}
