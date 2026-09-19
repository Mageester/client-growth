// src/core/rules/bookingCardSkeleton.ts
var REPEATED_CARD_MINIMUM = 3;
var BOOKING_SKELETON_SLOT_TITLES = [
  "service name",
  "service title",
  "item name",
  "item title",
  "package name",
  "package title",
  "product name",
  "product title",
  "class name",
  "course name",
  "treatment name"
];
var BOOKING_PATH_TOKENS = [
  "book",
  "booking",
  "bookings",
  "appointment",
  "appointments",
  "schedule",
  "reserve",
  "reservation",
  "checkout",
  "cart",
  "order",
  "enroll",
  "signup"
];
var BOOKING_CONTROL_MINIMUM = 3;
var MONEY_SOURCE = [
  // Symbol-prefixed: US$19.99, CA$19.99, $19.99, £19.99, €19.99.
  String.raw`(?:US|CA|AU|NZ|HK|S|C|A|R)?[$£€¥₹]\s*(?<![\d.,])\d[\d,]*(?:\.\d+)?`,
  // Code-prefixed: USD 19.99.
  String.raw`\b(?:USD|CAD|AUD|NZD|HKD|SGD|BRL|GBP|EUR|INR|JPY|CNY)\s*(?<![\d.,])\d[\d,]*(?:\.\d+)?`,
  // Code-suffixed: 19.99 USD.
  String.raw`(?<![\d.,])\d[\d,]*(?:\.\d+)?\s*(?:USD|CAD|AUD|NZD|HKD|SGD|BRL|GBP|EUR|INR|JPY|CNY)\b`,
  // Word form: 19.99 US dollars, 19.99 Canadian dollars, 19.99 dollars, 19.99 euros.
  String.raw`(?<![\d.,])\d[\d,]*(?:\.\d+)?\s*(?:(?:US|U\.S\.|CA|Canadian|Australian|New Zealand|Hong Kong|Singapore|American)\s+)?(?:dollars?|euros?|pounds?|yen)\b`
].join("|");
var DURATION_SOURCE = String.raw`(?<![\d.,])\d[\d,]*(?:\.\d+)?\s*(?:hrs?|hours?|mins?|minutes?)\b`;
var BOOKING_ACTION_SOURCE = String.raw`\b(?:request to book|book (?:now|online|an? appointment|a session|a slot)|add to cart|buy now|pay now|reserve(?: now)?|schedule(?: now)?|sign up|book)\b`;
var CURRENCY_TOKENS = [
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
  { code: "CNY", pattern: /\bcny\b/i }
];
function normalizeText(value) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}
__name(normalizeText, "normalizeText");
function freshPattern(source2) {
  return new RegExp(source2, "gi");
}
__name(freshPattern, "freshPattern");
function extract(rest, pattern2) {
  const matches = [];
  const next = rest.replace(pattern2, (match) => {
    const token3 = match.trim().replace(/\s+/g, " ");
    if (token3) matches.push(token3);
    return " ";
  });
  return { matches, rest: next };
}
__name(extract, "extract");
function currencyOf(token3) {
  for (const entry2 of CURRENCY_TOKENS) {
    if (entry2.pattern.test(token3)) return entry2.code;
  }
  return null;
}
__name(currencyOf, "currencyOf");
function unresolvedCardText(unit, slotTitle) {
  let rest = unit;
  rest = extract(rest, freshPattern(MONEY_SOURCE)).rest;
  rest = extract(rest, freshPattern(DURATION_SOURCE)).rest;
  rest = extract(rest, freshPattern(BOOKING_ACTION_SOURCE)).rest;
  rest = rest.replace(new RegExp(escapeRegExp(slotTitle), "gi"), " ");
  return rest.replace(/[\s\u00a0\u200b·•|/\\,;:()[\]{}<>"“”'’`\-–—_+*=#&@!?.]+/g, " ").replace(/\s+/g, " ").trim();
}
__name(unresolvedCardText, "unresolvedCardText");
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
__name(escapeRegExp, "escapeRegExp");
function pathTokens(url) {
  try {
    return new URL(url).pathname.toLocaleLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  } catch {
    return [];
  }
}
__name(pathTokens, "pathTokens");
function controlLabels(page) {
  const ctas = Array.isArray(page.ctas) ? page.ctas : [];
  return ctas.map((cta) => `${cta.accessibleName ?? ""} ${cta.label ?? ""}`);
}
__name(controlLabels, "controlLabels");
function bookingSurfaceForPage(page) {
  if (pathTokens(page.url).some((token3) => BOOKING_PATH_TOKENS.includes(token3))) return "path";
  const bookingControls = controlLabels(page).map((label) => extract(label, freshPattern(BOOKING_ACTION_SOURCE)).matches.length).filter((count5) => count5 > 0).length;
  return bookingControls >= BOOKING_CONTROL_MINIMUM ? "booking-controls" : null;
}
__name(bookingSurfaceForPage, "bookingSurfaceForPage");
function bookingSkeletonForPage(page) {
  const sections = Array.isArray(page.sections) ? page.sections : [];
  if (sections.length < REPEATED_CARD_MINIMUM) return null;
  const groups = /* @__PURE__ */ new Map();
  for (const section2 of sections) {
    const unit = typeof section2.textExcerpt === "string" ? section2.textExcerpt.trim() : "";
    const heading = typeof section2.heading === "string" ? section2.heading.trim() : "";
    if (!unit || !heading) continue;
    if (normalizeText(unit) === normalizeText(heading)) continue;
    const key = `${normalizeText(heading)}\0${normalizeText(unit)}`;
    const group = groups.get(key) ?? { unit, heading, keys: [] };
    if (typeof section2.elementKey === "string" && section2.elementKey && !group.keys.includes(section2.elementKey)) {
      group.keys.push(section2.elementKey);
    }
    groups.set(key, group);
  }
  let repeated = null;
  for (const group of groups.values()) {
    if (group.keys.length < REPEATED_CARD_MINIMUM) continue;
    if (!repeated || group.keys.length > repeated.keys.length) repeated = group;
  }
  if (!repeated) return null;
  const slotToken = BOOKING_SKELETON_SLOT_TITLES.find(
    (title2) => normalizeText(title2) === normalizeText(repeated.heading)
  );
  if (!slotToken) return null;
  const money3 = extract(repeated.unit, freshPattern(MONEY_SOURCE));
  const durations = extract(money3.rest, freshPattern(DURATION_SOURCE)).matches;
  const actions = extract(money3.rest, freshPattern(BOOKING_ACTION_SOURCE)).matches;
  if (money3.matches.length === 0 || durations.length === 0 || actions.length === 0) return null;
  if (unresolvedCardText(repeated.unit, repeated.heading).length > 0) return null;
  const bookingSurface = bookingSurfaceForPage(page);
  if (!bookingSurface) return null;
  const displayedCurrencies = [
    ...new Set(
      money3.matches.map((token3) => currencyOf(token3)).filter((code) => code !== null)
    )
  ];
  return {
    url: page.url,
    unit: repeated.unit,
    slotTitle: repeated.heading,
    slotToken,
    occurrences: repeated.keys.length,
    sectionKeys: [...repeated.keys],
    durations,
    amounts: money3.matches,
    displayedCurrencies,
    actions,
    bookingSurface
  };
}
__name(bookingSkeletonForPage, "bookingSkeletonForPage");
function currencyMismatchFor(input) {
  const displayed = [...new Set(input.displayedCurrencies.filter((code) => code.trim().length > 0))];
  const intended = input.intendedCurrency?.trim() ?? "";
  if (!intended || displayed.length !== 1) return null;
  const observed = displayed[0];
  if (observed === intended) return null;
  return { displayed: observed, intended };
}
__name(currencyMismatchFor, "currencyMismatchFor");
