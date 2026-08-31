import { ServiceSchema, type Service } from "../../src/core/schema";

/** A realistic small web/digital agency catalog for the validation study. */
export const CATALOG: Service[] = [
  {
    id: "svc-landing-page",
    name: "Service Landing Page",
    description:
      "Design and build a dedicated, conversion-focused landing page for one service line: copy, on-page SEO, and a primary lead-capture call to action.",
    priceMin: 900,
    priceMax: 1800,
    tags: ["landing-page"],
    active: true,
  },
  {
    id: "svc-local-seo",
    name: "Local SEO Retainer",
    description: "Ongoing local SEO: GBP, citations, on-page, content.",
    priceMin: 600,
    priceMax: 2000,
    tags: ["seo", "retainer"],
    active: true,
  },
  {
    id: "svc-site-refresh",
    name: "Website Refresh",
    description: "Full redesign and rebuild of an ageing marketing site.",
    priceMin: 3500,
    priceMax: 9000,
    tags: ["web-design"],
    active: true,
  },
  {
    id: "svc-booking",
    name: "Online Booking Integration",
    description: "Add online scheduling / quote-request booking to the site.",
    priceMin: 1200,
    priceMax: 3000,
    tags: ["booking", "cro"],
    active: true,
  },
  {
    id: "svc-content",
    name: "Content / Blog Package",
    description: "Monthly SEO content production.",
    priceMin: 500,
    priceMax: 1500,
    tags: ["content"],
    active: true,
  },
].map((s) => ServiceSchema.parse(s));
