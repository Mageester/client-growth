// src/core/rules/missingStructuredData.ts
var LOCAL_BUSINESS_SUBTYPES = /* @__PURE__ */ new Set([
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
  "travelagency"
]);
function isLocalBusinessOrServiceType(value) {
  const normalized3 = value.trim().toLowerCase().replace(/^https?:\/\/schema\.org\//, "").replace(/^schema:/, "");
  if (normalized3 === "service" || normalized3 === "localbusiness") return true;
  if (normalized3.endsWith("localbusiness") || normalized3.endsWith("business")) return true;
  return LOCAL_BUSINESS_SUBTYPES.has(normalized3);
}
__name(isLocalBusinessOrServiceType, "isLocalBusinessOrServiceType");
async function detectMissingStructuredDataDiagnostic(ctx) {
  return uniquePages(ctx.evidence.site.pages).filter(
    (page) => isReadablePage(page) && isStructuredDataRelevantPage(page) && page.structuredDataTypes !== void 0 && (page.structuredDataPresent ?? page.structuredDataTypes.length > 0) === false && !page.structuredDataTypes.some(isLocalBusinessOrServiceType)
  ).map(
    (page) => legacyDiagnosticDraft({
      detectorId: "missing-structured-data",
      problemType: "missing_business_schema",
      subject: { kind: "page", key: page.url },
      observation: `The page ${page.url} has no observed LocalBusiness or Service structured-data type.`,
      legacyEvidenceRefs: [
        `page:${page.url}`,
        "structured-data:localbusiness-or-service-missing"
      ]
    })
  );
}
__name(detectMissingStructuredDataDiagnostic, "detectMissingStructuredDataDiagnostic");
