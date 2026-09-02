import type { Coverage, Opportunity } from "@/core/schema";
import type { SiteSpec } from "./site";
import { clientFor } from "./site";

/**
 * Labeled benchmark cases for the two validated rules.
 *
 * Each case states what a careful agency owner would want the product to do,
 * NOT what the code currently does. A case whose expectation the engine fails
 * is a measured false positive or false negative, and is recorded as such
 * rather than adjusted to match the implementation.
 */

export type Grade = "GOOD" | "QUESTIONABLE" | "BAD";

export interface ExpectedOpportunity {
  ruleId: "missing-service-page" | "broken-conversion-path";
  /** Substring that must appear in the surfaced opportunity's dedupe subject. */
  subject: string;
}

export interface BenchCase {
  id: string;
  clientName: string;
  what: string;
  /** Why a human labeled the expectation this way. */
  rationale: string;
  site: SiteSpec;
  offerings: string[];
  coverage?: Array<{ serviceId: string }>;
  existing?: Array<Partial<Opportunity> & { subject: string; ruleId: Opportunity["ruleId"] }>;
  expectOutcome: "findings" | "clean" | "inconclusive";
  expect: ExpectedOpportunity[];
}

const CONTACT_OK = { href: "/contact", label: "Contact us", foundOn: ["/"] };

export const CASES: BenchCase[] = [
  // -------------------------------------------------------------------------
  // Clean: the site already does what the business sells.
  // -------------------------------------------------------------------------
  {
    id: "clean-full-coverage",
    clientName: "Northgate Plumbing",
    what: "Every offering has its own page and every conversion path works.",
    rationale:
      "A trustworthy product must be able to say 'nothing to sell here'. Surfacing anything would be a pure false positive.",
    offerings: [
      "emergency plumber",
      "boiler installation",
      "bathroom fitting",
      "drain unblocking",
    ],
    site: {
      origin: "https://northgateplumbing.test",
      nav: [
        "Home",
        "Emergency Plumber",
        "Boiler Installation",
        "Bathroom Fitting",
        "Drain Unblocking",
        "Contact",
      ],
      pages: [
        { path: "/", title: "Northgate Plumbing | Leeds", h1s: ["Leeds plumbers, 24/7"] },
        { path: "/emergency-plumber", title: "Emergency Plumber in Leeds", h1s: ["Emergency Plumber"] },
        { path: "/boiler-installation", title: "Boiler Installation", h1s: ["Boiler Installation"] },
        { path: "/bathroom-fitting", title: "Bathroom Fitting", h1s: ["Bathroom Fitting"] },
        { path: "/drain-unblocking", title: "Drain Unblocking", h1s: ["Drain Unblocking"] },
        { path: "/contact", title: "Contact Northgate Plumbing", h1s: ["Contact us"] },
      ],
      links: [
        { href: "/emergency-plumber", label: "Emergency Plumber", inNav: true },
        { href: "/boiler-installation", label: "Boiler Installation", inNav: true },
        { href: "/bathroom-fitting", label: "Bathroom Fitting", inNav: true },
        { href: "/drain-unblocking", label: "Drain Unblocking", inNav: true },
        CONTACT_OK,
        { href: "tel:+441132960100", label: "Call us", scheme: "tel" as const, foundOn: ["/"] },
      ],
    },
    expectOutcome: "clean",
    expect: [],
  },

  // -------------------------------------------------------------------------
  // A genuine, sellable missing service page.
  // -------------------------------------------------------------------------
  {
    id: "missing-service-page",
    clientName: "Hartley Roofing",
    what: "Three of four offerings have pages; chimney repointing has none anywhere.",
    rationale:
      "The client demonstrably sells chimney repointing and the site never mentions it, in nav, in links, or in the sitemap. This is the flagship billable finding.",
    offerings: ["roof replacement", "flat roof repair", "gutter cleaning", "chimney repointing"],
    site: {
      origin: "https://hartleyroofing.test",
      nav: ["Home", "Roof Replacement", "Flat Roof Repair", "Gutter Cleaning", "About", "Contact"],
      pages: [
        { path: "/", title: "Hartley Roofing | Sheffield Roofers", h1s: ["Sheffield roofing specialists"] },
        { path: "/roof-replacement", title: "Roof Replacement in Sheffield", h1s: ["Roof Replacement"] },
        { path: "/flat-roof-repair", title: "Flat Roof Repair", h1s: ["Flat Roof Repair"] },
        { path: "/gutter-cleaning", title: "Gutter Cleaning", h1s: ["Gutter Cleaning"] },
        { path: "/about", title: "About Hartley Roofing", h1s: ["About us"] },
        { path: "/contact", title: "Contact Hartley Roofing", h1s: ["Contact us"] },
      ],
      links: [
        { href: "/roof-replacement", label: "Roof Replacement", inNav: true },
        { href: "/flat-roof-repair", label: "Flat Roof Repair", inNav: true },
        { href: "/gutter-cleaning", label: "Gutter Cleaning", inNav: true },
        CONTACT_OK,
      ],
      sitemapPaths: [
        "/",
        "/roof-replacement",
        "/flat-roof-repair",
        "/gutter-cleaning",
        "/about",
        "/contact",
      ],
    },
    expectOutcome: "findings",
    expect: [{ ruleId: "missing-service-page", subject: "chimney repointing" }],
  },

  // -------------------------------------------------------------------------
  // A genuine, sellable broken conversion path.
  // -------------------------------------------------------------------------
  {
    id: "broken-cta-404",
    clientName: "Meridian Dental",
    what: "Every offering has a page, but the site-wide booking CTA returns 404.",
    rationale:
      "A dead booking CTA on every page is lost revenue the owner can verify in one click. Definite HTTP 404, so no judgment is needed to establish it.",
    offerings: ["dental implants", "teeth whitening", "invisalign", "emergency dentist"],
    site: {
      origin: "https://meridiandental.test",
      nav: [
        "Home",
        "Dental Implants",
        "Teeth Whitening",
        "Invisalign",
        "Emergency Dentist",
        "Contact",
      ],
      pages: [
        { path: "/", title: "Meridian Dental | Bristol", h1s: ["Your Bristol dentist"] },
        { path: "/dental-implants", title: "Dental Implants", h1s: ["Dental Implants"] },
        { path: "/teeth-whitening", title: "Teeth Whitening", h1s: ["Teeth Whitening"] },
        { path: "/invisalign", title: "Invisalign Clear Aligners", h1s: ["Invisalign"] },
        { path: "/emergency-dentist", title: "Emergency Dentist Bristol", h1s: ["Emergency Dentist"] },
        { path: "/contact", title: "Contact Meridian Dental", h1s: ["Contact us"] },
        { path: "/book-online", status: 404, title: "Not found", words: 0, crawled: false },
      ],
      links: [
        { href: "/dental-implants", label: "Dental Implants", inNav: true },
        { href: "/teeth-whitening", label: "Teeth Whitening", inNav: true },
        { href: "/invisalign", label: "Invisalign", inNav: true },
        { href: "/emergency-dentist", label: "Emergency Dentist", inNav: true },
        CONTACT_OK,
        {
          href: "/book-online",
          label: "Book an appointment",
          foundOn: ["/", "/dental-implants", "/teeth-whitening", "/invisalign"],
        },
      ],
    },
    expectOutcome: "findings",
    expect: [{ ruleId: "broken-conversion-path", subject: "book-online" }],
  },

  // -------------------------------------------------------------------------
  // False-positive traps. Every one of these MUST surface nothing.
  // -------------------------------------------------------------------------
  {
    id: "near-miss-not-a-gap",
    clientName: "Ridgeway Landscaping",
    what: "Offerings are covered by differently worded pages, an uncrawled sitemap URL, and an unlinkable nav label.",
    rationale:
      "Each offering has a plausible existing home. Claiming any of them is missing would embarrass the agency in front of their client, which is the worst failure this product can have.",
    offerings: [
      "garden design",
      "artificial grass installation",
      "driveway paving",
      "pond installation",
    ],
    site: {
      origin: "https://ridgewaylandscaping.test",
      // "Ponds" is a nav LABEL with no link: an existence signal that cannot be
      // verified, so absence must not be claimed.
      nav: ["Home", "Garden Design", "Artificial Grass", "Driveways", "Ponds", "Contact"],
      pages: [
        { path: "/", title: "Ridgeway Landscaping | Surrey", h1s: ["Surrey garden specialists"] },
        { path: "/garden-design", title: "Garden Design & Planting Plans", h1s: ["Garden Design"] },
        { path: "/driveways", title: "Driveways", h1s: ["Driveways"], crawled: false },
        {
          path: "/services/artificial-grass",
          title: "Artificial Grass",
          h1s: ["Artificial Grass Installation"],
          crawled: false,
        },
        { path: "/contact", title: "Contact Ridgeway", h1s: ["Contact us"] },
      ],
      links: [
        { href: "/garden-design", label: "Garden Design", inNav: true },
        { href: "/driveways", label: "Driveways", inNav: true },
        CONTACT_OK,
      ],
      sitemapPaths: ["/", "/garden-design", "/services/artificial-grass", "/driveways", "/contact"],
    },
    expectOutcome: "clean",
    expect: [],
  },

  {
    id: "cta-probe-inconclusive",
    clientName: "Pinewood Clinic",
    what: "The booking CTA target answers a bot challenge, so no trustworthy status is obtained.",
    rationale:
      "403, bot-challenge and timeout are not evidence of breakage. Surfacing one would bill a client for a defect that does not exist.",
    offerings: ["physiotherapy", "sports massage", "podiatry"],
    site: {
      origin: "https://pinewoodclinic.test",
      nav: ["Home", "Physiotherapy", "Sports Massage", "Podiatry", "Contact"],
      probeInconclusive: true,
      pages: [
        { path: "/", title: "Pinewood Clinic", h1s: ["Pinewood Clinic"] },
        { path: "/physiotherapy", title: "Physiotherapy", h1s: ["Physiotherapy"] },
        { path: "/sports-massage", title: "Sports Massage", h1s: ["Sports Massage"] },
        { path: "/podiatry", title: "Podiatry", h1s: ["Podiatry"] },
        { path: "/contact", title: "Contact Pinewood Clinic", h1s: ["Contact us"] },
      ],
      links: [
        { href: "/physiotherapy", label: "Physiotherapy", inNav: true },
        { href: "/sports-massage", label: "Sports Massage", inNav: true },
        { href: "/podiatry", label: "Podiatry", inNav: true },
        CONTACT_OK,
        { href: "/book-appointment", label: "Book an appointment", foundOn: ["/", "/physiotherapy"] },
      ],
    },
    expectOutcome: "clean",
    expect: [],
  },

  {
    id: "js-handled-form",
    clientName: "Whitfield Fitness",
    what: "The enquiry form has an empty-hash action and is handled in JavaScript.",
    rationale:
      "A '#' or empty action cannot be verified from the outside. Calling it broken would be a guess dressed as evidence.",
    offerings: ["personal training", "group classes", "nutrition coaching"],
    site: {
      origin: "https://whitfieldfitness.test",
      nav: ["Home", "Personal Training", "Group Classes", "Nutrition Coaching", "Contact"],
      pages: [
        { path: "/", title: "Whitfield Fitness", h1s: ["Whitfield Fitness"] },
        { path: "/personal-training", title: "Personal Training", h1s: ["Personal Training"] },
        { path: "/group-classes", title: "Group Classes", h1s: ["Group Classes"] },
        { path: "/nutrition-coaching", title: "Nutrition Coaching", h1s: ["Nutrition Coaching"] },
        {
          path: "/contact",
          title: "Contact Whitfield Fitness",
          h1s: ["Contact us"],
          forms: [{ action: "#", method: "POST" as const, hasSubmit: true }],
        },
      ],
      links: [
        { href: "/personal-training", label: "Personal Training", inNav: true },
        { href: "/group-classes", label: "Group Classes", inNav: true },
        { href: "/nutrition-coaching", label: "Nutrition Coaching", inNav: true },
        CONTACT_OK,
      ],
    },
    expectOutcome: "clean",
    expect: [],
  },

  // -------------------------------------------------------------------------
  // Suppression paths.
  // -------------------------------------------------------------------------
  {
    id: "covered-by-contract",
    clientName: "Brookside Vets",
    what: "A real missing service page, but the agency's page service is already on retainer.",
    rationale:
      "Work the agency is already paid for is not an upsell. It must never appear as billable pipeline value.",
    offerings: ["small animal surgery", "pet vaccinations", "equine dentistry"],
    coverage: [{ serviceId: "svc-landing-page" }],
    site: {
      origin: "https://brooksidevets.test",
      nav: ["Home", "Small Animal Surgery", "Pet Vaccinations", "Contact"],
      pages: [
        { path: "/", title: "Brookside Vets", h1s: ["Brookside Vets"] },
        { path: "/small-animal-surgery", title: "Small Animal Surgery", h1s: ["Small Animal Surgery"] },
        { path: "/pet-vaccinations", title: "Pet Vaccinations", h1s: ["Pet Vaccinations"] },
        { path: "/contact", title: "Contact Brookside Vets", h1s: ["Contact us"] },
      ],
      links: [
        { href: "/small-animal-surgery", label: "Small Animal Surgery", inNav: true },
        { href: "/pet-vaccinations", label: "Pet Vaccinations", inNav: true },
        CONTACT_OK,
      ],
      sitemapPaths: ["/", "/small-animal-surgery", "/pet-vaccinations", "/contact"],
    },
    expectOutcome: "clean",
    expect: [],
  },

  {
    id: "dismissed-stays-dismissed",
    clientName: "Alderman Legal",
    what: "The same gap as a previous run, already dismissed by the agency.",
    rationale:
      "A re-run must not re-nag. The agency's decision outranks the engine until they reopen it.",
    offerings: ["conveyancing", "wills and probate", "employment law"],
    existing: [
      { ruleId: "missing-service-page", subject: "employment law", status: "dismissed" },
    ],
    site: {
      origin: "https://aldermanlegal.test",
      nav: ["Home", "Conveyancing", "Wills and Probate", "Contact"],
      pages: [
        { path: "/", title: "Alderman Legal", h1s: ["Alderman Legal"] },
        { path: "/conveyancing", title: "Conveyancing", h1s: ["Conveyancing"] },
        { path: "/wills-and-probate", title: "Wills and Probate", h1s: ["Wills and Probate"] },
        { path: "/contact", title: "Contact Alderman Legal", h1s: ["Contact us"] },
      ],
      links: [
        { href: "/conveyancing", label: "Conveyancing", inNav: true },
        { href: "/wills-and-probate", label: "Wills and Probate", inNav: true },
        CONTACT_OK,
      ],
      sitemapPaths: ["/", "/conveyancing", "/wills-and-probate", "/contact"],
    },
    expectOutcome: "clean",
    expect: [],
  },

  // -------------------------------------------------------------------------
  // Inconclusive paths, the product's honesty guarantee.
  // -------------------------------------------------------------------------
  {
    id: "blocked-network",
    clientName: "Copperfield Joinery",
    what: "Every request to the domain was refused by the URL policy.",
    rationale:
      "Nothing was read, so nothing may be claimed: not a gap, and not a clean bill of health.",
    offerings: ["fitted wardrobes", "staircases", "bespoke kitchens"],
    site: {
      origin: "https://copperfieldjoinery.test",
      pages: [],
      blockedPaths: ["/"],
    },
    expectOutcome: "inconclusive",
    expect: [],
  },

  {
    id: "service-section-never-reached",
    clientName: "Larkspur Interiors",
    what: "Only the home, about and contact pages were readable.",
    rationale:
      "The crawl never reached the service section, so 'this offering has no page' is unprovable.",
    offerings: ["interior design", "curtains and blinds", "furniture sourcing"],
    site: {
      origin: "https://larkspurinteriors.test",
      nav: ["Home", "About", "Contact"],
      pages: [
        { path: "/", title: "Larkspur Interiors", h1s: ["Larkspur Interiors"] },
        { path: "/about", title: "About Larkspur", h1s: ["About us"] },
        { path: "/contact", title: "Contact Larkspur", h1s: ["Contact us"] },
      ],
      links: [CONTACT_OK],
    },
    expectOutcome: "inconclusive",
    expect: [],
  },

  {
    id: "verification-fetch-blocked",
    clientName: "Sandbourne Removals",
    what: "One offering has a near-match page the crawler was refused; another has nothing at all.",
    rationale:
      "'packing service' has a /packing link we could not read, so absence is unproven and must not be claimed. 'storage' has no page, link, nav entry or sitemap URL anywhere, so it is a genuine gap. A blocked fetch on one offering must not suppress a clean finding on another.",
    offerings: ["house removals", "office relocation", "packing service", "storage"],
    site: {
      origin: "https://sandbourneremovals.test",
      nav: ["Home", "House Removals", "Office Relocation", "Packing", "Contact"],
      fetchFailure: { outcome: "inconclusive", reason: "Connection reset during targeted fetch." },
      pages: [
        { path: "/", title: "Sandbourne Removals", h1s: ["Sandbourne Removals"] },
        { path: "/house-removals", title: "House Removals", h1s: ["House Removals"] },
        { path: "/office-relocation", title: "Office Relocation", h1s: ["Office Relocation"] },
        { path: "/contact", title: "Contact Sandbourne", h1s: ["Contact us"] },
        { path: "/packing", title: "Packing", h1s: ["Packing"], crawled: false },
      ],
      links: [
        { href: "/house-removals", label: "House Removals", inNav: true },
        { href: "/office-relocation", label: "Office Relocation", inNav: true },
        { href: "/packing", label: "Packing", inNav: true },
        CONTACT_OK,
      ],
    },
    expectOutcome: "findings",
    expect: [{ ruleId: "missing-service-page", subject: "storage" }],
  },

  // -------------------------------------------------------------------------
  // Definite defects whose evidence is thin in page count but not in substance.
  // -------------------------------------------------------------------------
  {
    id: "malformed-tel-single-page",
    clientName: "Halden Motors",
    what: "The only click-to-call link on the site has an undialable href.",
    rationale:
      "The href is provably not a phone number. Whether the same broken link happens to appear on one page or five changes nothing about the defect, so it must surface either way.",
    offerings: ["mot testing", "car servicing", "clutch replacement", "diagnostics"],
    site: {
      origin: "https://haldenmotors.test",
      nav: [
        "Home",
        "MOT Testing",
        "Car Servicing",
        "Clutch Replacement",
        "Diagnostics",
        "Contact",
      ],
      pages: [
        { path: "/", title: "Halden Motors", h1s: ["Halden Motors"] },
        { path: "/mot-testing", title: "MOT Testing", h1s: ["MOT Testing"] },
        { path: "/car-servicing", title: "Car Servicing", h1s: ["Car Servicing"] },
        { path: "/clutch-replacement", title: "Clutch Replacement", h1s: ["Clutch Replacement"] },
        { path: "/diagnostics", title: "Diagnostics", h1s: ["Diagnostics"] },
        { path: "/contact", title: "Contact Halden Motors", h1s: ["Contact us"] },
      ],
      links: [
        { href: "/mot-testing", label: "MOT Testing", inNav: true },
        { href: "/car-servicing", label: "Car Servicing", inNav: true },
        { href: "/clutch-replacement", label: "Clutch Replacement", inNav: true },
        { href: "/diagnostics", label: "Diagnostics", inNav: true },
        CONTACT_OK,
        {
          href: "tel:call us today",
          label: "Call us",
          scheme: "tel" as const,
          foundOn: ["/contact"],
        },
      ],
    },
    expectOutcome: "findings",
    expect: [{ ruleId: "broken-conversion-path", subject: "malformed-tel" }],
  },

  {
    id: "placeholder-form-action",
    clientName: "Everly Photography",
    what: "The enquiry form posts to an unconfigured form-service placeholder.",
    rationale:
      "The action is a template default, so every enquiry submitted through it is lost. No probe is needed, the value itself is the proof.",
    offerings: ["wedding photography", "family portraits", "commercial photography"],
    site: {
      origin: "https://everlyphotography.test",
      nav: [
        "Home",
        "Wedding Photography",
        "Family Portraits",
        "Commercial Photography",
        "Contact",
      ],
      pages: [
        { path: "/", title: "Everly Photography", h1s: ["Everly Photography"] },
        { path: "/wedding-photography", title: "Wedding Photography", h1s: ["Wedding Photography"] },
        { path: "/family-portraits", title: "Family Portraits", h1s: ["Family Portraits"] },
        {
          path: "/commercial-photography",
          title: "Commercial Photography",
          h1s: ["Commercial Photography"],
        },
        {
          path: "/contact",
          title: "Contact Everly Photography",
          h1s: ["Contact us"],
          forms: [{ action: "https://formspree.io/f/xxxxxxxx", method: "POST" as const, hasSubmit: true }],
        },
      ],
      links: [
        { href: "/wedding-photography", label: "Wedding Photography", inNav: true },
        { href: "/family-portraits", label: "Family Portraits", inNav: true },
        { href: "/commercial-photography", label: "Commercial Photography", inNav: true },
        CONTACT_OK,
      ],
    },
    expectOutcome: "findings",
    expect: [{ ruleId: "broken-conversion-path", subject: "formspree" }],
  },
];

export function clientIdOf(c: BenchCase): string {
  return "bench-" + c.id;
}

export function clientOf(c: BenchCase) {
  return clientFor({
    id: clientIdOf(c),
    name: c.clientName,
    origin: c.site.origin,
    offerings: c.offerings,
  });
}

export function coverageOf(c: BenchCase): Coverage[] {
  return (c.coverage ?? []).map((entry) => ({
    clientId: clientIdOf(c),
    serviceId: entry.serviceId,
    covered: true as const,
  }));
}
