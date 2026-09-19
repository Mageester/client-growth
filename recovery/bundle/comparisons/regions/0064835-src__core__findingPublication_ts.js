// src/core/findingPublication.ts
var CONTEXT_REQUIRED_PROBLEM_TYPES = /* @__PURE__ */ new Set([
  // A long enquiry form is a design preference, not a defect; a form whose
  // submit control is disabled in static DOM may be validating normally.
  "form_friction",
  // An action with no observable target may be script-driven, a modal trigger,
  // or a dropdown control. Static DOM cannot decide which.
  "dead_action_target",
  // A copyright year, a phone number, a social handle: stale or deliberate.
  "stale_business_fact",
  // A small measured target is a measurement; whether it obstructs a customer
  // is a judgement about that customer.
  "small_rendered_target"
]);
var COMMERCIAL_OPPORTUNITY_PROBLEM_TYPES = /* @__PURE__ */ new Set([
  "thin_service_content",
  "competitor_service_gap",
  "visual_conversion_obstacle",
  "obscured_conversion_action"
]);
var INFERENCE_ONLY_PROBLEM_TYPES = /* @__PURE__ */ new Set([
  "conflicting_action"
]);
var MEASUREMENT_PROBLEM_TYPES = /* @__PURE__ */ new Set([
  "measured_performance_regression",
  "rendered_experience_failure"
]);
var ACCESSIBILITY_PROBLEM_TYPES = /* @__PURE__ */ new Set([
  "missing_accessible_name",
  "form_accessibility_failure",
  "missing_image_text_alternative",
  "missing_primary_heading"
]);
var VISUAL_PROBLEM_TYPES = /* @__PURE__ */ new Set([
  "visual_conversion_obstacle",
  "obscured_conversion_action",
  "rendered_experience_failure",
  "small_rendered_target"
]);
var TIER_BY_PROBLEM_TYPE = {
  broken_conversion_path: "broken_conversion",
  dead_action_target: "broken_conversion",
  broken_internal_link: "unreachable_content",
  missing_service_path: "unreachable_content",
  no_service_section: "unreachable_content",
  resource_failure: "unreachable_content",
  placeholder_production_content: "placeholder_production",
  unreplaced_platform_default: "placeholder_production",
  field_value_mismatch: "contact_action_mismatch",
  inconsistent_contact_fact: "contact_action_mismatch",
  conflicting_action: "contact_action_mismatch",
  obscured_conversion_action: "contact_action_mismatch",
  form_friction: "contact_action_mismatch",
  inconsistent_content_fact: "trust_content_inconsistency",
  mismatched_item_content: "trust_content_inconsistency",
  stale_business_fact: "trust_content_inconsistency",
  thin_service_content: "trust_content_inconsistency",
  missing_accessible_name: "accessibility_usability",
  form_accessibility_failure: "accessibility_usability",
  missing_image_text_alternative: "accessibility_usability",
  missing_primary_heading: "accessibility_usability",
  small_rendered_target: "accessibility_usability",
  competitor_service_gap: "commercial_opportunity",
  visual_conversion_obstacle: "commercial_opportunity",
  missing_meta_description: "minor_metadata",
  missing_page_title: "minor_metadata",
  duplicate_page_title: "minor_metadata",
  missing_business_schema: "minor_metadata",
  console_error: "maintenance",
  measured_performance_regression: "maintenance",
  rendered_experience_failure: "maintenance"
};
var UNGROUNDED_OFFERING_TIER = "commercial_opportunity";
function offeringProvenanceFor(diagnostics) {
  for (const diagnostic of diagnostics) {
    const details = diagnostic.details;
    if (details?.kind === "verification" && details.offeringProvenance) {
      return details.offeringProvenance;
    }
  }
  return void 0;
}
__name(offeringProvenanceFor, "offeringProvenanceFor");
var PUBLISHABLE_CALIBRATIONS = /* @__PURE__ */ new Set([
  "VERIFIED_DEFECT",
  "EVIDENCE_BACKED_COMMERCIAL_OPPORTUNITY",
  "NEEDS_CLIENT_CONTEXT",
  "ORBIT_MEASUREMENT_LIMITATION"
]);
var MEASUREMENT_LIMITATION_CALIBRATIONS = /* @__PURE__ */ new Set(["ORBIT_MEASUREMENT_LIMITATION"]);
function isMeasurementLimitationFinding(finding) {
  return MEASUREMENT_LIMITATION_CALIBRATIONS.has(finding.calibration) || finding.origin === "MEASUREMENT" || measurementConditionUnestablished(finding);
}
__name(isMeasurementLimitationFinding, "isMeasurementLimitationFinding");
function tierForProblemType(problemType, diagnostics = []) {
  const tier = TIER_BY_PROBLEM_TYPE[problemType] ?? "maintenance";
  if (problemType === "missing_service_path") {
    const provenance = offeringProvenanceFor(diagnostics);
    if (provenance !== void 0 && !SITE_GROUNDED_PROVENANCE.has(provenance)) {
      return UNGROUNDED_OFFERING_TIER;
    }
  }
  return tier;
}
__name(tierForProblemType, "tierForProblemType");
var GRADE_RANK = {
  strong: 0,
  moderate: 1,
  limited: 2,
  insufficient: 3
};
var CALIBRATION_RANK = {
  VERIFIED_DEFECT: 0,
  EVIDENCE_BACKED_COMMERCIAL_OPPORTUNITY: 1,
  NEEDS_CLIENT_CONTEXT: 2,
  ORBIT_MEASUREMENT_LIMITATION: 3,
  UNSUPPORTED: 4
};
function fnv1a644(value) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}
__name(fnv1a644, "fnv1a64");
function bounded(value, max) {
  const text = value.trim();
  return text.length > max ? text.slice(0, max) : text;
}
__name(bounded, "bounded");
function evidenceOriginFor(problemType, diagnostics) {
  for (const diagnostic of diagnostics) {
    if (diagnostic.origin) return diagnostic.origin;
  }
  if (diagnostics.some(isOrbitMeasurementDiagnostic)) return "MEASUREMENT";
  if (MEASUREMENT_PROBLEM_TYPES.has(problemType)) return "MEASUREMENT";
  if (ACCESSIBILITY_PROBLEM_TYPES.has(problemType)) return "ACCESSIBILITY";
  if (VISUAL_PROBLEM_TYPES.has(problemType)) return "VISUAL";
  return "SOURCE_HTTP";
}
__name(evidenceOriginFor, "evidenceOriginFor");
function calibrationFor(input) {
  if (input.claimScope === "hypothesis") return "UNSUPPORTED";
  if (input.counterEvidenceState === "contradictory") return "UNSUPPORTED";
  if (input.qualityGate === "rejected") return "UNSUPPORTED";
  if (input.origin === "MEASUREMENT") return "ORBIT_MEASUREMENT_LIMITATION";
  if (CONTEXT_REQUIRED_PROBLEM_TYPES.has(input.problemType)) return "NEEDS_CLIENT_CONTEXT";
  if (INFERENCE_ONLY_PROBLEM_TYPES.has(input.problemType)) {
    return input.claimScope === "observed" ? "EVIDENCE_BACKED_COMMERCIAL_OPPORTUNITY" : "NEEDS_CLIENT_CONTEXT";
  }
  if (COMMERCIAL_OPPORTUNITY_PROBLEM_TYPES.has(input.problemType)) {
    return "EVIDENCE_BACKED_COMMERCIAL_OPPORTUNITY";
  }
  const definition3 = definitionForProblemType(input.problemType);
  if (definition3.claimKind === "supported_inference") {
    return "EVIDENCE_BACKED_COMMERCIAL_OPPORTUNITY";
  }
  if (input.qualityGate === "limited") return "NEEDS_CLIENT_CONTEXT";
  return "VERIFIED_DEFECT";
}
__name(calibrationFor, "calibrationFor");
function evidenceLabelsFor(evidenceIds, byId) {
  const labels = [];
  const seen = /* @__PURE__ */ new Set();
  for (const id of evidenceIds) {
    const record2 = byId.get(id);
    if (!record2) continue;
    const parsed = parseEvidenceRef(record2.locator);
    const value = bounded(parsed.value || record2.locator, 200);
    const label = record2.kind === "page" ? value : `${record2.kind}: ${value}`;
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}
__name(evidenceLabelsFor, "evidenceLabelsFor");
function catalogMatchFor(problemType, catalog) {
  const legacyRuleId = definitionForProblemType(problemType).legacyRuleId;
  if (legacyRuleId === null) return null;
  const link = RULE_SERVICE_LINKS.find((entry2) => entry2.ruleId === legacyRuleId);
  if (!link) return null;
  const match = matchServiceForRule([...catalog], link.tag);
  if (!match) return null;
  return {
    serviceId: match.service.id,
    serviceName: bounded(match.service.name, 300),
    tag: link.tag,
    state: match.state === "direct" ? "direct" : "adjacent"
  };
}
__name(catalogMatchFor, "catalogMatchFor");
var UNRESOLVED_REFERENCE = /^unresolved ledger evidence references?:\s*(.*)$/i;
function sanitizeFindingProse(value) {
  return sanitizeCustomerObservation(value);
}
__name(sanitizeFindingProse, "sanitizeFindingProse");
function customerSafeLimitation(value) {
  const trimmed = value.trim();
  const unresolved = UNRESOLVED_REFERENCE.exec(trimmed);
  if (unresolved) {
    return "One supporting observation could not be matched to the captured website evidence, so it was left out of this finding.";
  }
  if (/ledger/i.test(trimmed) || /\brefs?\b/i.test(trimmed)) {
    return "One supporting observation could not be matched to the captured website evidence.";
  }
  return trimmed;
}
__name(customerSafeLimitation, "customerSafeLimitation");
function limitationsFor(problem, diagnostics) {
  const seen = /* @__PURE__ */ new Set();
  const ordered = [];
  for (const raw of [
    ...problem.assessment.limitations,
    ...problem.rejectionReasons,
    // The detector's own bounded scope note, so the agency sees what the
    // observation does and does not establish (e.g. "no submission was
    // attempted", "limited to the measured rendered geometry").
    ...diagnostics.flatMap(
      (diagnostic) => diagnostic.details?.kind === "broad" || diagnostic.details?.kind === "semantic" ? [diagnostic.details.reason] : []
    )
  ]) {
    const value = bounded(customerSafeLimitation(raw), 500);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    ordered.push(value);
    if (ordered.length >= 100) break;
  }
  return ordered;
}
__name(limitationsFor, "limitationsFor");
function retainedDrafts(input) {
  const decisionByDraft = new Map(
    (input.criticDecisions ?? []).map((decision) => [decision.draftId, decision])
  );
  return (input.shadowDrafts ?? []).map((draft) => ({
    draft,
    retained: decisionByDraft.get(draft.draftId)?.decision === "retain"
  }));
}
__name(retainedDrafts, "retainedDrafts");
function opportunityIdFor(input) {
  if (!input.ruleId) return null;
  const wanted = new Set(
    input.subjectKeys.filter(Boolean).map((subject) => dedupeKey(input.clientId, input.ruleId, subject))
  );
  if (wanted.size === 0) return null;
  const match = input.opportunities.find(
    (opportunity) => wanted.has(opportunity.dedupeKey) || wanted.has(opportunity.id)
  );
  return match ? match.id : null;
}
__name(opportunityIdFor, "opportunityIdFor");
function subjectKeysFor(diagnostics) {
  return [...new Set(diagnostics.map((diagnostic) => diagnostic.subject.key))];
}
__name(subjectKeysFor, "subjectKeysFor");
function claimScopeForDraft(problemType, citedDiagnostics) {
  const declared = citedDiagnostics[0]?.assessment.claimScope;
  if (declared) return declared;
  return definitionForProblemType(problemType).claimKind === "supported_inference" ? "supported_inference" : "observed";
}
__name(claimScopeForDraft, "claimScopeForDraft");
function counterEvidenceStateForDraft(citedDiagnostics) {
  return citedDiagnostics[0]?.assessment.counterEvidenceState ?? "not_checked";
}
__name(counterEvidenceStateForDraft, "counterEvidenceStateForDraft");
var COLLAPSING_PROBLEM_TYPES = /* @__PURE__ */ new Set([
  "field_value_mismatch",
  "inconsistent_contact_fact"
]);
function contactConditionsFor(finding, byId) {
  const conditions = [];
  for (const id of finding.evidenceIds) {
    const record2 = byId.get(id);
    if (!record2 || record2.kind !== "contact-fact") continue;
    const parsed = parseEvidenceRef(record2.locator);
    const parts = parsed.value.split("|");
    const factKind = (parts[0] ?? "").replace(/^contact:/i, "").trim().toLowerCase();
    const page = (record2.pageUrl ?? (parts[1] ?? "")).trim().toLowerCase();
    const payload = record2.payload;
    const value = typeof payload?.value === "string" ? payload.value.trim().toLowerCase() : "";
    if (!factKind || !value) continue;
    conditions.push({ factKind, value, page });
  }
  return conditions;
}
__name(contactConditionsFor, "contactConditionsFor");
function observationSides(observation) {
  const match = /differs from the [^(]*?\(([^)]*)\)/i.exec(observation);
  if (!match) return null;
  const target = quoteValues(match[1] ?? "");
  if (target.length === 0) return null;
  const visiblePart = /a visitor reads \(([^)]*)\)/i.exec(observation)?.[1] ?? "";
  const visible = quoteValues(visiblePart);
  if (visible.length === 0) return null;
  return { visible, target };
}
__name(observationSides, "observationSides");
function observationValues(observation) {
  return quoteValues(observation);
}
__name(observationValues, "observationValues");
function quoteValues(value) {
  return [...value.matchAll(/[“"']([^”"']+)[”"']/g)].map((match) => match[1].trim().toLowerCase()).filter(Boolean).sort();
}
__name(quoteValues, "quoteValues");
function conditionSignature(finding, byId) {
  if (!COLLAPSING_PROBLEM_TYPES.has(finding.problemType)) return null;
  const conditions = contactConditionsFor(finding, byId);
  if (conditions.length === 0) return null;
  const facts = [...new Set(conditions.map((condition) => condition.factKind))].sort();
  return `${finding.problemType}|${facts.join(",")}`;
}
__name(conditionSignature, "conditionSignature");
function weakerCalibration(left, right) {
  return CALIBRATION_RANK[left] >= CALIBRATION_RANK[right] ? left : right;
}
__name(weakerCalibration, "weakerCalibration");
var MEASURED_CLAIM_PROBLEM_TYPES = /* @__PURE__ */ new Set([
  "obscured_conversion_action",
  "small_rendered_target",
  "rendered_experience_failure",
  "measured_performance_regression",
  "form_friction"
]);
var NOT_ESTABLISHED_PATTERNS = [
  /was not established/i,
  /could not be established/i,
  /cannot be established/i,
  /\bnot established\b/i,
  /could not be (?:determined|verified|confirmed)/i,
  /remains (?:unassessed|unverified|unknown)/i,
  /no (?:visual )?conclusion was made/i,
  /visibility was not/i
];
function measurementConditionUnestablished(finding) {
  if (!MEASURED_CLAIM_PROBLEM_TYPES.has(finding.problemType)) return false;
  return NOT_ESTABLISHED_PATTERNS.some((pattern2) => pattern2.test(finding.statement));
}
__name(measurementConditionUnestablished, "measurementConditionUnestablished");
function enforceEvidenceCeiling(finding) {
  if (!measurementConditionUnestablished(finding)) return finding;
  if (finding.calibration === "VERIFIED_DEFECT" || finding.calibration === "EVIDENCE_BACKED_COMMERCIAL_OPPORTUNITY") {
    return PublishedFindingSchema.parse({
      ...finding,
      calibration: "ORBIT_MEASUREMENT_LIMITATION",
      confidence: weakerGrade2(finding.confidence, "limited")
    });
  }
  return finding;
}
__name(enforceEvidenceCeiling, "enforceEvidenceCeiling");
function weakerGrade2(left, right) {
  return (GRADE_RANK[left] ?? 3) >= (GRADE_RANK[right] ?? 3) ? left : right;
}
__name(weakerGrade2, "weakerGrade");
function evidenceCapsFor(diagnostics, accounting) {
  if (!accounting) return [];
  const detectorIds = [...new Set(diagnostics.map((diagnostic) => diagnostic.detectorId))];
  const caps = [];
  for (const detectorId of detectorIds) {
    const entry2 = accounting.detectors.find((detector) => detector.detectorId === detectorId);
    if (!entry2?.capped) continue;
    const observed = entry2.cap?.observed ?? entry2.emitted;
    const limit = entry2.cap?.limit ?? entry2.emitted;
    caps.push({
      detectorId,
      limit,
      observed,
      emitted: entry2.emitted,
      omitted: Math.max(0, observed - entry2.emitted)
    });
  }
  return caps;
}
__name(evidenceCapsFor, "evidenceCapsFor");
var PUBLISHES_NO_COUNT = /no number is published|not how many were seen|does not record (?:the|their) measured length|count could not be established/i;
function capBoundClause(caps, statement) {
  if (PUBLISHES_NO_COUNT.test(statement)) return null;
  const observed = caps.reduce((total, cap) => total + cap.observed, 0);
  const omitted = caps.reduce((total, cap) => total + cap.omitted, 0);
  if (omitted === 0) return null;
  return ` This count is a lower bound: the detector stopped at its evidence limit after ${observed} matched observations, and ${omitted} further ${omitted === 1 ? "observation was" : "observations were"} recorded without detailed evidence.`;
}
__name(capBoundClause, "capBoundClause");
function capLimitationsFor(caps) {
  return caps.map(
    (cap) => `Detector \u201C${cap.detectorId}\u201D reached its cap of ${cap.limit}: it recorded ${cap.observed} distinct matching observations and carried ${cap.emitted} as detailed evidence, so ${cap.omitted} more exist in accounting only. Counts above describe the retained evidence, not the full observed population.`
  );
}
__name(capLimitationsFor, "capLimitationsFor");
function claimScopeForFinding(left, right) {
  const rank = { observed: 0, supported_inference: 1, hypothesis: 2 };
  return rank[left] >= rank[right] ? left : right;
}
__name(claimScopeForFinding, "claimScopeForFinding");
function joinValues(values) {
  const items = values.filter(Boolean);
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
__name(joinValues, "joinValues");
function countLabel2(count5, singular) {
  return `${count5} ${count5 === 1 ? singular : `${singular}s`}`;
}
__name(countLabel2, "countLabel");
function composedContactStatement(input) {
  const factKinds = [...new Set(input.conditions.map((condition) => condition.factKind))].sort();
  if (factKinds.length === 0) return null;
  const factLabel = joinValues(factKinds);
  const pageCount = input.pages.length;
  if (input.problemType === "inconsistent_contact_fact") {
    const values = [...new Set(input.statements.flatMap(observationValues))].sort();
    if (values.length < 2) return null;
    return `${countLabel2(pageCount, "page")} publish ${values.length} different ${factLabel} values \u2014 ${joinValues(
      values.map((value) => `\u201C${value}\u201D`)
    )} \u2014 so a visitor cannot tell which one reaches the business.`;
  }
  const sides = input.statements.map(observationSides).filter((value) => value !== null);
  const visible = [...new Set(sides.flatMap((side) => side.visible))].sort();
  const target = [...new Set(sides.flatMap((side) => side.target))].sort();
  if (visible.length === 0 || target.length === 0) {
    const values = [...new Set(input.statements.flatMap(observationValues))].sort();
    if (values.length < 2) return null;
    return `${countLabel2(pageCount, "page")} record disagreeing ${factLabel} values \u2014 ${joinValues(
      values.map((value) => `\u201C${value}\u201D`)
    )} \u2014 between what a visitor reads and what the page's own action uses. ${preservedValuesClause(
      values.length
    )}`;
  }
  return `${countLabel2(pageCount, "page")} show ${joinValues(
    visible.map((value) => `\u201C${value}\u201D`)
  )} while the ${factLabel} action points to ${joinValues(
    target.map((value) => `\u201C${value}\u201D`)
  )}. ${preservedValuesClause((/* @__PURE__ */ new Set([...visible, ...target])).size)}`;
}
__name(composedContactStatement, "composedContactStatement");
function mergeConditionFindings(representative, members2, byId) {
  if (members2.length === 1) return representative;
  const all = [...members2].sort((left, right) => compareFindings(left, right));
  const first = all[0];
  const pages = [...new Set(all.flatMap((finding) => finding.pages))].slice(0, 1e3);
  const evidenceIds = [...new Set(all.flatMap((finding) => finding.evidenceIds))].slice(0, 1e3);
  const conditions = all.flatMap((finding) => contactConditionsFor(finding, byId));
  const calibration = all.map((finding) => finding.calibration).reduce(weakerCalibration, first.calibration);
  const confidence = all.map((finding) => finding.confidence).reduce(weakerGrade2, first.confidence);
  const statements = [...new Set(all.map((finding) => finding.statement))];
  const composed = composedContactStatement({
    problemType: representative.problemType,
    conditions,
    statements,
    pages
  });
  const statement = composed ?? (statements.length === 1 ? statements[0] : representative.statement);
  return PublishedFindingSchema.parse({
    ...first,
    statement: bounded(statement, 5e3),
    calibration,
    confidence,
    pages,
    evidenceIds,
    evidenceLabels: evidenceLabelsFor(evidenceIds, byId),
    limitations: [...new Set(all.flatMap((finding) => finding.limitations))].slice(0, 100),
    claimScope: all.map((finding) => finding.claimScope).reduce(claimScopeForFinding, first.claimScope)
  });
}
__name(mergeConditionFindings, "mergeConditionFindings");
function elementKeysOf(finding, byId) {
  const keys = /* @__PURE__ */ new Set();
  for (const id of finding.evidenceIds) {
    const record2 = byId.get(id);
    if (!record2) continue;
    const parsed = parseEvidenceRef(record2.locator);
    if (parsed.kind !== "element") continue;
    keys.add(`${(record2.pageUrl ?? "").toLowerCase()}|${parsed.value.toLowerCase()}`);
  }
  return keys;
}
__name(elementKeysOf, "elementKeysOf");
function collapseSiteConditions(findings, byId) {
  const bySignature = /* @__PURE__ */ new Map();
  const passthrough = [];
  for (const finding of findings) {
    const signature = conditionSignature(finding, byId);
    if (!signature) {
      passthrough.push(finding);
      continue;
    }
    const group = bySignature.get(signature) ?? [];
    group.push(finding);
    bySignature.set(signature, group);
  }
  const collapsed = [...passthrough];
  for (const [signature, group] of bySignature) {
    const representative = [...group].sort(compareFindings)[0];
    collapsed.push(
      group.length > 1 ? mergeConditionFindings(representative, group, byId) : representative
    );
    void signature;
  }
  const mismatchPages = /* @__PURE__ */ new Set();
  for (const finding of collapsed) {
    if (finding.problemType !== "field_value_mismatch") continue;
    for (const condition of contactConditionsFor(finding, byId)) {
      if (condition.page) mismatchPages.add(condition.page);
    }
  }
  const mismatchedKinds = new Set(
    collapsed.filter((finding) => finding.problemType === "field_value_mismatch").flatMap((finding) => contactConditionsFor(finding, byId).map((condition) => condition.factKind))
  );
  const mismatchValues = new Set(
    collapsed.filter((finding) => finding.problemType === "field_value_mismatch").flatMap((finding) => contactConditionsFor(finding, byId).map((condition) => condition.value))
  );
  const strongerAccessibilityElements = /* @__PURE__ */ new Set();
  for (const finding of collapsed) {
    if (finding.problemType !== "missing_accessible_name" && finding.problemType !== "form_accessibility_failure") {
      continue;
    }
    for (const key of elementKeysOf(finding, byId)) strongerAccessibilityElements.add(key);
  }
  return collapsed.filter((finding) => {
    if (finding.problemType === "small_rendered_target") {
      const keys = elementKeysOf(finding, byId);
      if (keys.size > 0 && [...keys].every((key) => strongerAccessibilityElements.has(key))) {
        return false;
      }
    }
    if (finding.problemType === "inconsistent_contact_fact") {
      const conditions = contactConditionsFor(finding, byId);
      if (conditions.length === 0) return true;
      const pages = [...new Set(conditions.map((condition) => condition.page).filter(Boolean))];
      const everyFactHasMismatch = conditions.every(
        (condition) => mismatchedKinds.has(condition.factKind)
      );
      const pagesCovered = pages.length > 0 && pages.every((page) => mismatchPages.has(page));
      const valuesCovered = conditions.every((condition) => mismatchValues.has(condition.value));
      return !(everyFactHasMismatch && pagesCovered && valuesCovered);
    }
    return true;
  }).map(enforceEvidenceCeiling);
}
__name(collapseSiteConditions, "collapseSiteConditions");
function buildPublishedFindings(input) {
  const snapshot = input.snapshot;
  const byId = new Map(snapshot.evidence.map((entry2) => [entry2.id, entry2]));
  const diagnosticsById = new Map(snapshot.diagnostics.map((entry2) => [entry2.id, entry2]));
  const opportunities = input.opportunities ?? [];
  const drafts = retainedDrafts(input);
  const consumedDiagnosticIds = new Set(
    drafts.flatMap((view) => view.draft.diagnosticIds)
  );
  const semanticDiagnosticIds = new Set(
    snapshot.diagnostics.filter(isSemanticDiagnostic).map((diagnostic) => diagnostic.id)
  );
  for (const view of drafts) {
    if (!view.retained) continue;
    for (const problem of snapshot.problems) {
      if (problem.problemType !== view.draft.problemType) continue;
      if (problem.diagnosticIds.length === 0) continue;
      if (!problem.diagnosticIds.every((id) => semanticDiagnosticIds.has(id))) continue;
      for (const id of problem.diagnosticIds) consumedDiagnosticIds.add(id);
    }
  }
  const findings = [];
  let withheld = 0;
  for (const view of drafts) {
    if (!view.retained) {
      withheld += 1;
      continue;
    }
    const draft = view.draft;
    const citedDiagnostics = draft.diagnosticIds.map((id) => diagnosticsById.get(id)).filter((value) => value !== void 0);
    const evidenceIds = draft.evidenceIds.filter((id) => byId.has(id));
    if (evidenceIds.length === 0) {
      withheld += 1;
      continue;
    }
    if (draft.problemType === "duplicate_page_title") {
      const documents = distinctDocumentCount([
        ...draft.evidenceIds.flatMap((id) => {
          const pageUrl = byId.get(id)?.pageUrl;
          return pageUrl ? [pageUrl] : [];
        }),
        ...citedDiagnostics.flatMap((diagnostic) => diagnostic.affectedPages)
      ]);
      if (documents < 2) {
        withheld += 1;
        continue;
      }
    }
    const origin = evidenceOriginFor(draft.problemType, citedDiagnostics);
    const assessment = citedDiagnostics[0]?.assessment;
    const gate = citedDiagnostics.length === 0 ? "supported" : citedDiagnostics.every((diagnostic) => diagnostic.assessment.grade === "strong" || diagnostic.assessment.grade === "moderate") ? "supported" : "limited";
    const calibration = calibrationFor({
      problemType: draft.problemType,
      qualityGate: gate,
      origin,
      claimScope: claimScopeForDraft(draft.problemType, citedDiagnostics),
      counterEvidenceState: counterEvidenceStateForDraft(citedDiagnostics)
    });
    const tier = tierForProblemType(draft.problemType, citedDiagnostics);
    const pages = [
      .../* @__PURE__ */ new Set([
        ...draft.evidenceIds.flatMap((id) => {
          const pageUrl = byId.get(id)?.pageUrl;
          return pageUrl ? [pageUrl] : [];
        }),
        ...citedDiagnostics.flatMap((diagnostic) => diagnostic.affectedPages)
      ])
    ].slice(0, 1e3);
    const legacyRuleId = definitionForProblemType(draft.problemType).legacyRuleId;
    const enumeration = verifyControlEnumeration({
      statement: draft.statement,
      controls: boundControlsFrom(evidenceIds, byId),
      scopeUrl: pages[0]
    });
    const contradicted = enumeration.kind === "contradicted" ? enumeration : null;
    findings.push(
      PublishedFindingSchema.parse({
        id: draft.draftId,
        fingerprint: `fnd_${fnv1a644(
          [
            draft.problemType,
            draft.canonicalSurface,
            [...pages].sort().join(",")
          ].join("|")
        )}`,
        statement: bounded(sanitizeFindingProse(contradicted?.statement ?? draft.statement), 5e3),
        whyItMatters: bounded(
          sanitizeFindingProse(contradicted?.whyItMatters ?? draft.whyItMatters),
          5e3
        ),
        businessConsequence: draft.businessConsequence ? bounded(sanitizeFindingProse(draft.businessConsequence), 5e3) : null,
        category: draft.category,
        problemType: draft.problemType,
        calibration,
        origin,
        tier,
        rank: FINDING_TIER_RANK[tier],
        confidence: assessment?.grade ?? "moderate",
        claimScope: claimScopeForDraft(draft.problemType, citedDiagnostics),
        pages,
        evidenceIds,
        evidenceLabels: evidenceLabelsFor(evidenceIds, byId),
        validationSteps: draft.validationSteps.map((step) => bounded(sanitizeFindingProse(step), 500)).slice(0, 50),
        limitations: [
          ...contradicted ? [
            `${contradicted.detail} The finding below states the destinations the evidence records instead.`
          ] : [],
          ...citedDiagnostics.flatMap((diagnostic) => diagnostic.assessment.limitations)
        ].map((value) => bounded(value, 500)).filter((value, index, all) => Boolean(value) && all.indexOf(value) === index).slice(0, 100),
        catalogMatch: catalogMatchFor(draft.problemType, input.catalog),
        opportunityId: opportunityIdFor({
          clientId: snapshot.clientId,
          ruleId: legacyRuleId,
          subjectKeys: [...subjectKeysFor(citedDiagnostics), draft.canonicalSurface],
          opportunities
        }),
        source: "semantic",
        reviewed: true
      })
    );
  }
  for (const problem of snapshot.problems) {
    if (problem.diagnosticIds.some((id) => consumedDiagnosticIds.has(id))) continue;
    const citedDiagnostics = problem.diagnosticIds.map((id) => diagnosticsById.get(id)).filter((value) => value !== void 0);
    const origin = evidenceOriginFor(problem.problemType, citedDiagnostics);
    const calibration = calibrationFor({
      problemType: problem.problemType,
      qualityGate: problem.qualityGate,
      origin,
      claimScope: problem.assessment.claimScope,
      counterEvidenceState: problem.assessment.counterEvidenceState
    });
    if (!PUBLISHABLE_CALIBRATIONS.has(calibration) && !input.includeUnsupported) {
      withheld += 1;
      continue;
    }
    if (problem.evidenceRefs.length === 0) {
      withheld += 1;
      continue;
    }
    if (problem.problemType === "duplicate_page_title" && distinctDocumentCount(problem.affectedPages) < 2) {
      withheld += 1;
      continue;
    }
    const tier = tierForProblemType(problem.problemType, citedDiagnostics);
    const legacyRuleId = definitionForProblemType(problem.problemType).legacyRuleId;
    const measurementLimitation = citedDiagnostics.find(isOrbitMeasurementDiagnostic);
    const evidenceCaps = evidenceCapsFor(citedDiagnostics, snapshot.accounting);
    findings.push(
      PublishedFindingSchema.parse({
        id: problem.id,
        fingerprint: `fnd_${fnv1a644(
          [
            problem.problemType,
            problem.surfaceKey,
            [...problem.affectedPages].sort().join(",")
          ].join("|")
        )}`,
        statement: bounded(
          (() => {
            const clause = capBoundClause(evidenceCaps, problem.statement);
            return clause ? `${problem.statement.trim().replace(/\.$/, "")}.${clause}` : problem.statement;
          })(),
          5e3
        ),
        whyItMatters: bounded(problem.whyItMatters, 5e3),
        businessConsequence: problem.businessConsequence ? bounded(problem.businessConsequence, 5e3) : null,
        category: problem.category,
        problemType: problem.problemType,
        calibration,
        origin,
        tier,
        rank: FINDING_TIER_RANK[tier],
        confidence: problem.assessment.grade,
        claimScope: problem.assessment.claimScope,
        pages: problem.affectedPages.slice(0, 1e3),
        evidenceIds: problem.evidenceRefs.slice(0, 1e3),
        evidenceLabels: evidenceLabelsFor(problem.evidenceRefs, byId),
        validationSteps: problem.validationSteps.map((step) => bounded(step, 500)).slice(0, 50),
        limitations: [
          ...capLimitationsFor(evidenceCaps),
          ...limitationsFor(problem, citedDiagnostics)
        ].filter((value, index, all) => all.indexOf(value) === index).slice(0, 100),
        catalogMatch: catalogMatchFor(problem.problemType, input.catalog),
        opportunityId: opportunityIdFor({
          clientId: snapshot.clientId,
          ruleId: legacyRuleId,
          subjectKeys: [...subjectKeysFor(citedDiagnostics), problem.surfaceKey],
          opportunities
        }),
        source: sourceForDiagnostics(citedDiagnostics),
        reviewed: false,
        ...measurementLimitation ? {
          measurementLimitation: bounded(
            measurementLimitation.observation,
            500
          )
        } : {},
        ...evidenceCaps.length > 0 ? { evidenceCaps } : {}
      })
    );
  }
  const collapsed = collapseSiteConditions(findings, byId);
  collapsed.sort(compareFindings);
  const limitations = collapsed.filter(isMeasurementLimitationFinding);
  const siteFindings = collapsed.filter((finding) => !isMeasurementLimitationFinding(finding));
  return FindingSetSchema.parse({
    runId: snapshot.runId,
    findings: siteFindings,
    limitations,
    withheld
  });
}
__name(buildPublishedFindings, "buildPublishedFindings");
function sourceForDiagnostics(diagnostics) {
  if (diagnostics.some((diagnostic) => diagnostic.details?.kind === "semantic")) {
    return "semantic";
  }
  if (diagnostics.some((diagnostic) => diagnostic.details?.kind === "broad")) {
    return "broad_detector";
  }
  if (diagnostics.some((diagnostic) => diagnostic.problemType === "visual_conversion_obstacle")) {
    return "visual";
  }
  return "deterministic";
}
__name(sourceForDiagnostics, "sourceForDiagnostics");
function compareFindings(left, right) {
  if (left.rank !== right.rank) return left.rank - right.rank;
  const calibration = CALIBRATION_RANK[left.calibration] - CALIBRATION_RANK[right.calibration];
  if (calibration !== 0) return calibration;
  const grade = (GRADE_RANK[left.confidence] ?? 3) - (GRADE_RANK[right.confidence] ?? 3);
  if (grade !== 0) return grade;
  const statement = left.statement < right.statement ? -1 : left.statement > right.statement ? 1 : 0;
  if (statement !== 0) return statement;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
__name(compareFindings, "compareFindings");
