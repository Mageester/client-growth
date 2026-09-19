// src/core/rules/registry.ts
var RULE_SERVICE_LINKS = [
  {
    ruleId: "visual-conversion-opportunity",
    tier: "commercial",
    tag: "visual-review",
    label: "A visual or customer journey improvement",
    hint: "Review desktop and mobile captures for substantial work that helps visitors understand, choose, and enquire."
  },
  {
    ruleId: "missing-service-page",
    tier: "commercial",
    tag: "landing-page",
    label: "A missing service page",
    hint: "Sell this when a client offers something their website never gives its own page."
  },
  {
    ruleId: "no-service-pages",
    tier: "commercial",
    tag: "service-pages-build",
    label: "A site with no service pages at all",
    hint: "Sell this when a client's whole website never describes anything they sell \u2014 the work is a set of pages, not one."
  },
  {
    ruleId: "competitor-service-gap",
    tier: "commercial",
    tag: "competitor-gap",
    label: "A service the competition sells and this client does not",
    hint: "Sell this when two or more of the client's named competitors have a page for something the client has no page for."
  },
  {
    ruleId: "broken-conversion-path",
    tier: "commercial",
    tag: "conversion-fix",
    label: "A broken conversion path",
    hint: "Sell this when a call-to-action, form or phone link on the site is broken."
  },
  {
    ruleId: "missing-title",
    tier: "health",
    tag: "missing-title",
    label: "Repair a missing page title",
    hint: "Sell this when a readable page has no non-empty HTML title."
  },
  {
    ruleId: "duplicate-title",
    tier: "health",
    tag: "duplicate-title",
    label: "Repair duplicate page titles",
    hint: "Sell this when two or more readable pages expose the same title text."
  },
  {
    ruleId: "thin-service-page",
    tier: "health",
    tag: "thin-service-page",
    label: "Expand a thin service page",
    hint: "Sell this when a service-shaped page contains very little readable body text."
  },
  {
    ruleId: "missing-h1",
    tier: "health",
    tag: "missing-h1",
    label: "Repair a missing H1",
    hint: "Sell this when a readable page has no non-empty H1 heading."
  },
  {
    ruleId: "broken-internal-link",
    tier: "health",
    tag: "broken-internal-link",
    label: "Repair a broken internal link",
    hint: "Sell this when a same-site link is verified to return HTTP 404 or 410."
  },
  {
    ruleId: "missing-meta-description",
    tier: "health",
    tag: "missing-meta-description",
    label: "Repair a missing meta description",
    hint: "Sell this when a readable page has no non-empty meta description."
  },
  {
    ruleId: "missing-structured-data",
    tier: "health",
    tag: "missing-structured-data",
    label: "Add LocalBusiness or Service schema",
    hint: "Sell this when a readable page has no observed LocalBusiness or Service structured-data type."
  },
  {
    ruleId: "missing-image-alt",
    tier: "health",
    tag: "missing-image-alt",
    label: "Add missing image alt attributes",
    hint: 'Sell this when an image has no alt attribute; decorative alt="" is left alone.'
  }
];
var TIER_BY_RULE = new Map(
  RULE_SERVICE_LINKS.map((link) => [link.ruleId, link.tier])
);
function tierForRule(ruleId) {
  return TIER_BY_RULE.get(ruleId) ?? "health";
}
__name(tierForRule, "tierForRule");
function isCommercialRule(ruleId) {
  return tierForRule(ruleId) === "commercial";
}
__name(isCommercialRule, "isCommercialRule");
var AUTOMATIC_ADJACENT_CAPABILITY_TAGS = {
  "landing-page": ["service-pages-build"],
  "competitor-gap": ["landing-page", "service-pages-build"],
  "thin-service-page": ["landing-page", "service-pages-build"]
};
function matchServiceForRule(catalog, tag2) {
  const active = catalog.filter((service) => service.active);
  const direct = active.find((service) => service.tags.includes(tag2));
  if (direct) return { service: direct, state: "direct" };
  const adjacentTags = AUTOMATIC_ADJACENT_CAPABILITY_TAGS[tag2] ?? [];
  const adjacent = active.find(
    (service) => adjacentTags.some((candidate) => service.tags.includes(candidate))
  );
  return adjacent ? { service: adjacent, state: "adjacent" } : null;
}
__name(matchServiceForRule, "matchServiceForRule");
function serviceForRule(catalog, tag2) {
  return matchServiceForRule(catalog, tag2)?.service ?? null;
}
__name(serviceForRule, "serviceForRule");
function assessCatalogCoverage(catalog) {
  const rules = RULE_SERVICE_LINKS.map((link) => {
    const match = matchServiceForRule(catalog, link.tag);
    return {
      ...link,
      serviceId: match?.service.id ?? null,
      matchState: match?.state ?? null
    };
  });
  return {
    rules,
    matched: rules.filter((r) => r.serviceId !== null).length,
    total: rules.length,
    unmatchedLabels: rules.filter((r) => r.serviceId === null).map((r) => r.label),
    adjacentLabels: rules.filter((r) => r.matchState === "adjacent").map((r) => r.label)
  };
}
__name(assessCatalogCoverage, "assessCatalogCoverage");
