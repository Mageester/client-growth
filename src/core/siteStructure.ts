/**
 * What a small-business website's URL structure means.
 *
 * Three different parts of the product need the same vocabulary and must not
 * drift apart:
 *
 *   - the crawler, deciding which of a hundred discovered links to spend its
 *     ten page fetches on;
 *   - service-coverage assessment, deciding whether the crawl demonstrably
 *     reached the part of the site where services are described;
 *   - offering suggestions, deciding which links describe work a customer can
 *     actually buy.
 *
 * Everything here is structural, not industry-specific. There is no list of
 * trades, no list of treatments, and nothing that would need a new entry to
 * handle a business nobody has seen yet: the signals are the shapes that
 * service-business sites share — a services hub, a nested page under it, a verb
 * of work in the slug — plus the boring pages every site has, which are named
 * explicitly because they are the ones that fool a page-count heuristic.
 */

/**
 * Path segments that mean a page is NOT a service page. A large generic nav, or
 * lots of these, must never qualify a crawl as having reached the services.
 */
export const NON_SERVICE_SEGMENTS: ReadonlySet<string> = new Set([
  "", "home", "index", "about", "about-us", "our-story", "contact", "contact-us",
  "blog", "news", "articles", "resources", "careers", "career", "jobs",
  "reviews", "testimonials", "financing", "finance", "specials", "special-offers",
  "offers", "coupons", "promotions", "locations", "location", "service-area",
  "service-areas", "areas-served", "areas-we-serve", "privacy", "privacy-policy",
  "terms", "terms-of-service", "team", "our-team", "staff", "gallery", "photos",
  "projects", "portfolio", "shop", "store", "cart", "account", "login", "faq",
  "faqs", "sitemap", "search", "book", "booking", "schedule", "schedule-online",
  "request-appointment", "get-a-quote", "quote", "estimate", "buy-a-home",
  "sell-a-home", "for-homeowners",
]);

/**
 * The segment a site uses to name the part of itself that describes what it
 * sells. Real sites label this drawer a dozen different ways — a dental
 * practice calls it /treatments, a nursery calls it /programs, a consultancy
 * calls it /what-we-do — and every one of them means the same thing.
 */
export const SERVICE_SECTION_SEGMENTS: ReadonlySet<string> = new Set([
  "service", "services", "our-services", "all-services", "service-list",
  "what-we-do", "how-we-help", "solutions", "our-solutions", "expertise",
  "capabilities", "specialties", "specialities", "treatments", "treatment",
  "procedures", "programs", "programmes", "program", "programme", "classes",
  "courses", "offerings", "packages", "departments", "practice-areas",
  "residential", "commercial",
]);

/** A verb of work in a URL segment: the page is about doing something for you. */
export const SERVICE_WORD =
  /(repair|install|installation|replacement|replace|cleaning|clean|control|removal|remove|treatment|maintenance|remediation|restoration|inspection|encapsulation|pruning|grinding|rewiring|lighting|irrigation|whitening|extraction|therapy|training|tuning|tune-up|detailing|resurfacing|relining|waterproofing|underpinning|renovation|remodel|landscaping|paving|roofing|plumbing|heating|cooling|wiring|grooming|coaching|consulting|design|build|repairs|servicing)/i;

/** Lowercase path segments of a URL, empty ones dropped. */
export function pathSegments(url: string): string[] {
  let path = url;
  try {
    path = new URL(url, "https://client-growth.invalid/").pathname;
  } catch {
    /* treat an unparseable value as a raw path */
  }
  return path.toLowerCase().split("/").filter(Boolean);
}

/** Is this segment one of the boring pages every site has? */
export function isNonServiceSegment(segment: string): boolean {
  return NON_SERVICE_SEGMENTS.has(segment);
}

/**
 * Does this URL sit inside the site's service section — /services, /treatments,
 * /what-we-do — at any depth? A nested page (/services/heating/heat-pumps) is
 * inside it just as much as the hub itself.
 */
export function isInServiceSection(url: string): boolean {
  return pathSegments(url).some((segment) => SERVICE_SECTION_SEGMENTS.has(segment));
}

/** Is this URL the service hub page itself, rather than a page underneath it? */
export function isServiceHub(url: string): boolean {
  const segments = pathSegments(url);
  return segments.length === 1 && SERVICE_SECTION_SEGMENTS.has(segments[0]!);
}

/**
 * Is this URL a page UNDER the service section — the individual service page a
 * missing-service-page claim has to be checked against?
 */
export function isServiceSectionChild(url: string): boolean {
  const segments = pathSegments(url);
  const hub = segments.findIndex((segment) => SERVICE_SECTION_SEGMENTS.has(segment));
  return hub !== -1 && hub < segments.length - 1;
}

/**
 * A page whose own slug names work being done — /furnace-repair,
 * /basement-waterproofing — even when the site has no /services drawer at all.
 * Plenty of small sites are built exactly this way.
 */
export function hasServiceWordInSlug(url: string): boolean {
  const segments = pathSegments(url);
  const last = segments[segments.length - 1] ?? "";
  if (!last || isNonServiceSegment(last)) return false;
  return SERVICE_WORD.test(last);
}

/** Any structural reason to believe this URL describes something the business sells. */
export function looksLikeServiceUrl(url: string): boolean {
  return isInServiceSection(url) || hasServiceWordInSlug(url);
}

/**
 * How much a discovered URL is worth spending one of the crawl's ten page
 * fetches on. Higher wins; ties keep discovery order.
 *
 * A bounded crawl is a budget-allocation problem, and plain breadth-first order
 * spends the budget on whatever the template happens to put first — which on
 * real sites is Home, About, Careers, Locations and Privacy. On a corpus of 24
 * small-business sites the crawl was reaching service content on 4. Ordering
 * the frontier costs no extra requests at all; it only changes which ten of the
 * hundred discovered links get read.
 */
export function crawlPriority(url: string, options: { inNav?: boolean } = {}): number {
  const segments = pathSegments(url);
  if (segments.length === 0) return 1_000; // the homepage, always first

  const last = segments[segments.length - 1] ?? "";
  let score = 0;

  if (isServiceSectionChild(url)) score += 100;
  else if (isServiceHub(url)) score += 80;
  if (hasServiceWordInSlug(url)) score += 60;
  if (options.inNav) score += 15;

  // The boring pages every site has. They are not worthless — a Contact page is
  // where broken-conversion-path evidence lives — just worth less than the
  // pages that say what the business sells.
  if (isNonServiceSegment(last)) score -= 120;

  // Deep archive paths (/blog/2019/07/some-post) are almost never services.
  if (segments.length > 3) score -= 30;

  return score;
}

/**
 * Hyphen-separated words in a slug that mean the page is about the business
 * rather than about work it does.
 *
 * This exists because real slugs are not tidy segments. A site that has been
 * through an SEO agency does not have /contact — it has
 * /contact-us-social-skills-near-you, and its <title> is "Social Skill Groups
 * Near Me". Matching an offering against that page's words and concluding the
 * crawl reached the service section is how a five-page brochure site gets
 * reported as fully assessed.
 *
 * The trade-off is explicit: a genuine service page whose slug happens to carry
 * one of these words (an optometrist's /contact-lens-fitting) is not recognised
 * by the fallback path this guards. That costs a missed opportunity. Getting it
 * wrong the other way costs a false claim about what was checked, so the check
 * is only ever used to REJECT a weak signal, never to reject a page the site
 * itself files under /services.
 */
const NON_SERVICE_WORDS: ReadonlySet<string> = new Set([
  "about", "contact", "faq", "faqs", "team", "staff", "mission", "story",
  "blog", "news", "press", "careers", "career", "job", "jobs", "review",
  "reviews", "testimonial", "testimonials", "privacy", "terms", "sitemap",
  "gallery", "portfolio", "location", "locations", "login", "account", "cart",
  "checkout", "thanks", "policy", "disclaimer", "accessibility", "author",
  "category", "tag", "search",
  // Pages about what something costs, or about an offer, rather than about the
  // work itself. "Basement Renovation Cost" is a real page on a real
  // contractor's site and it is not a service anyone buys.
  "cost", "costs", "price", "prices", "pricing", "coupon", "coupons", "promo",
  "promos", "promotion", "promotions", "specials", "deals", "financing",
]);

/**
 * Path segments that mean the URL is a CMS listing rather than a page: a
 * WordPress tag archive, a category index, a paginated feed. They carry a
 * service word constantly (/tag/plumbing) without being a service page.
 */
const ARCHIVE_SEGMENTS: ReadonlySet<string> = new Set([
  "tag", "tags", "category", "categories", "author", "archive", "archives",
  "page", "feed", "amp", "wp-content", "wp-json", "wp-admin",
]);

/** Is any part of this URL a CMS archive or listing path? */
export function isArchivePath(url: string): boolean {
  return pathSegments(url).some((segment) => ARCHIVE_SEGMENTS.has(segment));
}

/**
 * Does this URL's own slug say it is one of the boring pages?
 *
 * Used to reject weak, text-derived evidence — never to reject a page that
 * structurally belongs to the service section.
 */
export function slugSaysNonService(url: string): boolean {
  const segments = pathSegments(url);
  const last = segments[segments.length - 1] ?? "";
  if (!last) return true; // the homepage is not a service page
  if (isNonServiceSegment(last)) return true;
  return last.split(/[-_.]+/).some((word) => NON_SERVICE_WORDS.has(word));
}
