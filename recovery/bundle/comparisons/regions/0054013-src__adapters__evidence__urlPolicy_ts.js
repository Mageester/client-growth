// src/adapters/evidence/urlPolicy.ts
var HTTP_PROTOCOLS = /* @__PURE__ */ new Set(["http:", "https:"]);
function parseIpv4(hostname) {
  if (!/^\d+(?:\.\d+){3}$/.test(hostname)) return null;
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return [parts[0], parts[1], parts[2], parts[3]];
}
__name(parseIpv4, "parseIpv4");
function ipv4FromWords(words) {
  const low = words[6] ?? 0;
  const high = words[7] ?? 0;
  return [low >> 8 & 255, low & 255, high >> 8 & 255, high & 255];
}
__name(ipv4FromWords, "ipv4FromWords");
function parseIpv6(hostname) {
  const value = hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (!value.includes(":")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const parseSide = /* @__PURE__ */ __name((side) => {
    if (!side) return [];
    const parts = side.split(":");
    const words = [];
    for (const part of parts) {
      if (part.includes(".")) {
        const ipv43 = parseIpv4(part);
        if (!ipv43) return null;
        words.push(ipv43[0] << 8 | ipv43[1], ipv43[2] << 8 | ipv43[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      words.push(Number.parseInt(part, 16));
    }
    return words;
  }, "parseSide");
  const left = parseSide(halves[0] ?? "");
  const right = parseSide(halves.length === 2 ? halves[1] ?? "" : "");
  if (!left || !right) return null;
  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...new Array(missing).fill(0), ...right];
}
__name(parseIpv6, "parseIpv6");
function isUnspecifiedIpv4(ip) {
  return ip.every((part) => part === 0);
}
__name(isUnspecifiedIpv4, "isUnspecifiedIpv4");
function isNonPublicIpv4(ip) {
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
__name(isNonPublicIpv4, "isNonPublicIpv4");
function isNonPublicIpv6(hostname) {
  const words = parseIpv6(hostname);
  if (!words) return false;
  const isAllZero = words.every((word) => word === 0);
  const isLoopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  const first = words[0] ?? 0;
  const isLinkLocal = (first & 65472) === 65152;
  const isSiteLocal = (first & 65472) === 65216;
  const isUniqueLocal = (first & 65024) === 64512;
  const isMulticast = (first & 65280) === 65280;
  const isDocumentation = first === 8193 && words[1] === 3512;
  if (isAllZero || isLoopback || isLinkLocal || isSiteLocal || isUniqueLocal || isMulticast || isDocumentation) return true;
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 65535;
  const compatible = words.slice(0, 6).every((word) => word === 0);
  if (mapped || compatible) return isNonPublicIpv4(ipv4FromWords(words));
  return false;
}
__name(isNonPublicIpv6, "isNonPublicIpv6");
function normalizedHostname(url) {
  return url.hostname.replace(/^\[/, "").replace(/\]$/, "").replace(/\.+$/, "").toLowerCase();
}
__name(normalizedHostname, "normalizedHostname");
function hostnamePolicy(url) {
  const hostname = normalizedHostname(url);
  const ipv43 = parseIpv4(hostname);
  if (ipv43) {
    if (isUnspecifiedIpv4(ipv43) || isNonPublicIpv4(ipv43)) {
      return { ok: false, kind: "private-host", reason: "destination is a non-public IPv4 address" };
    }
    return null;
  }
  if (isNonPublicIpv6(hostname)) {
    return { ok: false, kind: "private-host", reason: "destination is a non-public IPv6 address" };
  }
  if (hostname.includes(":")) return null;
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".intranet") || hostname.endsWith(".lan") || hostname.endsWith(".corp") || hostname === "home.arpa" || hostname.endsWith(".home.arpa") || hostname.endsWith(".onion") || !hostname.includes(".")) {
    return {
      ok: false,
      kind: "internal-hostname",
      reason: "destination is an internal-style or single-label hostname"
    };
  }
  return null;
}
__name(hostnamePolicy, "hostnamePolicy");
function normalizeAndValidateUrl(input, base) {
  let url;
  try {
    url = base === void 0 ? new URL(String(input)) : new URL(String(input), String(base));
  } catch {
    return { ok: false, kind: "malformed-url", reason: "URL could not be parsed" };
  }
  if (!HTTP_PROTOCOLS.has(url.protocol)) {
    return { ok: false, kind: "unsupported-scheme", reason: `unsupported URL scheme: ${url.protocol || "(none)"}` };
  }
  if (url.username || url.password) {
    return { ok: false, kind: "credentials", reason: "URL userinfo credentials are not permitted" };
  }
  url.hash = "";
  const hostFailure = hostnamePolicy(url);
  if (hostFailure) return hostFailure;
  return { ok: true, url };
}
__name(normalizeAndValidateUrl, "normalizeAndValidateUrl");
function normalizeOrigin(domain) {
  const trimmed = domain.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return { ok: false, kind: "malformed-url", reason: "client domain is empty" };
  }
  const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const candidate = hasExplicitScheme ? trimmed : `https://${trimmed}`;
  return normalizeAndValidateUrl(candidate);
}
__name(normalizeOrigin, "normalizeOrigin");
function canonicalSiteHost(hostname) {
  const host = hostname.replace(/^\[/, "").replace(/\]$/, "").replace(/\.+$/, "").toLowerCase();
  return host.startsWith("www.") ? host.slice("www.".length) : host;
}
__name(canonicalSiteHost, "canonicalSiteHost");
function isSameSite(a, b) {
  try {
    const left = new URL(String(a));
    const right = new URL(String(b));
    return left.protocol === right.protocol && left.port === right.port && canonicalSiteHost(left.hostname) === canonicalSiteHost(right.hostname);
  } catch {
    return false;
  }
}
__name(isSameSite, "isSameSite");
function canonicalCrawlPathname(pathname) {
  const withoutTrailingSlash = pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/";
  if (!/\/index\.(?:html?|php)$/i.test(withoutTrailingSlash)) {
    return withoutTrailingSlash || "/";
  }
  const parent = withoutTrailingSlash.slice(0, withoutTrailingSlash.lastIndexOf("/"));
  return parent || "/";
}
__name(canonicalCrawlPathname, "canonicalCrawlPathname");
function canonicalizeCrawlUrl(input) {
  const url = new URL(String(input));
  url.hash = "";
  url.pathname = canonicalCrawlPathname(url.pathname);
  return url;
}
__name(canonicalizeCrawlUrl, "canonicalizeCrawlUrl");
function crawlKey(input) {
  try {
    const url = canonicalizeCrawlUrl(input);
    return `${url.protocol}//${canonicalSiteHost(url.hostname)}${url.port ? `:${url.port}` : ""}${url.pathname}${url.search}`;
  } catch {
    return String(input);
  }
}
__name(crawlKey, "crawlKey");
function redactUrl(input) {
  try {
    const url = new URL(String(input));
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "[unparseable URL]";
  }
}
__name(redactUrl, "redactUrl");
