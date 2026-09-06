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
/**
 * Paths a hosting platform injects into a page, which no human ever navigates
 * to and which the site's author did not write.
 *
 * This exists because of a measured false positive. Cloudflare's Email Address
 * Obfuscation rewrites every `mailto:` in the HTML into
 * `/cdn-cgi/l/email-protection#<encoded>` and a Cloudflare script rewrites it
 * back on load. Requested by a bot without the fragment, that path returns 404
 * — so the broken-link rule "verified" it as broken and reported a fault on
 * nine pages of a site whose email links work perfectly for every real visitor.
 *
 * On the 24-site corpus that was the ONLY thing the broken-link rule found. A
 * rule whose entire real-world output is an artefact of the client's CDN is
 * worse than a rule that finds nothing, because the agency takes it to their
 * client and is corrected by their client's developer.
 *
 * Deliberately narrow: one namespace, owned unambiguously by one platform,
 * demonstrated to produce a false claim. It is not a general suppression list,
 * and nothing should be added to it without a case like this one behind it.
 */
export function isPlatformInfrastructurePath(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    // Cloudflare reserves /cdn-cgi/ entirely: email protection, challenge
    // pages, RUM beacons, /cdn-cgi/trace. None of it is site content.
    return path === "/cdn-cgi" || path.startsWith("/cdn-cgi/");
  } catch {
    return false;
  }
}

export function pathSegments(url: string): string[] {
  let path = url;
  try {
    path = new URL(url, "https://client-growth.invalid/").pathname;
  } catch {
    /* treat an unparseable value as a raw path */
  }
  return path.toLowerCase().split("/").filter(Boolean);
}

/**
 * URL namespaces used for public registries and technical records rather than
 * customer-facing services. These shapes are intentionally structural: the
 * crawler must not turn a registry's word "build" or "procedures" into a paid
 * service suggestion just because the page sits on a real public site.
 */
const REGISTRY_PATH_PATTERNS: readonly (readonly string[])[] = [
  ["domains", "root", "db"],
  ["dnssec", "procedures"],
];

export function isRegistryPath(url: string): boolean {
  const segments = pathSegments(url);
  return REGISTRY_PATH_PATTERNS.some((pattern) => {
    for (let start = 0; start <= segments.length - pattern.length; start++) {
      if (pattern.every((segment, index) => segments[start + index] === segment)) return true;
    }
    return false;
  });
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
  if (isRegistryPath(url)) return false;
  return pathSegments(url).some((segment) => SERVICE_SECTION_SEGMENTS.has(segment));
}

/** Is this URL the service hub page itself, rather than a page underneath it? */
export function isServiceHub(url: string): boolean {
  if (isRegistryPath(url)) return false;
  const segments = pathSegments(url);
  return segments.length === 1 && SERVICE_SECTION_SEGMENTS.has(segments[0]!);
}

/**
 * Is this URL a page UNDER the service section — the individual service page a
 * missing-service-page claim has to be checked against?
 */
export function isServiceSectionChild(url: string): boolean {
  if (isRegistryPath(url)) return false;
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
  if (isRegistryPath(url)) return false;
  const segments = pathSegments(url);
  const last = segments[segments.length - 1] ?? "";
  if (!last || isNonServiceSegment(last)) return false;
  return SERVICE_WORD.test(last);
}

/** Any structural reason to believe this URL describes something the business sells. */
export function looksLikeServiceUrl(url: string): boolean {
  if (isRegistryPath(url)) return false;
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

  // A page inside an editorial or portfolio section is writing ABOUT the work.
  // Only the last segment is checked above, so before this a photo of a finished
  // job scored higher than the service page it illustrates: thelawnsalon.ca's
  // /project-gallery/pool-removal-in-westwood/ scored ~60 for the service word
  // "removal" while /all-projects/decks/ scored ~15, and the crawler spent five
  // of its ten pages on near-duplicate pool-removal photos and read none of the
  // six service pages sitting in the site's own navigation.
  //
  // "projects" is in that set but "all-projects" is not, which is the whole
  // point here: this site keeps its real service pages under the second.
  if (isEditorialPath(url)) score -= 100;

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
  // A page that explains what a word means is not a page that sells the work.
  // renoduck.com's /renovation-glossary/ was standing as proof that the client
  // already had a page for "basement underpinning".
  "glossary", "glossaries", "definitions", "terminology",
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
 * Sections that publish writing and photographs ABOUT the work rather than
 * pages selling it.
 *
 * Note "projects" but not "all-projects": thelawnsalon.ca puts its real service
 * pages under /all-projects/pool-removal and its individual job write-ups under
 * /project-gallery/charleswood-pool-removal-through-low-garage. Only the second
 * is a portfolio entry.
 */
const EDITORIAL_ANCESTOR_SEGMENTS: ReadonlySet<string> = new Set([
  "blog", "news", "article", "articles", "press", "media", "newsroom",
  "resources", "resource", "insights", "guides", "guide", "stories",
  "case-studies", "case-study", "project-gallery", "gallery", "galleries",
  "portfolio", "projects", "testimonials", "reviews", "events",
]);

/**
 * Does this page live UNDER an editorial or portfolio section?
 *
 * slugSaysNonService only inspects a URL's own last segment, which is right for
 * what it does but means /blog/babyproofing-your-home reads as a service page:
 * the slug is a perfectly good noun phrase and the "blog" above it is never
 * looked at. An ancestor saying "blog" settles it whatever the leaf says.
 */
export function isEditorialPath(url: string): boolean {
  const segments = pathSegments(url);
  return segments.slice(0, -1).some((segment) => EDITORIAL_ANCESTOR_SEGMENTS.has(segment));
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
