import { ServiceSchema, type Service } from "@/core/schema";

/**
 * A realistic small web/digital agency catalog, used only by the engine
 * benchmark. Prices are the ones a UK/CA-sized shop would actually quote.
 *
 * Three of these five services are reachable by today's engine, one per rule.
 * The other two are deliberately kept in the catalog and left unmatched: a real
 * agency sells more than the engine can detect, and the benchmark should
 * reflect that rather than pretending the catalog is fully covered.
 * `UNREACHABLE_SERVICE_IDS` is asserted on, so adding a rule without updating
 * this file fails loudly.
 */
export const AGENCY_SERVICES: Service[] = [
  {
    id: "svc-landing-page",
    name: "Dedicated service page",
    description:
      "A dedicated, conversion-focused page for one service line: research, copy, on-page SEO and a single lead-capture call to action.",
    priceMin: 900,
    priceMax: 1800,
    tags: ["landing-page"],
    active: true,
  },
  {
    id: "svc-conversion-fix",
    name: "Conversion-path repair",
    description:
      "Diagnose and repair a broken conversion element — a dead call to action, a form that submits nowhere, an undialable phone link — and re-test the path end to end.",
    priceMin: 300,
    priceMax: 1000,
    tags: ["conversion-fix"],
    active: true,
  },
  {
    id: "svc-service-pages-build",
    name: "Service pages build",
    description:
      "A set of service pages for a business whose website describes nothing it sells: one page per service line, with copy, on-page SEO and a lead-capture call to action on each.",
    priceMin: 2500,
    priceMax: 6000,
    tags: ["service-pages-build"],
    active: true,
  },
  {
    id: "svc-analytics",
    name: "Analytics / conversion tracking setup",
    description:
      "Server-side and client-side conversion tracking, goal configuration and a reporting view the owner can actually read.",
    priceMin: 400,
    priceMax: 1200,
    tags: [],
    active: true,
  },
  {
    id: "svc-location-page",
    name: "Local service-location page",
    description:
      "A location-targeted page for one service area: local proof, schema markup and internal linking from the service pages.",
    priceMin: 700,
    priceMax: 1500,
    tags: [],
    active: true,
  },
].map((s) => ServiceSchema.parse(s));

/** Services no current rule can ever match. Asserted, not assumed. */
export const UNREACHABLE_SERVICE_IDS = ["svc-analytics", "svc-location-page"] as const;

export function agencyCatalog(): Service[] {
  return AGENCY_SERVICES.map((s) => ServiceSchema.parse(s));
}
