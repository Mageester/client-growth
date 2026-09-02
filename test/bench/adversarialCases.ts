import type { BenchCase, JudgmentCategory } from "./cases";
import type { SiteSpec } from "./site";

/**
 * The adversarial judgment set.
 *
 * Every case here is a site where the deterministic rules will produce a
 * candidate — or provably will not, which is itself a result worth measuring —
 * and the only remaining question is the commercial one: is the subject a
 * distinct piece of client work, or something the business merely says about
 * itself?
 *
 * The set is deliberately lopsided towards ways to be wrong. A missed service
 * line costs the agency a quote; a $900–$1,800 landing page pitched for "Fully
 * Insured" costs them the client, so the trust-signal, promotion and
 * generic-claim rows are the ones that decide whether a provider is safe to
 * switch on.
 *
 * Labels were written before any model output was looked at, and are not
 * revised to match what a model happened to say.
 */

interface Archetype {
  id: string;
  clientName: string;
  origin: string;
  /** Real service lines that already have their own pages. */
  covered: Array<{ slug: string; label: string }>;
}

const ARCHETYPES = {
  electrician: {
    id: "fairhaven",
    clientName: "Fairhaven Electrical",
    origin: "https://fairhaven-adv.test",
    covered: [
      { slug: "consumer-unit-upgrades", label: "Consumer Unit Upgrades" },
      { slug: "rewiring", label: "House Rewiring" },
      { slug: "electrical-testing", label: "Electrical Testing" },
    ],
  },
  plumber: {
    id: "brookvale",
    clientName: "Brookvale Plumbing & Heating",
    origin: "https://brookvale-adv.test",
    covered: [
      { slug: "bathroom-fitting", label: "Bathroom Fitting" },
      { slug: "boiler-servicing", label: "Boiler Servicing" },
      { slug: "leak-detection", label: "Leak Detection" },
    ],
  },
  roofer: {
    id: "hallgate",
    clientName: "Hallgate Exteriors",
    origin: "https://hallgate-adv.test",
    covered: [
      { slug: "chimney-repointing", label: "Chimney Repointing" },
      { slug: "guttering", label: "Guttering" },
      { slug: "fascias-and-soffits", label: "Fascias and Soffits" },
    ],
  },
  dentist: {
    id: "millbrook",
    clientName: "Millbrook Dental Practice",
    origin: "https://millbrook-adv.test",
    covered: [
      { slug: "teeth-whitening", label: "Teeth Whitening" },
      { slug: "dental-implants", label: "Dental Implants" },
      { slug: "hygienist", label: "Hygienist Appointments" },
    ],
  },
  cleaner: {
    id: "arden",
    clientName: "Arden Facilities Cleaning",
    origin: "https://arden-adv.test",
    covered: [
      { slug: "office-cleaning", label: "Office Cleaning" },
      { slug: "window-cleaning", label: "Window Cleaning" },
      { slug: "carpet-cleaning", label: "Carpet Cleaning" },
    ],
  },
} satisfies Record<string, Archetype>;

type ArchetypeName = keyof typeof ARCHETYPES;

function siteFor(a: Archetype): SiteSpec {
  return {
    origin: a.origin,
    nav: ["Home", "Our Services", ...a.covered.map((c) => c.label), "About", "Contact"],
    pages: [
      { path: "/", title: a.clientName, h1s: [a.clientName] },
      { path: "/services", title: "Our Services", h1s: ["Our Services"] },
      ...a.covered.map((c) => ({ path: "/" + c.slug, title: c.label, h1s: [c.label] })),
      { path: "/about", title: "About " + a.clientName, h1s: ["About us"] },
      { path: "/contact", title: "Contact " + a.clientName, h1s: ["Contact us"] },
    ],
    links: [
      { href: "/services", label: "Our Services", inNav: true },
      ...a.covered.map((c) => ({ href: "/" + c.slug, label: c.label, inNav: true })),
      { href: "/contact", label: "Contact us", foundOn: ["/"] },
      { href: "tel:+441132960100", label: "Call us", scheme: "tel" as const, foundOn: ["/"] },
    ],
    sitemapPaths: ["/", "/services", ...a.covered.map((c) => "/" + c.slug), "/about", "/contact"],
  };
}

interface Spec {
  /** The single offering under test. */
  subject: string;
  archetype: ArchetypeName;
  category: JudgmentCategory;
  /** Why a human labeled it this way. */
  why: string;
  /**
   * Genuinely two-sided subjects: surfacing is neither required nor punished,
   * because a careful human would also hesitate. Their surface RATE is still
   * reported, so instability is visible rather than scored as a pass or a fail.
   */
  tolerated?: true;
}

const SPECS: Spec[] = [
  // -------------------------------------------------------------------------
  // TRUE SERVICES — work customers hire and pay for. These should surface.
  // -------------------------------------------------------------------------
  {
    subject: "ev charger installation",
    archetype: "electrician",
    category: "true_service",
    why: "A distinct, high-intent job with its own search demand and its own price.",
  },
  {
    subject: "fuse box replacement",
    archetype: "electrician",
    category: "true_service",
    why: "Straightforward service line a customer would ring up and book.",
  },
  {
    subject: "outdoor lighting installation",
    archetype: "electrician",
    category: "true_service",
    why: "Distinct paid work, multi-word, sells on its own page.",
  },
  {
    subject: "heat pump installation",
    archetype: "plumber",
    category: "true_service",
    why: "Niche, high-value job the trade is actively moving into.",
  },
  {
    subject: "power flushing",
    archetype: "plumber",
    category: "true_service",
    why: "Narrow trade service, unambiguously something a customer buys.",
  },
  {
    subject: "underfloor heating installation",
    archetype: "electrician",
    category: "true_service",
    why: "Multi-word, specific, expensive — exactly what a service page is for.",
  },
  {
    subject: "loft insulation",
    archetype: "roofer",
    category: "true_service",
    why: "Small but real job with clear search intent, sold on its own.",
  },
  {
    subject: "commercial roofing",
    archetype: "roofer",
    category: "true_service",
    why: "A whole customer segment with its own buying process.",
  },
  {
    subject: "invisalign",
    archetype: "dentist",
    category: "true_service",
    why: "A single-word branded treatment — niche vocabulary that must still read as a service.",
  },
  {
    subject: "emergency root canal treatment",
    archetype: "dentist",
    category: "true_service",
    why: "High-intent emergency variant; converts differently to routine care.",
  },
  {
    subject: "end of tenancy cleaning",
    archetype: "cleaner",
    category: "true_service",
    why: "Multi-word local-service variant with distinct demand and pricing.",
  },
  {
    subject: "commercial kitchen deep cleaning",
    archetype: "cleaner",
    category: "true_service",
    why: "Niche B2B service line, regulated, sold separately.",
  },

  // -------------------------------------------------------------------------
  // TRUST SIGNALS — attributes of the business. Must never surface.
  // -------------------------------------------------------------------------
  {
    subject: "fully insured",
    archetype: "electrician",
    category: "trust_signal",
    why: "Insurance is a reassurance, not a job. A page for it is unsellable.",
  },
  {
    subject: "licensed technicians",
    archetype: "plumber",
    category: "trust_signal",
    why: "A staffing credential, not work a customer pays for.",
  },
  {
    subject: "niceic approved contractor",
    archetype: "electrician",
    category: "trust_signal",
    why: "A trade accreditation — domain-specific, and still not a service.",
  },
  {
    subject: "family owned business",
    archetype: "roofer",
    category: "trust_signal",
    why: "An ownership fact. Nobody buys it.",
  },
  {
    subject: "award winning practice",
    archetype: "dentist",
    category: "trust_signal",
    why: "A boast, not a treatment.",
  },
  {
    subject: "24 years experience",
    archetype: "roofer",
    category: "trust_signal",
    why: "Tenure. Not a job, and a page about it would be filler.",
  },
  {
    subject: "dbs checked staff",
    archetype: "cleaner",
    category: "trust_signal",
    why: "A vetting credential — reassurance for buyers of the real services.",
  },

  // -------------------------------------------------------------------------
  // PROMOTIONS — offers and sales mechanics. Must never surface.
  // -------------------------------------------------------------------------
  {
    subject: "free quotes",
    archetype: "electrician",
    category: "promotion",
    why: "How the business prices work, not work. The clearest trap in the set.",
  },
  {
    subject: "free consultation",
    archetype: "dentist",
    category: "promotion",
    why: "An offer attached to real treatments, not a treatment.",
  },
  {
    subject: "finance available",
    archetype: "plumber",
    category: "promotion",
    why: "A payment mechanic, not billable page work.",
  },
  {
    subject: "satisfaction guarantee",
    archetype: "cleaner",
    category: "promotion",
    why: "A commercial term, not a service line.",
  },
  {
    subject: "10% off first clean",
    archetype: "cleaner",
    category: "promotion",
    why: "A discount — dated, promotional, unsellable as a landing page.",
  },
  {
    subject: "no call out fee",
    archetype: "plumber",
    category: "promotion",
    why: "A pricing promise dressed as a feature.",
  },
  {
    subject: "12 month workmanship warranty",
    archetype: "roofer",
    category: "promotion",
    why: "A guarantee attached to the real work.",
  },

  // -------------------------------------------------------------------------
  // GENERIC CLAIMS — marketing filler. Must never surface.
  // -------------------------------------------------------------------------
  {
    subject: "quality workmanship",
    archetype: "roofer",
    category: "generic_claim",
    why: "Says nothing about what is being sold.",
  },
  {
    subject: "fast response times",
    archetype: "plumber",
    category: "generic_claim",
    why: "A claim about how they work, not the work.",
  },
  {
    subject: "affordable pricing",
    archetype: "electrician",
    category: "generic_claim",
    why: "A price position, not a service.",
  },
  {
    subject: "friendly professional team",
    archetype: "cleaner",
    category: "generic_claim",
    why: "Pure filler. A page for it would have no content.",
  },
  {
    subject: "customer satisfaction",
    archetype: "dentist",
    category: "generic_claim",
    why: "An outcome anyone claims; no buyer searches for it.",
  },

  // -------------------------------------------------------------------------
  // AMBIGUOUS — must fail closed rather than become a priced opportunity.
  // -------------------------------------------------------------------------
  {
    subject: "bespoke packages",
    archetype: "cleaner",
    category: "ambiguous",
    why: "Could mean anything; nothing concrete enough to build or price a page around.",
  },
  {
    subject: "nationwide coverage",
    archetype: "roofer",
    category: "ambiguous",
    why: "Reads as a reach claim. It may hint at a location strategy, but is not itself a service.",
  },
  {
    subject: "aftercare",
    archetype: "dentist",
    category: "ambiguous",
    why: "Might be a paid programme, might be a courtesy. Unclear alone — fail closed.",
  },
  {
    subject: "out of hours availability",
    archetype: "plumber",
    category: "ambiguous",
    why: "An availability attribute sitting close to a real emergency service line.",
  },
  {
    subject: "maintenance plans",
    archetype: "plumber",
    category: "ambiguous",
    why: "Often a genuine recurring product, often just a phrase. A human would ask first.",
    tolerated: true,
  },
  {
    subject: "site surveys",
    archetype: "roofer",
    category: "ambiguous",
    why: "Sometimes a chargeable job, sometimes a free sales step. Genuinely two-sided.",
    tolerated: true,
  },
];

function idFor(spec: Spec): string {
  const slug = spec.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return spec.category.replace(/_/g, "-") + "-" + slug;
}

function caseFor(spec: Spec): BenchCase {
  const archetype: Archetype = ARCHETYPES[spec.archetype];
  const surfaceExpected = spec.category === "true_service";
  const expectation = [{ ruleId: "missing-service-page" as const, subject: spec.subject }];

  return {
    id: idFor(spec),
    clientName: archetype.clientName,
    category: spec.category,
    what: `"${spec.subject}" is in the offerings list; the site has no page for it.`,
    rationale: spec.why,
    offerings: [...archetype.covered.map((c) => c.label.toLowerCase()), spec.subject],
    site: siteFor(archetype),
    expectOutcome: surfaceExpected ? "findings" : "clean",
    expect: surfaceExpected ? expectation : [],
    tolerate: spec.tolerated ? expectation : undefined,
  };
}

export const ADVERSARIAL_CASES: BenchCase[] = SPECS.map(caseFor);

/** The subject each adversarial case is about, keyed by case id. */
export const ADVERSARIAL_SUBJECTS = new Map(SPECS.map((s) => [idFor(s), s.subject]));

/** Case counts per category, for the scorecard header. */
export function categoryCounts(): Record<JudgmentCategory, number> {
  const counts: Record<JudgmentCategory, number> = {
    true_service: 0,
    trust_signal: 0,
    promotion: 0,
    generic_claim: 0,
    ambiguous: 0,
  };
  for (const spec of SPECS) counts[spec.category]++;
  return counts;
}
