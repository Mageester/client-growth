/**
 * Deliberately small, dependency-free HTML extraction. No DOM, no jsdom, no
 * browser. Regex-based and fully deterministic so it is trivially testable with
 * saved HTML fixtures and cheap enough to run on a Worker.
 *
 * It extracts what the rule and its absence-verification pass need: title,
 * headings, and every same-origin link with its anchor text and whether it sat
 * inside a navigation region.
 */

export interface ParsedLink {
  href: string;
  label: string;
  inNav: boolean;
}

export interface ParsedPage {
  page: {
    url: string;
    title: string;
    h1s: string[];
    headings: string[];
    textExcerpt: string;
    wordCount: number;
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

/** [href, innerHtml] pairs for every <a> in the input. */
function anchorPairs(input: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m[1] !== undefined) out.push([m[1], m[2] ?? ""]);
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
    ...captures(
      /<[a-z]+\b[^>]*\brole=["']navigation["'][^>]*>([\s\S]*?)<\/[a-z]+>/gi,
      body,
    ),
  ];
  const navHrefs = new Set<string>();
  const navSet = new Set<string>();
  for (const block of navBlocks) {
    for (const [href, inner] of anchorPairs(block)) {
      const label = clean(inner);
      if (label) navSet.add(label);
      navHrefs.add(href);
    }
    for (const anchor of captures(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, block)) {
      const label = clean(anchor);
      if (label) navSet.add(label);
    }
  }

  // Every same-origin link with its anchor text.
  const base = new URL(url);
  const byHref = new Map<string, ParsedLink>();
  for (const [rawHref, inner] of anchorPairs(body)) {
    const raw = rawHref.split("#")[0]?.trim();
    if (!raw) continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, base);
    } catch {
      continue;
    }
    if (resolved.origin !== base.origin || !/^https?:$/.test(resolved.protocol)) continue;
    const key = resolved.toString();
    const label = clean(inner);
    const inNav = navHrefs.has(rawHref);
    const existing = byHref.get(key);
    if (!existing) {
      byHref.set(key, { href: key, label, inNav });
    } else {
      if (!existing.label && label) existing.label = label;
      if (inNav) existing.inNav = true;
    }
  }

  const text = clean(body);
  const wordCount = text ? text.split(/\s+/).length : 0;
  const links = [...byHref.values()];

  return {
    page: {
      url,
      title,
      h1s,
      headings,
      textExcerpt: text.slice(0, TEXT_EXCERPT_LENGTH),
      wordCount,
    },
    nav: [...navSet],
    links,
    sameOriginLinks: links.map((l) => l.href),
  };
}
