// src/core/siteStructure.ts
var NON_SERVICE_SEGMENTS = /* @__PURE__ */ new Set([
  "",
  "home",
  "index",
  "about",
  "about-us",
  "our-story",
  "contact",
  "contact-us",
  "blog",
  "news",
  "articles",
  "resources",
  "careers",
  "career",
  "jobs",
  "reviews",
  "testimonials",
  "financing",
  "finance",
  "specials",
  "special-offers",
  "offers",
  "coupons",
  "promotions",
  "locations",
  "location",
  "service-area",
  "service-areas",
  "areas-served",
  "areas-we-serve",
  "privacy",
  "privacy-policy",
  "terms",
  "terms-of-service",
  "team",
  "our-team",
  "staff",
  "gallery",
  "photos",
  "projects",
  "portfolio",
  "shop",
  "store",
  "cart",
  "account",
  "login",
  "faq",
  "faqs",
  "sitemap",
  "search",
  "book",
  "booking",
  "schedule",
  "schedule-online",
  "request-appointment",
  "get-a-quote",
  "quote",
  "estimate",
  "buy-a-home",
  "sell-a-home",
  "for-homeowners"
]);
var SERVICE_SECTION_SEGMENTS = /* @__PURE__ */ new Set([
  "service",
  "services",
  "our-services",
  "all-services",
  "service-list",
  "what-we-do",
  "how-we-help",
  "solutions",
  "our-solutions",
  "expertise",
  "capabilities",
  "specialties",
  "specialities",
  "treatments",
  "treatment",
  "procedures",
  "programs",
  "programmes",
  "program",
  "programme",
  "classes",
  "courses",
  "offerings",
  "packages",
  "departments",
  "practice-areas",
  "residential",
  "commercial"
]);
function isServiceSectionSegment(segment) {
  return SERVICE_SECTION_SEGMENTS.has(segment) || /(?:^|-)services$/.test(segment);
}
__name(isServiceSectionSegment, "isServiceSectionSegment");
function isServiceSectionLabel(label) {
  const normalized3 = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const withoutQualifier = normalized3.replace(/^(?:all|our)-/, "");
  return isServiceSectionSegment(normalized3) || isServiceSectionSegment(withoutQualifier);
}
__name(isServiceSectionLabel, "isServiceSectionLabel");
var SERVICE_WORD = /(repair|install|installation|replacement|replace|cleaning|clean|control|removal|remove|treatment|maintenance|remediation|restoration|inspection|encapsulation|pruning|grinding|rewiring|lighting|irrigation|whitening|extraction|therapy|training|tuning|tune-up|detailing|resurfacing|relining|waterproofing|underpinning|renovation|remodel|landscaping|paving|roofing|plumbing|heating|cooling|wiring|grooming|coaching|consulting|design|build|repairs|servicing)/i;
function isPlatformInfrastructurePath(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path === "/cdn-cgi" || path.startsWith("/cdn-cgi/");
  } catch {
    return false;
  }
}
__name(isPlatformInfrastructurePath, "isPlatformInfrastructurePath");
function pathSegments(url) {
  let path = url;
  try {
    path = new URL(url, "https://client-growth.invalid/").pathname;
  } catch {
  }
  return path.toLowerCase().split("/").filter(Boolean);
}
__name(pathSegments, "pathSegments");
var REGISTRY_PATH_PATTERNS = [
  ["domains", "root", "db"],
  ["dnssec", "procedures"]
];
function isRegistryPath(url) {
  const segments = pathSegments(url);
  return REGISTRY_PATH_PATTERNS.some((pattern2) => {
    for (let start = 0; start <= segments.length - pattern2.length; start++) {
      if (pattern2.every((segment, index) => segments[start + index] === segment)) return true;
    }
    return false;
  });
}
__name(isRegistryPath, "isRegistryPath");
var COMMERCE_ANCESTOR_SEGMENTS = /* @__PURE__ */ new Set([
  "collection",
  "collections",
  "product",
  "products"
]);
function isCommerceCatalogPath(url) {
  const segments = pathSegments(url);
  return segments.slice(0, -1).some((segment) => COMMERCE_ANCESTOR_SEGMENTS.has(segment));
}
__name(isCommerceCatalogPath, "isCommerceCatalogPath");
function isNonServiceSegment(segment) {
  return NON_SERVICE_SEGMENTS.has(segment);
}
__name(isNonServiceSegment, "isNonServiceSegment");
function isInServiceSection(url) {
  if (isRegistryPath(url)) return false;
  if (isCommerceCatalogPath(url)) return false;
  return pathSegments(url).some(isServiceSectionSegment);
}
__name(isInServiceSection, "isInServiceSection");
function isServiceHub(url) {
  if (isRegistryPath(url)) return false;
  const segments = pathSegments(url);
  return segments.length === 1 && isServiceSectionSegment(segments[0]);
}
__name(isServiceHub, "isServiceHub");
function isServiceSectionChild(url) {
  if (isRegistryPath(url)) return false;
  if (isCommerceCatalogPath(url)) return false;
  const segments = pathSegments(url);
  const hub = segments.findIndex(isServiceSectionSegment);
  return hub !== -1 && hub < segments.length - 1;
}
__name(isServiceSectionChild, "isServiceSectionChild");
function hasServiceWordInSlug(url) {
  if (isRegistryPath(url)) return false;
  if (isCommerceCatalogPath(url)) return false;
  const segments = pathSegments(url);
  const last = segments[segments.length - 1] ?? "";
  if (!last || isNonServiceSegment(last)) return false;
  return SERVICE_WORD.test(last);
}
__name(hasServiceWordInSlug, "hasServiceWordInSlug");
function looksLikeServiceUrl(url) {
  if (isRegistryPath(url)) return false;
  return isInServiceSection(url) || hasServiceWordInSlug(url);
}
__name(looksLikeServiceUrl, "looksLikeServiceUrl");
function crawlPriority(url, options = {}) {
  const segments = pathSegments(url);
  if (segments.length === 0) return 1e3;
  const last = segments[segments.length - 1] ?? "";
  let score = 0;
  if (isServiceSectionChild(url)) score += 100;
  else if (isServiceHub(url)) score += 80;
  if (hasServiceWordInSlug(url)) score += 60;
  if (options.inNav) score += 15;
  if (options.inServiceNav) score += 90;
  if (isNonServiceSegment(last)) score -= 120;
  if (isEditorialPath(url)) score -= 100;
  if (segments.length > 3) score -= 30;
  return score;
}
__name(crawlPriority, "crawlPriority");
var NON_SERVICE_WORDS = /* @__PURE__ */ new Set([
  "about",
  "contact",
  "faq",
  "faqs",
  "team",
  "staff",
  "mission",
  "story",
  "blog",
  "news",
  "press",
  "careers",
  "career",
  "job",
  "jobs",
  "review",
  "reviews",
  "testimonial",
  "testimonials",
  "privacy",
  "terms",
  "sitemap",
  "gallery",
  "portfolio",
  "location",
  "locations",
  "login",
  "account",
  "cart",
  "checkout",
  "thanks",
  "policy",
  "disclaimer",
  "accessibility",
  "author",
  "category",
  "tag",
  "search",
  // Pages about what something costs, or about an offer, rather than about the
  // work itself. "Basement Renovation Cost" is a real page on a real
  // contractor's site and it is not a service anyone buys.
  "cost",
  "costs",
  "price",
  "prices",
  "pricing",
  "coupon",
  "coupons",
  "promo",
  "promos",
  "promotion",
  "promotions",
  "specials",
  "deals",
  "financing",
  // A page that explains what a word means is not a page that sells the work.
  // renoduck.com's /renovation-glossary/ was standing as proof that the client
  // already had a page for "basement underpinning".
  "glossary",
  "glossaries",
  "definitions",
  "terminology"
]);
var ARCHIVE_SEGMENTS = /* @__PURE__ */ new Set([
  "tag",
  "tags",
  "category",
  "categories",
  "author",
  "archive",
  "archives",
  "page",
  "feed",
  "amp",
  "wp-content",
  "wp-json",
  "wp-admin"
]);
function isArchivePath(url) {
  return pathSegments(url).some((segment) => ARCHIVE_SEGMENTS.has(segment));
}
__name(isArchivePath, "isArchivePath");
var EDITORIAL_ANCESTOR_SEGMENTS = /* @__PURE__ */ new Set([
  "blog",
  "news",
  "article",
  "articles",
  "press",
  "media",
  "newsroom",
  "resources",
  "resource",
  "insights",
  "guides",
  "guide",
  "stories",
  "case-studies",
  "case-study",
  "project-gallery",
  "gallery",
  "galleries",
  "portfolio",
  "projects",
  "testimonials",
  "reviews",
  "events",
  // Some site builders expose their blog as a deliberately short `/b/`
  // namespace. It is still editorial content even when the slug contains a
  // service word such as "plumbing" or "drain".
  "b"
]);
function isEditorialPath(url) {
  const segments = pathSegments(url);
  return segments.slice(0, -1).some((segment) => EDITORIAL_ANCESTOR_SEGMENTS.has(segment));
}
__name(isEditorialPath, "isEditorialPath");
function slugSaysNonService(url) {
  const segments = pathSegments(url);
  const last = segments[segments.length - 1] ?? "";
  if (!last) return true;
  if (isNonServiceSegment(last)) return true;
  return last.split(/[-_.]+/).some((word) => NON_SERVICE_WORDS.has(word));
}
__name(slugSaysNonService, "slugSaysNonService");
