// src/core/conversionIntent.ts
var QUOTE_RE = /\b(get\s+(a\s+)?(free\s+)?(quote|estimate)|request\s+(a\s+)?(free\s+)?(quote|estimate)|free\s+(quote|estimate)|quote\s+request|request\s+pricing|get\s+pricing)\b/i;
var BOOK_RE = /\b(book\s+(now|online|a\s+(service|visit|appointment))|book\s+(us|today)|schedule\s+(now|online|service|a\s+(service|visit|appointment))|request\s+(an\s+)?appointment|request\s+service|make\s+an\s+appointment|start\s+(your\s+)?(project|estimate)|get\s+started)\b/i;
var CONTACT_RE = /\b(contact\s+us|contact|get\s+in\s+touch|reach\s+out|reach\s+us)\b/i;
var CALL_RE = /\b(call\s+us|call\s+now|call\s+today|tap\s+to\s+call|click\s+to\s+call)\b/i;
var HREF_HINTS = [
  [/\/(free-?quote|get-?a-?quote|request-?(?:a-?)?quote|free-?estimate|get-?(?:a-?)?estimate|quote-?request)(?:[/?-]|$)/i, "quote"],
  [/\/(book(?:ing)?|schedule|appointments?|request-?service|get-?started|start-?(?:my-?|your-?)?project)(?:[/?-]|$)/i, "book"],
  [/\/(contact(?:-?us)?|get-?in-?touch)(?:[/?-]|$)/i, "contact"]
];
function classifyConversionLink(link) {
  const text = `${link.label ?? ""} ${link.ariaLabel ?? ""} ${link.title ?? ""}`.replace(/\s+/g, " ").trim();
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
__name(classifyConversionLink, "classifyConversionLink");
var PLACEHOLDER_DIGIT_STRINGS = /* @__PURE__ */ new Set([
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
  "9999999999"
]);
function isMonotonic(digits) {
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
__name(isMonotonic, "isMonotonic");
function telDefect(href2) {
  const raw = href2.replace(/^tel:/i, "").trim();
  if (raw === "") return "malformed";
  const main = raw.split(";")[0].split(",")[0].trim();
  const hadParams = raw.length !== main.length;
  if (/[a-z]/i.test(main.replace(/^\+/, ""))) return "malformed";
  const digits = main.replace(/\D/g, "");
  if (hadParams && digits.length < 7) return "inconclusive";
  if (digits.length < 7 || digits.length > 15) return "malformed";
  if (/^(\d)\1+$/.test(digits)) return "malformed";
  if (isMonotonic(digits)) return "malformed";
  if (PLACEHOLDER_DIGIT_STRINGS.has(digits)) return "malformed";
  if (/^1?(\d{3})?55501\d\d$/.test(digits)) return "malformed";
  if (hadParams && digits.length < 10) return "inconclusive";
  return "ok";
}
__name(telDefect, "telDefect");
var PLACEHOLDER_TOKENS = [
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
  "acuityscheduling.com/schedule.php?owner=xxxx"
];
var PLACEHOLDER_RE = [
  /formspree\.io\/f\/x{3,}/i,
  /getform\.io\/f\/x{3,}/i,
  /\/(your|my|test|sample|demo)[-_](form|calendar|endpoint|url|id|link|handler)/i,
  /\bx{4,}\b/i,
  /\{\{?\s*[a-z_]+\s*\}?\}/i
  // {{something}} template leftovers
];
function hasAllCapsPlaceholderSegment(url) {
  let path = url;
  try {
    const u = new URL(url, "https://x.example");
    path = `${u.pathname}${u.search}`;
  } catch {
  }
  return /(^|[/=?&-])[A-Z][A-Z0-9]{2,}(-[A-Z0-9]{2,})+([/=?&]|$)/.test(path);
}
__name(hasAllCapsPlaceholderSegment, "hasAllCapsPlaceholderSegment");
function isPlaceholderTarget(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (PLACEHOLDER_TOKENS.some((t) => lower.includes(t))) return true;
  if (PLACEHOLDER_RE.some((re) => re.test(url))) return true;
  if (hasAllCapsPlaceholderSegment(url)) return true;
  return false;
}
__name(isPlaceholderTarget, "isPlaceholderTarget");
