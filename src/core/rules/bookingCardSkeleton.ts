const REPEATED_CARD_MINIMUM = 3;
export const BOOKING_SKELETON_SLOT_TITLES = ["service name", "service title", "item name", "item title", "package name", "package title", "product name", "product title", "class name", "course name", "treatment name"] as const;
export const BOOKING_PATH_TOKENS = ["book", "booking", "bookings", "appointment", "appointments", "schedule", "reserve", "reservation", "checkout", "cart", "order", "enroll", "signup"] as const;
const BOOKING_CONTROL_MINIMUM = 3;
const MONEY_SOURCE = [
  String.raw`(?:US|CA|AU|NZ|HK|S|C|A|R)?[$£€¥₹]\s*(?<![\d.,])\d[\d,]*(?:\.\d+)?`,
  String.raw`\b(?:USD|CAD|AUD|NZD|HKD|SGD|BRL|GBP|EUR|INR|JPY|CNY)\s*(?<![\d.,])\d[\d,]*(?:\.\d+)?`,
  String.raw`(?<![\d.,])\d[\d,]*(?:\.\d+)?\s*(?:USD|CAD|AUD|NZD|HKD|SGD|BRL|GBP|EUR|INR|JPY|CNY)\b`,
  String.raw`(?<![\d.,])\d[\d,]*(?:\.\d+)?\s*(?:(?:US|U\.S\.|CA|Canadian|Australian|New Zealand|Hong Kong|Singapore|American)\s+)?(?:dollars?|euros?|pounds?|yen)\b`,
].join("|");
const DURATION_SOURCE = String.raw`(?<![\d.,])\d[\d,]*(?:\.\d+)?\s*(?:hrs?|hours?|mins?|minutes?)\b`;
const BOOKING_ACTION_SOURCE = String.raw`\b(?:request to book|book (?:now|online|an? appointment|a session|a slot)|add to cart|buy now|pay now|reserve(?: now)?|schedule(?: now)?|sign up|book)\b`;
const CURRENCY_TOKENS = [
  { code: "USD", pattern: /us\$|\busd\b|\bus dollars?\b|\bu\.s\. dollars?\b|american dollars?/i },
  { code: "CAD", pattern: /ca\$|\bcad\b|canadian dollars?/i },
  { code: "AUD", pattern: /au\$|\baud\b|australian dollars?/i },
  { code: "NZD", pattern: /nz\$|\bnzd\b|new zealand dollars?/i },
  { code: "HKD", pattern: /hk\$|\bhkd\b|hong kong dollars?/i },
  { code: "SGD", pattern: /s\$|\bsgd\b|singapore dollars?/i },
  { code: "BRL", pattern: /r\$|\bbrl\b/i },
  { code: "GBP", pattern: /£|\bgbp\b|pounds?/i },
  { code: "EUR", pattern: /€|\beur\b|euros?/i },
  { code: "INR", pattern: /₹|\binr\b/i },
  { code: "JPY", pattern: /\bjpy\b/i },
  { code: "CNY", pattern: /\bcny\b/i },
] as const;

export interface BookingSection { textExcerpt?: string; heading?: string; elementKey?: string; }
export interface BookingCta { accessibleName?: string; label?: string; }
export interface BookingPage { url: string; status: number; wordCount: number; sections?: readonly BookingSection[]; ctas?: readonly BookingCta[]; }
export interface BookingSkeleton {
  url: string;
  unit: string;
  slotTitle: string;
  slotToken: string;
  occurrences: number;
  sectionKeys: string[];
  durations: string[];
  amounts: string[];
  displayedCurrencies: string[];
  actions: string[];
  bookingSurface: string;
}

function normalizeText(value: string): string { return value.trim().toLocaleLowerCase().replace(/\s+/g, " "); }
function freshPattern(source: string): RegExp { return new RegExp(source, "gi"); }
function extract(rest: string, pattern: RegExp): { matches: string[]; rest: string } {
  const matches: string[] = [];
  const next = rest.replace(pattern, (match) => { const token = match.trim().replace(/\s+/g, " "); if (token) matches.push(token); return " "; });
  return { matches, rest: next };
}
function currencyOf(token: string): string | null { for (const entry of CURRENCY_TOKENS) if (entry.pattern.test(token)) return entry.code; return null; }
function unresolvedCardText(unit: string, slotTitle: string): string {
  let rest = unit;
  rest = extract(rest, freshPattern(MONEY_SOURCE)).rest;
  rest = extract(rest, freshPattern(DURATION_SOURCE)).rest;
  rest = extract(rest, freshPattern(BOOKING_ACTION_SOURCE)).rest;
  rest = rest.replace(new RegExp(escapeRegExp(slotTitle), "gi"), " ");
  return rest.replace(/[\s\u00a0\u200b·•|/\\,;:()[\]{}<>"“”'’`\-–—_+*=#&@!?.]+/g, " ").replace(/\s+/g, " ").trim();
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function pathTokens(url: string): string[] { try { return new URL(url).pathname.toLocaleLowerCase().split(/[^a-z0-9]+/).filter(Boolean); } catch { return []; } }
function controlLabels(page: BookingPage): string[] { return (Array.isArray(page.ctas) ? page.ctas : []).map((cta) => `${cta.accessibleName ?? ""} ${cta.label ?? ""}`); }
function bookingSurfaceForPage(page: BookingPage): string | null {
  if (pathTokens(page.url).some((token) => BOOKING_PATH_TOKENS.includes(token as (typeof BOOKING_PATH_TOKENS)[number]))) return "path";
  const bookingControls = controlLabels(page).map((label) => extract(label, freshPattern(BOOKING_ACTION_SOURCE)).matches.length).filter((count) => count > 0).length;
  return bookingControls >= BOOKING_CONTROL_MINIMUM ? "booking-controls" : null;
}

export function bookingSkeletonForPage(page: BookingPage): BookingSkeleton | null {
  const sections = Array.isArray(page.sections) ? page.sections : [];
  if (sections.length < REPEATED_CARD_MINIMUM) return null;
  const groups = new Map<string, { unit: string; heading: string; keys: string[] }>();
  for (const section of sections) {
    const unit = typeof section.textExcerpt === "string" ? section.textExcerpt.trim() : "";
    const heading = typeof section.heading === "string" ? section.heading.trim() : "";
    if (!unit || !heading || normalizeText(unit) === normalizeText(heading)) continue;
    const key = `${normalizeText(heading)}\0${normalizeText(unit)}`;
    const group = groups.get(key) ?? { unit, heading, keys: [] as string[] };
    if (typeof section.elementKey === "string" && section.elementKey && !group.keys.includes(section.elementKey)) group.keys.push(section.elementKey);
    groups.set(key, group);
  }
  let repeated: { unit: string; heading: string; keys: string[] } | null = null;
  for (const group of groups.values()) if (group.keys.length >= REPEATED_CARD_MINIMUM && (!repeated || group.keys.length > repeated.keys.length)) repeated = group;
  if (!repeated) return null;
  const slotToken = BOOKING_SKELETON_SLOT_TITLES.find((title) => normalizeText(title) === normalizeText(repeated!.heading));
  if (!slotToken) return null;
  const money = extract(repeated.unit, freshPattern(MONEY_SOURCE));
  const durations = extract(money.rest, freshPattern(DURATION_SOURCE)).matches;
  const actions = extract(money.rest, freshPattern(BOOKING_ACTION_SOURCE)).matches;
  if (money.matches.length === 0 || durations.length === 0 || actions.length === 0 || unresolvedCardText(repeated.unit, repeated.heading).length > 0) return null;
  const bookingSurface = bookingSurfaceForPage(page);
  if (!bookingSurface) return null;
  const displayedCurrencies = [...new Set(money.matches.map(currencyOf).filter((code): code is string => code !== null))];
  return { url: page.url, unit: repeated.unit, slotTitle: repeated.heading, slotToken, occurrences: repeated.keys.length, sectionKeys: [...repeated.keys], durations, amounts: money.matches, displayedCurrencies, actions, bookingSurface };
}

export function currencyMismatchFor(input: { displayedCurrencies: readonly string[]; intendedCurrency?: string | null }): { displayed: string; intended: string } | null {
  const displayed = [...new Set(input.displayedCurrencies.filter((code) => code.trim().length > 0))];
  const intended = input.intendedCurrency?.trim() ?? "";
  if (!intended || displayed.length !== 1 || displayed[0] === intended) return null;
  return { displayed: displayed[0]!, intended };
}
