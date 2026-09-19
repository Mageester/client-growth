// src/core/insightTaxonomy.ts
var INSIGHT_CATEGORIES = [
  "service_discovery",
  "buyer_journey",
  "conversion",
  "positioning_offer",
  "trust_proof",
  "experience",
  "accessibility_usability",
  "local_market",
  "technical_reliability",
  "content_freshness"
];
var InsightCategorySchema = external_exports.enum(INSIGHT_CATEGORIES);
var INSIGHT_PROBLEM_TYPES = [
  "visual_conversion_obstacle",
  "missing_service_path",
  "no_service_section",
  "broken_conversion_path",
  "competitor_service_gap",
  "missing_page_title",
  "duplicate_page_title",
  "thin_service_content",
  "missing_primary_heading",
  "broken_internal_link",
  "missing_meta_description",
  "missing_business_schema",
  "missing_image_text_alternative",
  "obscured_conversion_action",
  "form_friction",
  "form_accessibility_failure",
  "missing_accessible_name",
  "small_rendered_target",
  "inconsistent_contact_fact",
  "resource_failure",
  "console_error",
  "measured_performance_regression",
  "stale_business_fact",
  "rendered_experience_failure",
  "conflicting_action",
  /**
   * Semantic subtypes. These describe conditions a deterministic sensor did not
   * observe, which a language model can read directly from cited evidence:
   * production template copy, unreplaced platform defaults, content attached to
   * the wrong item, an action with no target, and a value that contradicts its
   * own action target or another page's value for the same fact.
   *
   * They carry no `legacyRuleId`, so they can never be priced from a catalog
   * mapping alone — but they are findings regardless of what the agency sells.
   */
  "placeholder_production_content",
  "unreplaced_platform_default",
  "mismatched_item_content",
  "dead_action_target",
  "field_value_mismatch",
  "inconsistent_content_fact"
];
var ProblemTypeSchema = external_exports.enum(INSIGHT_PROBLEM_TYPES);
var MODEL_ANCHORED_PROBLEM_TYPES = /* @__PURE__ */ new Set([
  "placeholder_production_content",
  "unreplaced_platform_default",
  "mismatched_item_content",
  "dead_action_target",
  "field_value_mismatch",
  "inconsistent_content_fact"
]);
var OFFERING_PROVENANCE_CLASSES = [
  /** The crawl read the offering's own words on the site. */
  "SITE_OBSERVED",
  /** The agency's catalog lists the offering as sellable. */
  "CATALOG",
  /** The offering exists only because a person typed it into the client profile. */
  "CLIENT_PROFILE",
  /** A person asserted the offering outside the profile and catalog. */
  "USER_ASSERTED",
  /** Orbit derived the offering from other evidence rather than reading it. */
  "INFERRED"
];
var OfferingProvenanceClassSchema = external_exports.enum(OFFERING_PROVENANCE_CLASSES);
var SITE_GROUNDED_PROVENANCE = /* @__PURE__ */ new Set(["SITE_OBSERVED"]);
var EVIDENCE_GRADES = [
  "strong",
  "moderate",
  "limited",
  "insufficient"
];
var PROBLEM_PRIORITIES = ["A", "B", "C", "D"];
var ProblemPrioritySchema = external_exports.enum(PROBLEM_PRIORITIES);
var PROBLEM_PRIORITY_GUIDANCE = [
  "TIER A \u2014 obvious production or trust failure. Live template or placeholder copy, unreplaced platform defaults, default FAQ or booking content, primary navigation that does not reach what it names, wrong business identity, an action that cannot work at all. A visitor sees these as a broken or unfinished site.",
  "TIER B \u2014 conversion or business-critical failure. Service pages so thin they do not explain the offering, real contact or action mismatch, an unusable primary call to action, content attached to the wrong item.",
  "TIER C \u2014 high-value commercial gap. An important offered service with no meaningful representation, missing trust or proof content where the evidence supports the claim.",
  "TIER D \u2014 technical or SEO hygiene. Missing meta descriptions, structured-data gaps, minor accessibility issues. These are real and worth reporting, but they must never crowd a Tier A or Tier B condition out of a bounded result."
];
function policy(category, claimKind, minimumGrade, requiresCompleteCoverage = false, options) {
  return {
    category,
    claimKind,
    minimumGrade,
    requiresCompleteCoverage,
    requiresCounterEvidence: options.requiresCounterEvidence ?? (claimKind === "absence" || claimKind === "comparison" || claimKind === "supported_inference"),
    projectWorkstream: options.projectWorkstream,
    legacyRuleId: options.legacyRuleId,
    reconciliationPolicy: options.reconciliationPolicy ?? "condition_clears_with_current_evidence",
    description: options.description,
    priority: options.priority
  };
}
__name(policy, "policy");
var INSIGHT_DEFINITIONS = {
  visual_conversion_obstacle: policy(
    "experience",
    "supported_inference",
    "moderate",
    false,
    {
      projectWorkstream: "conversion",
      legacyRuleId: "visual-conversion-opportunity",
      description: "A rendered or visual condition sits on the path to a primary action and plausibly obstructs it.",
      priority: "B"
    }
  ),
  missing_service_path: policy(
    "service_discovery",
    "absence",
    "strong",
    true,
    {
      projectWorkstream: "service-visibility",
      legacyRuleId: "missing-service-page",
      description: "An offering the business states it provides has no dedicated page, navigation entry, link, or sitemap URL.",
      priority: "C"
    }
  ),
  no_service_section: policy(
    "service_discovery",
    "absence",
    "strong",
    true,
    {
      projectWorkstream: "service-visibility",
      legacyRuleId: "no-service-pages",
      description: "No readable page represents a service offering at all.",
      priority: "C"
    }
  ),
  broken_conversion_path: policy(
    "conversion",
    "measurement",
    "strong",
    false,
    {
      projectWorkstream: "conversion",
      legacyRuleId: "broken-conversion-path",
      description: "A primary action leads to a target that was requested and failed, so the action cannot complete.",
      priority: "B"
    }
  ),
  competitor_service_gap: policy(
    "local_market",
    "comparison",
    "strong",
    false,
    {
      projectWorkstream: "service-visibility",
      legacyRuleId: "competitor-service-gap",
      description: "A compared competitor represents a service this business does not.",
      priority: "C"
    }
  ),
  missing_page_title: policy(
    "technical_reliability",
    "presence",
    "strong",
    false,
    {
      projectWorkstream: "site-health",
      legacyRuleId: "missing-title",
      description: "A readable page supplies no document title.",
      priority: "D"
    }
  ),
  duplicate_page_title: policy(
    "technical_reliability",
    "comparison",
    "strong",
    false,
    {
      projectWorkstream: "site-health",
      legacyRuleId: "duplicate-title",
      description: "The same document title is reused across several distinct readable pages.",
      priority: "D"
    }
  ),
  thin_service_content: policy(
    "service_discovery",
    "measurement",
    "moderate",
    false,
    {
      projectWorkstream: "service-visibility",
      legacyRuleId: "thin-service-page",
      description: "A service page carries so little readable content that it does not explain the offering it names.",
      priority: "B"
    }
  ),
  missing_primary_heading: policy(
    "accessibility_usability",
    "presence",
    "strong",
    false,
    {
      projectWorkstream: "site-health",
      legacyRuleId: "missing-h1",
      description: "A readable page has no primary heading.",
      priority: "D"
    }
  ),
  broken_internal_link: policy(
    "technical_reliability",
    "measurement",
    "strong",
    false,
    {
      projectWorkstream: "site-health",
      legacyRuleId: "broken-internal-link",
      description: "A same-site link points at a target that was requested and failed to resolve.",
      priority: "B"
    }
  ),
  missing_meta_description: policy(
    "technical_reliability",
    "presence",
    "strong",
    false,
    {
      projectWorkstream: "site-health",
      legacyRuleId: "missing-meta-description",
      description: "A readable page supplies no non-empty meta description.",
      priority: "D"
    }
  ),
  missing_business_schema: policy(
    "technical_reliability",
    "presence",
    "strong",
    false,
    {
      projectWorkstream: "site-health",
      legacyRuleId: "missing-structured-data",
      description: "A relevant readable page carries no local-business or service structured data.",
      priority: "D"
    }
  ),
  missing_image_text_alternative: policy(
    "accessibility_usability",
    "presence",
    "strong",
    false,
    {
      projectWorkstream: "site-health",
      legacyRuleId: "missing-image-alt",
      description: "A readable page image has no text alternative.",
      priority: "D"
    }
  ),
  obscured_conversion_action: policy(
    "conversion",
    "measurement",
    "strong",
    false,
    {
      projectWorkstream: "conversion",
      legacyRuleId: null,
      description: "A primary action is measured as visually obscured or outside the visible region.",
      priority: "B"
    }
  ),
  form_friction: policy(
    "conversion",
    "measurement",
    "moderate",
    false,
    {
      projectWorkstream: "conversion",
      legacyRuleId: null,
      description: "A measured form structure adds avoidable friction. Structure only; no submission was attempted.",
      priority: "B"
    }
  ),
  form_accessibility_failure: policy(
    "accessibility_usability",
    "presence",
    "strong",
    false,
    {
      projectWorkstream: "accessibility",
      legacyRuleId: null,
      description: "A form control is observed without the accessible name or association it needs.",
      priority: "D"
    }
  ),
  missing_accessible_name: policy(
    "accessibility_usability",
    "presence",
    "strong",
    false,
    {
      projectWorkstream: "accessibility",
      legacyRuleId: null,
      description: "An interactive control is observed with no accessible name.",
      priority: "D"
    }
  ),
  small_rendered_target: policy(
    "accessibility_usability",
    "measurement",
    "strong",
    false,
    {
      projectWorkstream: "accessibility",
      legacyRuleId: null,
      description: "A measured interactive target is smaller than the observed usability threshold.",
      priority: "D"
    }
  ),
  inconsistent_contact_fact: policy(
    "local_market",
    "comparison",
    "strong",
    false,
    {
      projectWorkstream: "local-consistency",
      legacyRuleId: null,
      description: "Two owned pages state different values for the same contact fact.",
      priority: "B"
    }
  ),
  resource_failure: policy(
    "technical_reliability",
    "measurement",
    "strong",
    false,
    {
      projectWorkstream: "site-reliability",
      legacyRuleId: null,
      description: "A same-site resource or document request returned a failure status.",
      priority: "B"
    }
  ),
  console_error: policy(
    "technical_reliability",
    "presence",
    "moderate",
    false,
    {
      projectWorkstream: "site-reliability",
      legacyRuleId: null,
      description: "A bounded browser console error was recorded on a readable page.",
      priority: "D"
    }
  ),
  measured_performance_regression: policy(
    "technical_reliability",
    "measurement",
    "moderate",
    false,
    {
      projectWorkstream: "performance",
      legacyRuleId: null,
      description: "A bounded lab response measurement is above the observed threshold.",
      priority: "D"
    }
  ),
  stale_business_fact: policy(
    "content_freshness",
    "comparison",
    "moderate",
    false,
    {
      projectWorkstream: "content-freshness",
      legacyRuleId: null,
      description: "An explicit dated business fact offers a date that precedes the captured run.",
      priority: "D"
    }
  ),
  rendered_experience_failure: policy(
    "experience",
    "measurement",
    "moderate",
    false,
    {
      projectWorkstream: "experience",
      legacyRuleId: null,
      description: "Our own render measured a clipped or zero-area region. This is an Orbit measurement ceiling, not a fact about the website.",
      priority: "D"
    }
  ),
  conflicting_action: policy(
    "conversion",
    "comparison",
    "moderate",
    false,
    {
      projectWorkstream: "conversion",
      legacyRuleId: null,
      description: "Two observed actions on one page point at inconsistent destinations.",
      priority: "B"
    }
  ),
  placeholder_production_content: policy(
    "content_freshness",
    "presence",
    // A model read the text from cited page evidence rather than measuring a
    // geometry or a status, so moderate is the honest ceiling for the subtype.
    "moderate",
    false,
    {
      projectWorkstream: "content-freshness",
      legacyRuleId: null,
      // The category is about unfinished content, but the impact is a
      // production failure: visitors read the site builder's instructions.
      description: "Text visible in production is still the site builder's template or placeholder copy, or is written as instructions to whoever is building the page, rather than describing the business.",
      priority: "A"
    }
  ),
  unreplaced_platform_default: policy(
    "positioning_offer",
    "presence",
    "moderate",
    false,
    {
      projectWorkstream: "content-freshness",
      legacyRuleId: null,
      description: "A platform-supplied default is still live, such as a template site name in the document title or an unfilled default identity.",
      priority: "A"
    }
  ),
  mismatched_item_content: policy(
    "content_freshness",
    "comparison",
    "moderate",
    false,
    {
      projectWorkstream: "content-freshness",
      legacyRuleId: null,
      description: "Content attached to an item describes a different item, so the pairing is visibly wrong.",
      priority: "B"
    }
  ),
  dead_action_target: policy(
    "conversion",
    "presence",
    "moderate",
    false,
    {
      // A static action with no target is conditional, and the detector that
      // reports it must state that no interaction was attempted.
      projectWorkstream: "conversion",
      legacyRuleId: null,
      description: "A primary action is observed with no destination at all in the served markup.",
      priority: "B"
    }
  ),
  field_value_mismatch: policy(
    "conversion",
    "comparison",
    "strong",
    false,
    {
      projectWorkstream: "conversion",
      legacyRuleId: null,
      description: "A visible contact or action value contradicts the destination it is attached to, such as a displayed address that does not match its own mailto target.",
      priority: "B"
    }
  ),
  inconsistent_content_fact: policy(
    "content_freshness",
    "comparison",
    "moderate",
    false,
    {
      projectWorkstream: "content-freshness",
      legacyRuleId: null,
      description: "Two owned pages state different values for the same non-contact business fact.",
      priority: "B"
    }
  )
};
for (const definition3 of Object.values(INSIGHT_DEFINITIONS)) {
  if (definition3.legacyRuleId !== null && !RuleIdSchema.safeParse(definition3.legacyRuleId).success) {
    throw new Error(`Unknown legacy rule ID in insight taxonomy: ${definition3.legacyRuleId}`);
  }
}
for (const [problemType, definition3] of Object.entries(INSIGHT_DEFINITIONS)) {
  if (definition3.description.trim().length < 20) {
    throw new Error(`Insight subtype ${problemType} is missing a usable description.`);
  }
  if (!PROBLEM_PRIORITIES.includes(definition3.priority)) {
    throw new Error(`Insight subtype ${problemType} has no valid problem priority.`);
  }
}
function definitionForProblemType(problemType) {
  if (!Object.prototype.hasOwnProperty.call(INSIGHT_DEFINITIONS, problemType)) {
    throw new Error(`Unknown insight problem type: ${String(problemType)}`);
  }
  const definition3 = INSIGHT_DEFINITIONS[problemType];
  return definition3;
}
__name(definitionForProblemType, "definitionForProblemType");
