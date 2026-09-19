// src/core/offeringSuggestions.ts
var FURNITURE = /^(home|menu|search|book(ing)?( (online|now))?|schedule( (online|service|now))?|call( us)?|contact( us)?|email( us)?|get (a )?(quote|estimate|started)|request (a )?(quote|estimate|appointment|service)|apply( (now|locally))?|careers?|jobs?|login|log in|sign in|sign up|my account|account|cart|checkout|read more|learn more|find out more|more|more info(rmation)?|see (all|more|details|solution)|view (all|more|details?|service|services|page)|explore( more)?|discover( more)?|start( (here|now|this path))?|details|continue|next|previous|back|top|skip to (main )?content|our services|all services|services|français|english|espa[nñ]ol)$/i;
var MARKETING_TAGLINE = /^build without boundaries$/i;
var LOCATION_LIKE = /^(find (my|a) (local|nearby)|locations?|areas? (we )?serve|service areas?)\b/i;
var BORING_PAGE = /^(about( us)?|our (story|team|mission|process|approach|philosophy)|meet the (team|doctors?|staff)|blog|news|press|media|articles|resources|reviews?|testimonials?|privacy( policy)?|terms.*|sitemap|gallery|photos|portfolio|projects|work|faqs?|financing|finance|specials?|special offers?|coupons?|promos?|promotions?|offers?|deals?|careers?|who we are|what we do|glossary|read|overview|introduction)$/i;
var PRICE_PAGE = /\b(cost|costs|price|prices|pricing|rates|fees)$/i;
var UMBRELLA_INDEX = /^all\s+.+\s+services?$/i;
var LOCATION_QUALIFIED = /\s(?:in|near|serving|around|throughout)\s+\p{Lu}/iu;
var QUESTION = /\?\s*$/;
var DOCUMENT_URL = /\.(pdf|docx?|xlsx?|pptx?|zip|csv|jpe?g|png|gif|svg|webp|mp4|mp3)$/i;
var PRODUCT_CATALOG_WORD = /(?:^|[\/_-])(accessor(?:y|ies)|board|boards|circuit|clicker|clickers|component|components|control-station|keypad|keypads|motherboard|motherboards|part|parts|receiver|receivers|remote-?controls?|remotes?|switch|switches|transmitter|transmitters)(?:[-_.\/]|$)/i;
var SERVICE_DELIVERY_WORD = /(?:^|[-_])(build|building|clean|cleaning|consulting|design-service|installation|install|maintenance|remediation|remodel|renovation|repair|repairs|restoration|servicing|therapy|training|treatment|tune-up|waterproofing)(?:[-_.]|$)/i;
function isProductCatalogUrl(url) {
  const pathname = new URL(url, "https://client-growth.invalid/").pathname;
  return PRODUCT_CATALOG_WORD.test(pathname) && !SERVICE_DELIVERY_WORD.test(pathname);
}
__name(isProductCatalogUrl, "isProductCatalogUrl");
var ARCHIVE_TITLE = /^(category|categories|tag|tags|archive|archives|author|page)\s*[:|-]/i;
var MAX_LABEL_WORDS = 6;
var MAX_LABEL_CHARS = 60;
var NON_DISTINGUISHING_CATALOG_WORDS = /* @__PURE__ */ new Set([
  "company",
  "companies",
  "local",
  "near",
  "me",
  "professional",
  "professionals",
  "service",
  "services"
]);
function keyOf(label) {
  const tokens = coreTokens(label).filter((token3) => !NON_DISTINGUISHING_CATALOG_WORDS.has(token3)).map(singularize);
  return tokens.length > 0 ? tokens.slice().sort().join(" ") : label.trim().toLowerCase();
}
__name(keyOf, "keyOf");
function cleanLabel(raw) {
  return raw.replace(/\s+/g, " ").replace(/^[\s–—-]+|[\s–—\-:|,.]+$/g, "").trim();
}
__name(cleanLabel, "cleanLabel");
function labelFromUrl(url) {
  const segments = pathSegments(url);
  const last = segments[segments.length - 1] ?? "";
  if (!last) return "";
  return titleCase(last.replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_]+/g, " "));
}
__name(labelFromUrl, "labelFromUrl");
function usableLabel(label) {
  if (label.length < 3 || label.length > MAX_LABEL_CHARS) return false;
  if (label.split(/\s+/).length > MAX_LABEL_WORDS) return false;
  if (!/[a-z]/i.test(label)) return false;
  if (!/^[\p{Lu}\p{N}]/u.test(label)) return false;
  if (/^buy\b/i.test(label)) return false;
  if (ARCHIVE_TITLE.test(label)) return false;
  if (QUESTION.test(label)) return false;
  if (LOCATION_QUALIFIED.test(label)) return false;
  if (PRICE_PAGE.test(label)) return false;
  if (UMBRELLA_INDEX.test(label)) return false;
  if (FURNITURE.test(label)) return false;
  if (MARKETING_TAGLINE.test(label)) return false;
  if (BORING_PAGE.test(label)) return false;
  if (LOCATION_LIKE.test(label)) return false;
  if (classifyCommercialLanguage(label) !== null) return false;
  if (significantTokens(label).length === 0) return false;
  return true;
}
__name(usableLabel, "usableLabel");
function usableUrl(url) {
  if (isRegistryPath(url)) return false;
  const pathname = new URL(url, "https://client-growth.invalid/").pathname;
  if (DOCUMENT_URL.test(pathname)) return false;
  if (isProductCatalogUrl(url)) return false;
  if (isEditorialPath(url)) return false;
  return !isArchivePath(url) && !slugSaysNonService(url);
}
__name(usableUrl, "usableUrl");
function preferUrlOverLabel(written) {
  return written.length === 0 || FURNITURE.test(written);
}
__name(preferUrlOverLabel, "preferUrlOverLabel");
function nameFor(written, url) {
  if (preferUrlOverLabel(written)) {
    const fromUrl = labelFromUrl(url);
    return usableLabel(fromUrl) ? fromUrl : null;
  }
  return usableLabel(written) ? written : null;
}
__name(nameFor, "nameFor");
function coveredByExisting(label, existingKeys) {
  return existingKeys.has(keyOf(label));
}
__name(coveredByExisting, "coveredByExisting");
function samePage(left, right) {
  return pageKey(left) === pageKey(right);
}
__name(samePage, "samePage");
function pageKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/#.*$/, "").replace(/\/$/, "");
  }
}
__name(pageKey, "pageKey");
function suggestOfferings(input) {
  const max = input.max ?? 12;
  const { site: site2 } = input.evidence;
  const existingKeys = new Set(input.existingOfferings.map(keyOf));
  const candidates = /* @__PURE__ */ new Map();
  const readableServicePageLabels = /* @__PURE__ */ new Map();
  const hasExplicitServiceMenu = site2.links.some((link) => link.inServiceNav);
  const commerceSignals = new Set(
    site2.links.filter(
      (link) => link.scheme === "http" && (isProductCatalogUrl(link.href) || /^\s*(buy|add to cart)\b/i.test(link.label))
    ).map((link) => pageKey(link.href))
  ).size;
  if (!hasExplicitServiceMenu && commerceSignals >= 6) return [];
  const add = /* @__PURE__ */ __name((rawLabel, kind, url, detail) => {
    const label = cleanLabel(rawLabel);
    if (!usableLabel(label)) return;
    if (coveredByExisting(label, existingKeys)) return;
    const key = keyOf(label);
    const existing = candidates.get(key);
    if (!existing) {
      candidates.set(key, { label, evidence: [{ kind, url, detail }], kinds: /* @__PURE__ */ new Set([kind]) });
      return;
    }
    existing.kinds.add(kind);
    if (existing.evidence.length < 4 && !existing.evidence.some((e) => e.kind === kind && e.url === url)) {
      existing.evidence.push({ kind, url, detail });
    }
  }, "add");
  for (const page of site2.pages) {
    if (page.status < 200 || page.status >= 300 || page.wordCount === 0) continue;
    if (isServiceHub(page.url) || !usableUrl(page.url)) continue;
    const serviceNavLink = site2.links.find(
      (link) => link.scheme === "http" && link.inServiceNav && samePage(link.href, page.url)
    );
    if (!isInServiceSection(page.url) && !hasServiceWordInSlug(page.url) && !serviceNavLink) continue;
    const written = cleanLabel(page.h1s[0] ?? "") || cleanLabel(page.title.split(/\s+[|–—·]\s+/)[0] ?? "");
    const label = nameFor(written, page.url);
    if (label === null) continue;
    readableServicePageLabels.set(pageKey(page.url), label);
    add(label, "service-section-page", page.url, `Has its own page at ${page.url}`);
    if (serviceNavLink) {
      add(
        label,
        "navigation-link",
        serviceNavLink.href,
        "Grouped under Services in the site's main navigation"
      );
    }
  }
  const homepageHeadings = new Set(
    site2.pages.filter((page) => pathSegments(page.url).length === 0).flatMap((page) => page.headings.map((h) => cleanLabel(h).toLowerCase()))
  );
  for (const link of site2.links) {
    if (link.scheme !== "http") continue;
    if (pathSegments(link.href).length === 0) continue;
    if (isServiceHub(link.href) || !usableUrl(link.href)) continue;
    const written = cleanLabel(link.label || link.ariaLabel || link.title);
    const label = readableServicePageLabels.get(pageKey(link.href)) ?? nameFor(written, link.href);
    if (label === null) continue;
    if (isInServiceSection(link.href) || link.inServiceNav) {
      add(label, "service-section-link", link.href, `Listed under the site's services section (${link.href})`);
    } else if (hasServiceWordInSlug(link.href)) {
      add(label, "service-section-link", link.href, `Has its own page at ${link.href}`);
    } else if (link.inNav) {
      add(label, "navigation-link", link.href, "Listed in the site's main navigation");
      continue;
    } else {
      continue;
    }
    if (link.inNav) add(label, "navigation-link", link.href, "Listed in the site's main navigation");
    if (homepageHeadings.has(label.toLowerCase())) {
      add(label, "homepage-card", link.href, "Shown as a service card on the homepage");
    }
  }
  for (const url of site2.sitemapUrls) {
    if (isServiceHub(url) || !usableUrl(url)) continue;
    if (!isInServiceSection(url) && !hasServiceWordInSlug(url)) continue;
    const label = labelFromUrl(url);
    if (!label) continue;
    add(label, "sitemap-url", url, `Listed in the site's sitemap (${url})`);
  }
  const scored = [];
  for (const candidate of candidates.values()) {
    const strong = candidate.kinds.has("service-section-page") || candidate.kinds.has("service-section-link") || candidate.kinds.has("sitemap-url");
    if (!strong) continue;
    const confidence = candidate.kinds.size >= 2 || candidate.kinds.has("service-section-page") ? "high" : "medium";
    scored.push({ label: candidate.label, confidence, evidence: candidate.evidence });
  }
  scored.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === "high" ? -1 : 1;
    if (b.evidence.length !== a.evidence.length) return b.evidence.length - a.evidence.length;
    return a.label.localeCompare(b.label);
  });
  return scored.slice(0, max);
}
__name(suggestOfferings, "suggestOfferings");
