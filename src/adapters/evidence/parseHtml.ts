import { isSameSite } from "@/adapters/evidence/urlPolicy";

/**
 * Deliberately small, dependency-free HTML extraction. No DOM, no jsdom, no
 * browser. Regex-based and fully deterministic so it is trivially testable with
 * saved HTML fixtures and cheap enough to run on a Worker.
 *
 * It extracts what the rules need: title, headings, every link (with anchor
 * text, aria-label/title, nav flag, and scheme so tel:/mailto: CTAs survive),
 * and every <form> (action / method / whether it has a submit control).
 *
 * Entities are decoded with a general numeric decoder as well as the named
 * handful: real sites emit &#8211; and &#038; constantly, and a nav label of
 * "Patios &#038; Walkways" matches nothing an agency would ever type.
 */

export type LinkScheme = "http" | "tel" | "mailto";

export interface ParsedLink {
  href: string;
  label: string;
  ariaLabel: string;
  title: string;
  scheme: LinkScheme;
  inNav: boolean;
}

export interface ParsedForm {
  action: string;
  method: "GET" | "POST";
  hasSubmit: boolean;
}

export interface ParsedPage {
  page: {
    url: string;
    title: string;
    h1s: string[];
    headings: string[];
    textExcerpt: string;
    wordCount: number;
    forms: ParsedForm[];
  };
  nav: string[];
  links: ParsedLink[];
  /**
   * http(s) links that stay on this website. "Same site" here means the same
   * host or its `www.` sibling — see isSameSite in urlPolicy.ts. Sites that
   * canonicalise to www put their entire content tree on the sibling host, and
   * dropping those links leaves a crawl with nothing but the homepage.
   */
  sameSiteLinks: string[];
}

const TEXT_EXCERPT_LENGTH = 600;

function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, " ");
}

/**
 * Codepoints that must not come back out of an entity: decoding "&#60;script"
 * into "<script" would put markup back into text this module has already
 * stripped tags from.
 */
function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0x20 || code > 0x10ffff) return " ";
  if (code >= 0xd800 && code <= 0xdfff) return " ";
  const char = String.fromCodePoint(code);
  return /[<>&"'`]/.test(char) ? " " : char;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&#0?39;|&#x27;/gi, "'")
    // Numeric entities, decimal and hex, run BEFORE the named ones so a
    // doubly-encoded "&amp;#60;" cannot be assembled into markup across passes.
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_, dec: string) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&mdash;|&ndash;/gi, "-")
    .replace(/&hellip;/gi, "...")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&(?:reg|trade|copy|middot|bull|times);/gi, " ");
}

function clean(input: string): string {
  return decodeEntities(stripTags(input)).replace(/\s+/g, " ").trim();
}

function captures(re: RegExp, input: string): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    if (match[1] !== undefined) out.push(match[1]);
  }
  return out;
}

function attr(openTag: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(openTag);
  return m?.[1] ?? "";
}

interface AnchorRecord {
  openTag: string;
  href: string;
  ariaLabel: string;
  title: string;
  inner: string;
}

function anchorRecords(input: string): AnchorRecord[] {
  const out: AnchorRecord[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const openTag = m[1] ?? "";
    const href = attr(openTag, "href");
    if (!href) continue;
    out.push({
      openTag,
      href,
      ariaLabel: attr(openTag, "aria-label"),
      title: attr(openTag, "title"),
      inner: m[2] ?? "",
    });
  }
  return out;
}

function schemeOf(href: string): LinkScheme | null {
  const value = href.trim();
  try {
    const parsed = new URL(value, "https://client-growth.invalid/");
    if (parsed.protocol === "tel:") return "tel";
    if (parsed.protocol === "mailto:") return "mailto";
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return "http";
    // Any other explicit scheme (javascript:, data:, sms:, ftp:) is out.
    return null;
  } catch {
    return null;
  }
}

function parseForms(body: string, base: URL): ParsedForm[] {
  const out: ParsedForm[] = [];
  const re = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const openTag = m[1] ?? "";
    const inner = m[2] ?? "";
    const methodRaw = attr(openTag, "method").toUpperCase();
    const hasSubmit =
      /<input\b[^>]*\btype\s*=\s*["'](?:submit|image)["']/i.test(inner) ||
      /<button\b[^>]*\btype\s*=\s*["']submit["']/i.test(inner) ||
      /<button\b(?![^>]*\btype\s*=)[^>]*>/i.test(inner);
    const rawAction = attr(openTag, "action").trim();
    let action = rawAction;
    if (rawAction) {
      try {
        const resolved = new URL(rawAction, base);
        if (resolved.username || resolved.password) action = "";
      } catch {
        // A malformed action is not requestable. Do not preserve an explicit
        // credential-looking value in evidence if it cannot be parsed.
        if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(rawAction)) action = "";
      }
    }
    out.push({
      action,
      method: methodRaw === "POST" ? "POST" : "GET",
      hasSubmit,
    });
  }
  return out;
}

export function parseHtml(html: string, url: string): ParsedPage {
  const body = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? "");
  const h1s = captures(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, body).map(clean).filter(Boolean);
  const headings = captures(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi, body)
    .map(clean)
    .filter(Boolean);

  // Navigation regions: <nav> blocks and role="navigation" containers.
  const navBlocks = [
    ...captures(/<nav\b[^>]*>([\s\S]*?)<\/nav>/gi, body),
    ...captures(/<[a-z]+\b[^>]*\brole=["']navigation["'][^>]*>([\s\S]*?)<\/[a-z]+>/gi, body),
  ];
  const navHrefs = new Set<string>();
  const navSet = new Set<string>();
  for (const block of navBlocks) {
    for (const a of anchorRecords(block)) {
      const label = clean(a.inner) || a.ariaLabel || a.title;
      if (label) navSet.add(label);
      navHrefs.add(a.href);
    }
  }

  const base = new URL(url);
  const byKey = new Map<string, ParsedLink>();

  for (const a of anchorRecords(body)) {
    const scheme = schemeOf(a.href);
    if (!scheme) continue;
    const label = clean(a.inner);

    if (scheme === "tel" || scheme === "mailto") {
      const key = `${scheme}:${a.href.trim()}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          href: a.href.trim(),
          label,
          ariaLabel: a.ariaLabel,
          title: a.title,
          scheme,
          inNav: navHrefs.has(a.href),
        });
      } else if (!existing.label && label) {
        existing.label = label;
      }
      continue;
    }

    // http(s) — same-site only (host or its www. sibling), fragment stripped
    const raw = a.href.split("#")[0]?.trim();
    if (!raw) continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, base);
    } catch {
      continue;
    }
    if (resolved.username || resolved.password) continue;
    if (!/^https?:$/.test(resolved.protocol) || !isSameSite(resolved, base)) continue;
    const key = resolved.toString();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        href: key,
        label,
        ariaLabel: a.ariaLabel,
        title: a.title,
        scheme: "http",
        inNav: navHrefs.has(a.href),
      });
    } else {
      if (!existing.label && label) existing.label = label;
      if (!existing.ariaLabel && a.ariaLabel) existing.ariaLabel = a.ariaLabel;
      if (!existing.title && a.title) existing.title = a.title;
      if (navHrefs.has(a.href)) existing.inNav = true;
    }
  }

  const text = clean(body);
  const wordCount = text ? text.split(/\s+/).length : 0;
  const links = [...byKey.values()];

  return {
    page: {
      url,
      title,
      h1s,
      headings,
      textExcerpt: text.slice(0, TEXT_EXCERPT_LENGTH),
      wordCount,
      forms: parseForms(body, base),
    },
    nav: [...navSet],
    links,
    sameSiteLinks: links.filter((l) => l.scheme === "http").map((l) => l.href),
  };
}
