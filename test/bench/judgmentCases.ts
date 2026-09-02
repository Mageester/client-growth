import type { BenchCase } from "./cases";

/**
 * Cases where the deterministic evidence is technically sufficient to build a
 * candidate, but whether an agency should actually pitch it is a commercial
 * call rather than a factual one.
 *
 * This is the set that measures what an evaluator is FOR. MockEvaluator
 * surfaces every candidate it is handed, so against these it can only ever
 * score as well as the rules themselves do. They are kept separate from CASES
 * so the core scorecard stays a clean measure of the deterministic engine.
 */

const CONTACT_OK = { href: "/contact", label: "Contact us", foundOn: ["/"] };

export const JUDGMENT_CASES: BenchCase[] = [
  {
    id: "marketing-claims-as-offerings",
    clientName: "Fairhaven Electrical",
    what: "The offerings box contains trust claims alongside real service lines.",
    rationale:
      "'Free quotes' and 'fully insured' are things the business says, not things it sells. A dedicated $900-$1,800 landing page for 'Fully Insured' is the kind of pitch that ends a client relationship. Only the genuine missing service line should surface.",
    offerings: [
      "consumer unit upgrades",
      "ev charger installation",
      "free quotes",
      "fully insured",
    ],
    site: {
      origin: "https://fairhavenelectrical.test",
      nav: ["Home", "Consumer Unit Upgrades", "Our Services", "What We Do", "Contact"],
      pages: [
        { path: "/", title: "Fairhaven Electrical", h1s: ["Fairhaven Electrical"] },
        { path: "/services", title: "Our Services", h1s: ["Our Services"] },
        { path: "/what-we-do", title: "What We Do", h1s: ["What We Do"] },
        {
          path: "/consumer-unit-upgrades",
          title: "Consumer Unit Upgrades",
          h1s: ["Consumer Unit Upgrades"],
        },
        { path: "/contact", title: "Contact Fairhaven", h1s: ["Contact us"] },
      ],
      links: [
        { href: "/services", label: "Our Services", inNav: true },
        { href: "/what-we-do", label: "What We Do", inNav: true },
        { href: "/consumer-unit-upgrades", label: "Consumer Unit Upgrades", inNav: true },
        CONTACT_OK,
      ],
    },
    expectOutcome: "findings",
    expect: [{ ruleId: "missing-service-page", subject: "ev charger installation" }],
  },

  {
    id: "high-intent-variant-of-existing-page",
    clientName: "Kelsey Heating",
    what: "An emergency variant of a service that already has a general page.",
    rationale:
      "A general boiler-repair page exists, so this is a judgment call rather than a plain gap. It is still defensible work: emergency intent converts differently and is worth its own page, and the agency can show the client the existing page and the missing variant side by side. Surfacing it is correct.",
    offerings: [
      "boiler repair",
      "boiler servicing",
      "boiler installation",
      "emergency boiler repair",
    ],
    site: {
      origin: "https://kelseyheating.test",
      nav: ["Home", "Boiler Repair", "Boiler Servicing", "Boiler Installation", "Contact"],
      pages: [
        { path: "/", title: "Kelsey Heating", h1s: ["Kelsey Heating"] },
        { path: "/boiler-repair", title: "Boiler Repair", h1s: ["Boiler Repair"] },
        { path: "/boiler-servicing", title: "Boiler Servicing", h1s: ["Boiler Servicing"] },
        { path: "/boiler-installation", title: "Boiler Installation", h1s: ["Boiler Installation"] },
        { path: "/contact", title: "Contact Kelsey Heating", h1s: ["Contact us"] },
      ],
      links: [
        { href: "/boiler-repair", label: "Boiler Repair", inNav: true },
        { href: "/boiler-servicing", label: "Boiler Servicing", inNav: true },
        { href: "/boiler-installation", label: "Boiler Installation", inNav: true },
        CONTACT_OK,
      ],
    },
    expectOutcome: "findings",
    expect: [{ ruleId: "missing-service-page", subject: "emergency boiler repair" }],
  },

  {
    id: "stale-duplicate-contact-link",
    clientName: "Orrell Accountancy",
    what: "A stale footer link returns 404 while the main contact path works fine.",
    rationale:
      "A dead link on a conversion path is a real defect and the client should be told. It is small work, and the service price range already starts low enough to quote it honestly — the alternative, staying silent about a 404 a visitor can hit, is worse. Surfacing it is correct.",
    offerings: ["self assessment", "payroll services", "bookkeeping"],
    site: {
      origin: "https://orrellaccountancy.test",
      nav: ["Home", "Self Assessment", "Payroll Services", "Bookkeeping", "Contact"],
      pages: [
        { path: "/", title: "Orrell Accountancy", h1s: ["Orrell Accountancy"] },
        { path: "/self-assessment", title: "Self Assessment", h1s: ["Self Assessment"] },
        { path: "/payroll-services", title: "Payroll Services", h1s: ["Payroll Services"] },
        { path: "/bookkeeping", title: "Bookkeeping", h1s: ["Bookkeeping"] },
        { path: "/contact", title: "Contact Orrell", h1s: ["Contact us"] },
        { path: "/contact-us", status: 404, title: "Not found", words: 0, crawled: false },
      ],
      links: [
        { href: "/self-assessment", label: "Self Assessment", inNav: true },
        { href: "/payroll-services", label: "Payroll Services", inNav: true },
        { href: "/bookkeeping", label: "Bookkeeping", inNav: true },
        CONTACT_OK,
        { href: "/contact-us", label: "Get in touch", foundOn: ["/bookkeeping"] },
      ],
    },
    expectOutcome: "findings",
    expect: [{ ruleId: "broken-conversion-path", subject: "contact-us" }],
  },
];
