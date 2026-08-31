/**
 * Deliberately small, dependency-free HTML extraction. No DOM, no jsdom, no
 * browser. Regex-based and fully deterministic so it is trivially testable with
 * saved HTML fixtures and cheap enough to run on a Worker.
 *
 * It extracts only what the V0 rule needs: title, headings, nav labels, a short
 * text excerpt, and same-origin links to continue a shallow crawl.
 */

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

  // Nav labels: anchor text within <nav> blocks or role="navigation" containers.
  const navBlocks = [
    ...captures(/<nav\b[^>]*>([\s\S]*?)<\/nav>/gi, body),
    ...captures(
      /<[a-z]+\b[^>]*\brole=["']navigation["'][^>]*>([\s\S]*?)<\/[a-z]+>/gi,
      body,
    ),
  ];
  const navSet = new Set<string>();
  for (const block of navBlocks) {
    for (const anchor of captures(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, block)) {
      const label = clean(anchor);
      if (label) navSet.add(label);
    }
  }

  // Same-origin links only.
  const base = new URL(url);
  const linkSet = new Set<string>();
  for (const href of captures(/<a\b[^>]*\bhref=["']([^"']+)["']/gi, body)) {
    const raw = href.split("#")[0]?.trim();
    if (!raw) continue;
    try {
      const resolved = new URL(raw, base);
      if (resolved.origin === base.origin && /^https?:$/.test(resolved.protocol)) {
        linkSet.add(resolved.toString());
      }
    } catch {
      // ignore malformed href
    }
  }

  const text = clean(body);
  const wordCount = text ? text.split(/\s+/).length : 0;

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
    sameOriginLinks: [...linkSet],
  };
}
