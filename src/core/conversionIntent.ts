/**
 * Deterministic helpers for the broken-conversion-path rule. No AI, no network.
 *
 * Everything here is conservative: when a value is odd or ambiguous we return
 * "inconclusive" rather than "malformed", so uncertain cases never surface.
 */

export type ConversionIntent = "contact" | "quote" | "book" | "call";

const QUOTE_RE =
  /\b(get\s+(a\s+)?(free\s+)?(quote|estimate)|request\s+(a\s+)?(free\s+)?(quote|estimate)|free\s+(quote|estimate)|quote\s+request|request\s+pricing|get\s+pricing)\b/i;
const BOOK_RE =
  /\b(book\s+(now|online|a\s+(service|visit|appointment))|book\s+(us|today)|schedule\s+(now|online|service|a\s+(service|visit|appointment))|request\s+(an\s+)?appointment|request\s+service|make\s+an\s+appointment|start\s+(your\s+)?(project|estimate)|get\s+started)\b/i;
const CONTACT_RE = /\b(contact\s+us|contact|get\s+in\s+touch|reach\s+out|reach\s+us)\b/i;
const CALL_RE = /\b(call\s+us|call\s+now|call\s+today|tap\s+to\s+call|click\s+to\s+call)\b/i;

const HREF_HINTS: Array<[RegExp, ConversionIntent]> = [
  [/\/(free-?quote|get-?a-?quote|request-?(?:a-?)?quote|free-?estimate|get-?(?:a-?)?estimate|quote-?request)(?:[/?-]|$)/i, "quote"],
  [/\/(book(?:ing)?|schedule|appointments?|request-?service|get-?started|start-?(?:my-?|your-?)?project)(?:[/?-]|$)/i, "book"],
  [/\/(contact(?:-?us)?|get-?in-?touch)(?:[/?-]|$)/i, "contact"],
];

export interface LinkLike {
  href: string;
  label?: string;
  ariaLabel?: string;
  title?: string;
}

/**
 * Classify a link as a conversion CTA, or null. Only tight, well-known phrases
 * count — this must never match "your CTA could be better" territory.
 */
export function classifyConversionLink(link: LinkLike): ConversionIntent | null {
  const text = `${link.label ?? ""} ${link.ariaLabel ?? ""} ${link.title ?? ""}`
    .replace(/\s+/g, " ")
    .trim();

  // Long strings are almost always sentences / blog links, not buttons.
  if (text.length > 60) return null;

  if (QUOTE_RE.test(text)) return "quote";
  if (BOOK_RE.test(text)) return "book";
  if (CALL_RE.test(text)) return "call";
  if (CONTACT_RE.test(text)) return "contact";

  let path = "";
  try {
    path = new URL(link.href, "https://x.example").pathname;
  } catch {
    return null;
  }
  for (const [re, intent] of HREF_HINTS) {
    if (re.test(path)) return intent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// tel: validation
// ---------------------------------------------------------------------------

const PLACEHOLDER_DIGIT_STRINGS = new Set([
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "0123456789",
  "5551234567",
  "15551234567",
  "5550100",
  "5550000",
  "1231231234",
  "1112223333",
  "0001112222",
  "9999999999",
]);

function isMonotonic(digits: string): boolean {
  if (digits.length < 7) return false;
  let asc = true;
  let desc = true;
  for (let i = 1; i < digits.length; i++) {
    const d = Number(digits[i]);
    const p = Number(digits[i - 1]);
    if (d !== (p + 1) % 10) asc = false;
    if (d !== (p + 9) % 10) desc = false;
  }
  return asc || desc;
}

/**
 * "malformed"     -> definitely not a dialable number (surface it)
 * "inconclusive"  -> odd but possibly valid (do NOT surface)
 * "ok"            -> looks dialable
 */
export function telDefect(href: string): "malformed" | "inconclusive" | "ok" {
  const raw = href.replace(/^tel:/i, "").trim();
  if (raw === "") return "malformed";

  // Strip RFC3966 params (;ext=, ;phone-context=) and comma pause digits.
  const main = raw.split(";")[0]!.split(",")[0]!.trim();
  const hadParams = raw.length !== main.length;

  // Letters (other than a leading +) mean it is not a number at all:
  // "call-us", "XXX-XXX-XXXX", "your-number-here".
  if (/[a-z]/i.test(main.replace(/^\+/, ""))) return "malformed";

  const digits = main.replace(/\D/g, "");

  // Odd RFC3966 forms with a short base: we cannot confidently interpret them.
  if (hadParams && digits.length < 7) return "inconclusive";

  if (digits.length < 7 || digits.length > 15) return "malformed";
  if (/^(\d)\1+$/.test(digits)) return "malformed"; // 000-0000, 5555555555
  if (isMonotonic(digits)) return "malformed"; // 1234567, 9876543210
  if (PLACEHOLDER_DIGIT_STRINGS.has(digits)) return "malformed";
  // 555-0100..555-0199 is the block reserved for fictional numbers.
  if (/^1?(\d{3})?55501\d\d$/.test(digits)) return "malformed";

  // Has an extension but an implausibly short base number: be conservative.
  if (hadParams && digits.length < 10) return "inconclusive";

  return "ok";
}

// ---------------------------------------------------------------------------
// placeholder / default targets (form actions, external booking links)
// ---------------------------------------------------------------------------

const PLACEHOLDER_TOKENS = [
  "your-calendar-id",
  "your_calendar_id",
  "your-form-id",
  "your_form_id",
  "your-endpoint",
  "your_endpoint",
  "your-domain",
  "yourdomain",
  "example.com",
  "example.org",
  "example.net",
  "localhost",
  "127.0.0.1",
  "replace-me",
  "replace_me",
  "replaceme",
  "changeme",
  "change-me",
  "insert-url",
  "insert_url",
  "placeholder",
  "your-booking-link",
  "calendly.com/your",
  "acuityscheduling.com/schedule.php?owner=xxxx",
];

const PLACEHOLDER_RE = [
  /formspree\.io\/f\/x{3,}/i,
  /getform\.io\/f\/x{3,}/i,
  /\/(your|my|test|sample|demo)[-_](form|calendar|endpoint|url|id|link|handler)/i,
  /\bx{4,}\b/i,
  /\{\{?\s*[a-z_]+\s*\}?\}/i, // {{something}} template leftovers
];

/** An ALL-CAPS dashed path segment ("YOUR-CALENDAR-ID") is almost always a placeholder. */
function hasAllCapsPlaceholderSegment(url: string): boolean {
  let path = url;
  try {
    const u = new URL(url, "https://x.example");
    path = `${u.pathname}${u.search}`;
  } catch {
    /* treat as raw */
  }
  return /(^|[/=?&-])[A-Z][A-Z0-9]{2,}(-[A-Z0-9]{2,})+([/=?&]|$)/.test(path);
}

export function isPlaceholderTarget(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (PLACEHOLDER_TOKENS.some((t) => lower.includes(t))) return true;
  if (PLACEHOLDER_RE.some((re) => re.test(url))) return true;
  if (hasAllCapsPlaceholderSegment(url)) return true;
  return false;
}
