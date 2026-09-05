import type { Candidate } from "@/core/schema";
import type { RuleContext } from "@/core/rules/context";
import { serviceForRule } from "@/core/rules/registry";
import {
  isReadablePage,
  isStructuredDataRelevantPage,
  pageCandidate,
  uniquePages,
} from "@/core/rules/technical";

const TAG = "missing-structured-data";

const LOCAL_BUSINESS_SUBTYPES = new Set([
  "accountingservice",
  "attorney",
  "autoservice",
  "bakery",
  "barorpub",
  "beautysalon",
  "cafeorcoffeeshop",
  "dentist",
  "electrician",
  "fastfoodrestaurant",
  "generalcontractor",
  "hairsalon",
  "hvacbusiness",
  "icecreamshop",
  "locksmith",
  "medicalclinic",
  "medicalbusiness",
  "medicalorganization",
  "movingcompany",
  "nailsalon",
  "pharmacy",
  "physician",
  "plumber",
  "realestateagent",
  "restaurant",
  "roofingcontractor",
  "store",
  "tattooparlor",
  "travelagency",
]);

function isLocalBusinessOrServiceType(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/schema\.org\//, "")
    .replace(/^schema:/, "");
  if (normalized === "service" || normalized === "localbusiness") return true;
  if (normalized.endsWith("localbusiness") || normalized.endsWith("business")) return true;

  // Schema.org LocalBusiness subclasses that do not carry "Business" in the
  // type name. Keeping this list explicit avoids treating arbitrary JSON-LD as
  // proof that a local business schema is present.
  return LOCAL_BUSINESS_SUBTYPES.has(normalized);
}

/** Reports relevant pages with an observed absence of LocalBusiness or Service data. */
export async function missingStructuredDataRule(ctx: RuleContext): Promise<Candidate[]> {
  const service = serviceForRule(ctx.catalog, TAG);
  if (!service) return [];

  return uniquePages(ctx.evidence.site.pages)
    .filter(
      (page) =>
        isReadablePage(page) &&
        isStructuredDataRelevantPage(page) &&
        page.structuredDataTypes !== undefined &&
        (page.structuredDataPresent ?? page.structuredDataTypes.length > 0) === false &&
        !page.structuredDataTypes.some(isLocalBusinessOrServiceType),
    )
    .map((page) =>
      pageCandidate({
        ruleId: "missing-structured-data",
        subject: page.url,
        detected:
          `The page ${page.url} has no observed LocalBusiness or Service structured-data type.`,
        evidenceRefs: [`page:${page.url}`, "structured-data:localbusiness-or-service-missing"],
        suggestedServiceId: service.id,
      }),
    );
}
