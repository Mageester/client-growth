/**
 * Deliberately small, dependency-free HTML extraction. No DOM, no jsdom, no
 * browser. Regex-based and fully deterministic so it is trivially testable with
 * saved HTML fixtures and cheap enough to run on a Worker.
 *
 * It extracts what the rules need: title, headings, every link (with anchor
 * text, aria-label/title, nav flag, and scheme so tel:/mailto: CTAs survive),
 * and every <form> (action / method / whether it has a submit control).
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
  sameOriginLinks: string[];
}

const TEXT_EXCERPT_LENGTH = 600;

function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, " ");
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&#x27;/gi, "'");
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
  const h = href.trim().toLowerCase();
  if (h.startsWith("tel:")) return "tel";
  if (h.startsWith("mailto:")) return "mailto";
  if (h.startsWith("http://") || h.startsWith("https://")) return "http";
  // Any other explicit scheme (javascript:, data:, sms:, ftp:, #fragment) is out.
  if (h.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
  // No scheme -> relative http(s) URL.
  return "http";
}

function parseForms(body: string): ParsedForm[] {
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
    out.push({
      action: attr(openTag, "action").trim(),
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

    // http(s) — same-origin only, fragment stripped
    const raw = a.href.split("#")[0]?.trim();
    if (!raw) continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, base);
    } catch {
      continue;
    }
    if (resolved.origin !== base.origin || !/^https?:$/.test(resolved.protocol)) continue;
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
      forms: parseForms(body),
    },
    nav: [...navSet],
    links,
    sameOriginLinks: links.filter((l) => l.scheme === "http").map((l) => l.href),
  };
}
