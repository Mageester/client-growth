// src/core/problemSynthesis.ts
var MAX_ID_LENGTH = 200;
function boundedIdentity(value, label) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ID_LENGTH) {
    throw new Error(`${label} must be a non-empty bounded identity.`);
  }
  return trimmed;
}
__name(boundedIdentity, "boundedIdentity");
function fnv1a643(value) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}
__name(fnv1a643, "fnv1a64");
function compareStrings2(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
__name(compareStrings2, "compareStrings");
function uniqueStrings3(values) {
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
__name(uniqueStrings3, "uniqueStrings");
function sortedStrings2(values) {
  return uniqueStrings3(values).sort(compareStrings2);
}
__name(sortedStrings2, "sortedStrings");
function assertShadowArtifacts(input) {
  const drafts = (input.drafts ?? []).map((draft) => ProblemDraftSchema.parse(draft));
  const decisions = (input.criticDecisions ?? []).map((decision) => CriticDecisionSchema.parse(decision));
  const evidenceIds = new Set(input.evidence.map((entry2) => entry2.id));
  const diagnosticIds = new Set(input.diagnostics.map((diagnostic) => diagnostic.id));
  for (const evidence of input.evidence) {
    if (evidence.runId !== input.runId) {
      throw new Error("Shadow evidence crosses the accepted run boundary.");
    }
  }
  for (const diagnostic of input.diagnostics) {
    if (diagnostic.workspaceId !== input.workspaceId || diagnostic.runId !== input.runId || diagnostic.clientId !== input.clientId) {
      throw new Error("Shadow diagnostics cross the accepted workspace, run, or client boundary.");
    }
  }
  const draftIds = /* @__PURE__ */ new Set();
  for (const draft of drafts) {
    if (draft.clientId !== input.clientId) {
      throw new Error("Shadow problem draft crosses the accepted client boundary.");
    }
    if (draftIds.has(draft.draftId)) {
      throw new Error("Shadow problem draft IDs must be unique.");
    }
    draftIds.add(draft.draftId);
    if (draft.diagnosticIds.some((id) => !diagnosticIds.has(id))) {
      throw new Error("Shadow problem draft references an unknown diagnostic.");
    }
    if (draft.evidenceIds.some((id) => !evidenceIds.has(id))) {
      throw new Error("Shadow problem draft references unknown evidence.");
    }
  }
  if (decisions.length > 0) {
    validateCriticDecisions(decisions, drafts, input.evidence);
  }
}
__name(assertShadowArtifacts, "assertShadowArtifacts");
function stableJson2(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson2).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => compareStrings2(left, right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson2(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
__name(stableJson2, "stableJson");
function displayLocator(value) {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return crawlKey(parsed);
  } catch {
  }
  return trimmed;
}
__name(displayLocator, "displayLocator");
function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return canonicalSubjectLocator(value);
  }
}
__name(hostOf, "hostOf");
function rawPolicyRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Diagnostic draft must be an object.");
  }
  return value;
}
__name(rawPolicyRecord, "rawPolicyRecord");
function assertNoCrossIdentity(value, identities, label) {
  const record2 = rawPolicyRecord(value);
  for (const key of ["workspaceId", "runId", "clientId"]) {
    const candidate = record2[key];
    if (candidate !== void 0 && candidate !== identities[key]) {
      throw new Error(`${label} has a cross-${key} identity.`);
    }
  }
}
__name(assertNoCrossIdentity, "assertNoCrossIdentity");
function fingerprintFor(draft) {
  return [
    draft.detectorId.trim().toLowerCase(),
    draft.detectorVersion.trim().toLowerCase(),
    draft.problemType,
    draft.subject.kind,
    // Element/control subjects keep their page-local element key: the crawl URL
    // canonicalizer strips the fragment the key lives in, which merged every
    // control of one type on a page into a single diagnostic. See
    // `diagnosticIdentity`.
    diagnosticSubjectIdentity(draft.subject),
    draft.observation.trim().replace(/\s+/g, " ").toLowerCase()
  ].join("|");
}
__name(fingerprintFor, "fingerprintFor");
function stateRank(state) {
  return { observed: 0, unknown: 1, stale: 2, blocked: 3 }[state];
}
__name(stateRank, "stateRank");
function claimRank(scope) {
  return { observed: 0, supported_inference: 1, hypothesis: 2 }[scope];
}
__name(claimRank, "claimRank");
function counterEvidenceRank(state) {
  return {
    // Higher is weaker: a mixed duplicate set must not be upgraded to a
    // publishable state merely because one detector checked and found none.
    present: 0,
    checked_none: 1,
    not_checked: 2,
    unknown: 3,
    contradictory: 4
  }[state];
}
__name(counterEvidenceRank, "counterEvidenceRank");
function inferredCounterEvidenceState(draft) {
  return draft.counterEvidenceState ?? ((draft.counterEvidence?.length ?? 0) > 0 ? "present" : "not_checked");
}
__name(inferredCounterEvidenceState, "inferredCounterEvidenceState");
function worstCounterEvidenceState2(states) {
  if (states.length === 0) return "not_checked";
  return [...states].sort((left, right) => counterEvidenceRank(left) - counterEvidenceRank(right))[states.length - 1];
}
__name(worstCounterEvidenceState2, "worstCounterEvidenceState");
var ORIGIN_CONSERVATISM = {
  MEASUREMENT: 5,
  INTERACTION: 4,
  VISUAL: 3,
  ACCESSIBILITY: 2,
  RENDERED_DOM: 1,
  SOURCE_HTTP: 0,
  CLIENT_CONTEXT: 0
};
function mergedOrigin(entries) {
  const origins = entries.map(({ draft }) => draft.origin).filter((origin) => origin !== void 0);
  if (origins.length === 0) return void 0;
  return [...origins].sort(
    (left, right) => ORIGIN_CONSERVATISM[left] - ORIGIN_CONSERVATISM[right]
  )[origins.length - 1];
}
__name(mergedOrigin, "mergedOrigin");
function mergedDetails(entries) {
  const details = entries.map(({ draft }) => draft.details).filter((detail) => detail !== void 0);
  if (details.length === 0) return void 0;
  const first = details[0];
  if (details.some((detail) => detail.kind !== first.kind)) return first;
  if (first.kind === "legacy") {
    const suppressionRefs = sortedStrings2(
      details.flatMap((detail) => detail.kind === "legacy" ? detail.suppressedEvidenceRefs ?? [] : [])
    );
    return {
      kind: "legacy",
      legacyRuleId: first.legacyRuleId,
      ...suppressionRefs.length > 0 ? { suppressedEvidenceRefs: suppressionRefs } : {}
    };
  }
  if (first.kind === "conversion_defect") {
    const all = details.filter((detail) => detail.kind === "conversion_defect");
    const base = all[0].conversionDefect;
    return {
      kind: "conversion_defect",
      conversionDefect: {
        ...base,
        seenOn: sortedStrings2(all.flatMap((detail) => detail.conversionDefect.seenOn))
      }
    };
  }
  if (first.kind === "broad") {
    return first;
  }
  if (first.kind === "semantic") {
    return first;
  }
  const verifications = details.filter((detail) => detail.kind === "verification").map((detail) => detail.verification);
  const conclusionRank = { weak: 0, inconclusive: 1, absent: 2, present: 3 };
  const conclusion = [...verifications].sort((left, right) => conclusionRank[left.conclusion] - conclusionRank[right.conclusion]).at(-1).conclusion;
  const closeMatches = verifications.flatMap((verification) => verification.closeMatches).sort((left, right) => compareStrings2(stableJson2(left), stableJson2(right))).filter((match, index, all) => index === 0 || stableJson2(match) !== stableJson2(all[index - 1]));
  const provenanceRanks = {
    SITE_OBSERVED: 0,
    INFERRED: 1,
    USER_ASSERTED: 2,
    CATALOG: 3,
    CLIENT_PROFILE: 4
  };
  const provenances = details.filter((detail) => detail.kind === "verification").map((detail) => detail.offeringProvenance).filter((value) => value !== void 0).sort((left, right) => (provenanceRanks[left] ?? 9) - (provenanceRanks[right] ?? 9));
  return {
    kind: "verification",
    verification: {
      conclusion,
      inspectedUrls: sortedStrings2(verifications.flatMap((verification) => verification.inspectedUrls)),
      closeMatches,
      reason: sortedStrings2(verifications.map((verification) => verification.reason).filter(Boolean)).join(" ").slice(0, 4e3)
    },
    ...provenances.length > 0 ? { offeringProvenance: provenances[provenances.length - 1] } : {}
  };
}
__name(mergedDetails, "mergedDetails");
function mergeDrafts(entries) {
  const ordered = [...entries].sort(
    (left, right) => compareStrings2(stableJson2(left.draft), stableJson2(right.draft))
  );
  const first = ordered[0];
  const states = ordered.map(({ draft }) => draft.state).sort((left, right) => stateRank(left) - stateRank(right));
  const scopes = ordered.map(
    ({ draft }) => draft.claimScope ?? (definitionForProblemType(draft.problemType).claimKind === "supported_inference" ? "supported_inference" : "observed")
  ).sort((left, right) => claimRank(left) - claimRank(right));
  const mergedDraft = {
    ...first.draft,
    state: states[states.length - 1],
    rawConfidence: Math.min(...ordered.map(({ draft }) => draft.rawConfidence)),
    legacyEvidenceRefs: sortedStrings2(ordered.flatMap(({ draft }) => draft.legacyEvidenceRefs)),
    claimScope: scopes[scopes.length - 1],
    counterEvidence: sortedStrings2(ordered.flatMap(({ draft }) => draft.counterEvidence ?? [])),
    counterEvidenceState: worstCounterEvidenceState2(
      ordered.map(({ draft }) => inferredCounterEvidenceState(draft))
    ),
    // Provenance never upgrades: if any duplicate claims a measurement origin,
    // the merged diagnostic keeps the most conservative reading.
    ...mergedOrigin(ordered) ? { origin: mergedOrigin(ordered) } : {},
    ...mergedDetails(ordered) ? { details: mergedDetails(ordered) } : {}
  };
  return {
    draft: mergedDraft,
    resolution: {
      ids: sortedStrings2(ordered.flatMap(({ resolution }) => resolution.ids)),
      unresolved: sortedStrings2(ordered.flatMap(({ resolution }) => resolution.unresolved))
    }
  };
}
__name(mergeDrafts, "mergeDrafts");
function assertLedger(ledger, runId) {
  const records = ledger.map((record2) => {
    const parsed = EvidenceRefSchema.parse(record2);
    if (parsed.runId !== runId) throw new Error("Evidence ledger has a cross-run identity.");
    return parsed;
  });
  const byId = /* @__PURE__ */ new Map();
  for (const record2 of records) {
    const previous = byId.get(record2.id);
    if (previous && (previous.runId !== record2.runId || previous.kind !== record2.kind || previous.locator !== record2.locator)) {
      throw new Error(`Evidence ID collision for ${record2.id}.`);
    }
    byId.set(record2.id, record2);
  }
  return records;
}
__name(assertLedger, "assertLedger");
function pageUrlFromValue(value) {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return void 0;
    return displayLocator(parsed.toString());
  } catch {
    return void 0;
  }
}
__name(pageUrlFromValue, "pageUrlFromValue");
function affectedPagesFromResolution(ledger, resolution, details) {
  const resolvedIds = new Set(resolution.ids);
  const pages = [];
  for (const record2 of ledger) {
    if (!resolvedIds.has(record2.id)) continue;
    if (record2.kind !== "page") continue;
    if (record2.pageUrl) pages.push(record2.pageUrl);
    pages.push(record2.locator);
  }
  if (details?.kind === "conversion_defect") {
    pages.push(details.conversionDefect.pageUrl, ...details.conversionDefect.seenOn);
  }
  return sortedStrings2(
    pages.map(pageUrlFromValue).filter((page) => page !== void 0)
  ).slice(0, 1e3);
}
__name(affectedPagesFromResolution, "affectedPagesFromResolution");
function boundedFingerprint(canonical2) {
  return `fp_${fnv1a643(canonical2)}`;
}
__name(boundedFingerprint, "boundedFingerprint");
function materializeDiagnostics(input) {
  const workspaceId = boundedIdentity(input.workspaceId, "workspaceId");
  const runId = boundedIdentity(input.runId, "runId");
  const clientId2 = boundedIdentity(input.clientId, "clientId");
  if (input.coverage === void 0) throw new Error("Materialization coverage is required.");
  const ledger = assertLedger(input.ledger, runId);
  const byFingerprint = /* @__PURE__ */ new Map();
  for (const raw of input.drafts) {
    assertNoCrossIdentity(raw, { workspaceId, runId, clientId: clientId2 }, "Diagnostic draft");
    const draft = parseQualityDiagnostic(raw);
    const resolution = resolveLegacyEvidenceRefs(ledger, draft.legacyEvidenceRefs);
    const fingerprint = fingerprintFor(draft);
    const group = byFingerprint.get(fingerprint) ?? [];
    group.push({ draft, resolution });
    byFingerprint.set(fingerprint, group);
  }
  const materialized = [];
  const idFingerprints = /* @__PURE__ */ new Map();
  const fingerprintCanonicals = /* @__PURE__ */ new Map();
  for (const fingerprint of [...byFingerprint.keys()].sort(compareStrings2)) {
    const merged = mergeDrafts(byFingerprint.get(fingerprint));
    const draft = merged.draft;
    const resolution = merged.resolution;
    const assessment = assessDiagnostic(draft, input.coverage, resolution);
    const id = `diag_${fnv1a643(`${runId}|${fingerprint}`)}`;
    const previousFingerprint = idFingerprints.get(id);
    if (previousFingerprint && previousFingerprint !== fingerprint) {
      throw new Error(`Diagnostic ID collision for ${id}.`);
    }
    idFingerprints.set(id, fingerprint);
    const bounded3 = boundedFingerprint(fingerprint);
    const previousCanonical = fingerprintCanonicals.get(bounded3);
    if (previousCanonical && previousCanonical !== fingerprint) {
      throw new Error(`Diagnostic fingerprint collision for ${bounded3}.`);
    }
    fingerprintCanonicals.set(bounded3, fingerprint);
    const definition3 = definitionForProblemType(draft.problemType);
    const state = definition3.requiresCompleteCoverage && assessment.coverage !== "complete" && draft.state === "observed" ? "unknown" : draft.state;
    const diagnostic = DiagnosticSchema.parse({
      id,
      workspaceId,
      runId,
      clientId: clientId2,
      detectorId: draft.detectorId,
      detectorVersion: draft.detectorVersion,
      category: draft.category,
      problemType: draft.problemType,
      subject: draft.subject,
      observation: draft.observation,
      evidenceRefs: resolution.ids,
      assessment,
      state,
      fingerprint: bounded3,
      affectedPages: affectedPagesFromResolution(ledger, resolution, draft.details),
      ...draft.origin ? { origin: draft.origin } : {},
      ...draft.details ? { details: draft.details } : {},
      createdAt: `run:${runId}`
    });
    materialized.push(diagnostic);
  }
  return materialized.sort(
    (left, right) => compareStrings2(idFingerprints.get(left.id) ?? left.fingerprint, idFingerprints.get(right.id) ?? right.fingerprint)
  );
}
__name(materializeDiagnostics, "materializeDiagnostics");
function rootKey(diagnostic) {
  const definition3 = definitionForProblemType(diagnostic.problemType);
  if (diagnostic.details?.kind === "conversion_defect") {
    const target = diagnostic.details.conversionDefect.target;
    if (target) return `target:${canonicalSubjectLocator(target)}`;
    return `page:${canonicalSubjectLocator(diagnostic.details.conversionDefect.pageUrl)}`;
  }
  if (definition3.category === "technical_reliability" || definition3.category === "accessibility_usability") {
    return `rule:${diagnostic.detectorId.toLowerCase()}:${hostOf(diagnostic.subject.key)}`;
  }
  return `${diagnostic.subject.kind}:${canonicalSubjectLocator(diagnostic.subject.key)}`;
}
__name(rootKey, "rootKey");
function compatibleGroupKey(diagnostic) {
  return [
    diagnostic.category,
    diagnostic.problemType,
    rootKey(diagnostic)
  ].join("|");
}
__name(compatibleGroupKey, "compatibleGroupKey");
function assertCompatibleDiagnostics(diagnostics) {
  if (diagnostics.length === 0) return;
  const first = diagnostics[0];
  for (const diagnostic of diagnostics) {
    if (diagnostic.workspaceId !== first.workspaceId) throw new Error("Diagnostics cross workspace boundary.");
    if (diagnostic.runId !== first.runId) throw new Error("Diagnostics cross run boundary.");
    if (diagnostic.clientId !== first.clientId) throw new Error("Diagnostics cross client boundary.");
  }
}
__name(assertCompatibleDiagnostics, "assertCompatibleDiagnostics");
function problemKey(diagnostics) {
  if (diagnostics.length === 0) throw new Error("Cannot derive a problem key without diagnostics.");
  assertCompatibleDiagnostics(diagnostics);
  const first = diagnostics[0];
  const key = compatibleGroupKey(first);
  if (diagnostics.some((diagnostic) => compatibleGroupKey(diagnostic) !== key)) {
    throw new Error("Problem key requires compatible diagnostics.");
  }
  return [first.clientId, first.category, first.problemType, rootKey(first)].join("|");
}
__name(problemKey, "problemKey");
function policyInputForDiagnostic(diagnostic) {
  return {
    detectorId: diagnostic.detectorId,
    detectorVersion: diagnostic.detectorVersion,
    category: diagnostic.category,
    problemType: diagnostic.problemType,
    subject: diagnostic.subject,
    observation: diagnostic.observation,
    legacyEvidenceRefs: diagnostic.evidenceRefs,
    rawConfidence: diagnostic.assessment.grade === "strong" ? 0.95 : diagnostic.assessment.grade === "moderate" ? 0.75 : 0.45,
    state: diagnostic.state,
    ...diagnostic.details ? { details: diagnostic.details } : {},
    claimScope: diagnostic.assessment.claimScope,
    counterEvidence: diagnostic.assessment.counterEvidence,
    counterEvidenceState: diagnostic.assessment.counterEvidenceState
  };
}
__name(policyInputForDiagnostic, "policyInputForDiagnostic");
function combineAssessments(diagnostics) {
  const scopes = diagnostics.map((diagnostic) => diagnostic.assessment.claimScope);
  const claimScope = scopes.sort((left, right) => claimScopeRank(left) - claimScopeRank(right))[scopes.length - 1];
  const counterEvidenceState = worstCounterEvidenceState2(
    diagnostics.map((diagnostic) => diagnostic.assessment.counterEvidenceState)
  );
  return {
    grade: weakestEvidenceGrade(diagnostics.map((diagnostic) => diagnostic.assessment.grade)),
    claimScope,
    coverage: weakestCoverage(diagnostics.map((diagnostic) => diagnostic.assessment.coverage)),
    limitations: sortedStrings2(diagnostics.flatMap((diagnostic) => diagnostic.assessment.limitations)),
    counterEvidence: sortedStrings2(diagnostics.flatMap((diagnostic) => diagnostic.assessment.counterEvidence)),
    counterEvidenceState,
    unassessedEvidence: sortedStrings2(
      diagnostics.flatMap((diagnostic) => diagnostic.assessment.unassessedEvidence)
    )
  };
}
__name(combineAssessments, "combineAssessments");
function claimScopeRank(scope) {
  return { observed: 0, supported_inference: 1, hypothesis: 2 }[scope];
}
__name(claimScopeRank, "claimScopeRank");
function gateForCluster(diagnostics, assessment) {
  const gates = diagnostics.map(
    (diagnostic) => qualityGateForDiagnostic(policyInputForDiagnostic(diagnostic), diagnostic.assessment)
  );
  if (gates.includes("rejected") || assessment.claimScope === "hypothesis") return "rejected";
  if (gates.includes("limited")) return "limited";
  return "supported";
}
__name(gateForCluster, "gateForCluster");
function affectedPages(diagnostics) {
  return sortedStrings2(diagnostics.flatMap((diagnostic) => diagnostic.affectedPages));
}
__name(affectedPages, "affectedPages");
function countLabel(count5, singular) {
  return `${count5} ${count5 === 1 ? singular : `${singular}s`}`;
}
__name(countLabel, "countLabel");
function surfaceLabel(diagnostics) {
  const first = diagnostics[0];
  const display = displayLocator(first.subject.key).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return JSON.stringify(display.slice(0, 300));
}
__name(surfaceLabel, "surfaceLabel");
function safeStatement(diagnostics, assessment) {
  const first = diagnostics[0];
  const pages = affectedPages(diagnostics);
  const count5 = pages.length;
  const label = surfaceLabel(diagnostics);
  const pageCount = /* @__PURE__ */ __name((singular) => count5 > 0 ? countLabel(count5, singular) : `the supplied evidence (readable page count unavailable)`, "pageCount");
  const pageSubject = /* @__PURE__ */ __name((singular) => {
    if (count5 === 0) return "the supplied evidence (readable page count unavailable) has";
    return `${countLabel(count5, singular)} ${count5 === 1 ? "has" : "have"}`;
  }, "pageSubject");
  if (assessment.claimScope === "hypothesis") {
    return "A hypothesis was recorded for manual validation; the supplied evidence does not establish a published condition.";
  }
  switch (first.problemType) {
    case "missing_service_path":
      return assessment.coverage === "complete" ? `No dedicated service path was verified for ${label}.` : `A dedicated service path was not observed in the currently reviewed evidence for ${label}.`;
    case "no_service_section":
      return assessment.coverage === "complete" ? `No service section was verified in the inspected site evidence for ${label}.` : `A service section was not observed in the currently reviewed evidence for ${label}.`;
    // These subtypes already carry a precise, bounded, sanitized observation
    // written by the detector or read by the model. Repeating a generic
    // template here would drop the literal values the agency needs to see —
    // which values conflict, which text is placeholder, which action is inert.
    case "field_value_mismatch":
    case "inconsistent_contact_fact":
    case "inconsistent_content_fact":
    case "mismatched_item_content":
    case "placeholder_production_content":
    case "unreplaced_platform_default":
    case "dead_action_target":
    case "form_friction":
    case "obscured_conversion_action":
    case "conflicting_action":
      return first.observation.trim().slice(0, 4e3);
    case "missing_page_title":
      return `${pageSubject("readable page")} no non-empty HTML title in the supplied evidence.`;
    case "duplicate_page_title":
      return duplicateTitleStatement(diagnostics);
    case "thin_service_content":
      return thinServiceStatement(first);
    case "form_accessibility_failure":
      return formAccessibilityStatement(diagnostics);
    // The measured accessibility and rendered conditions already carry the
    // element, the measurement or the label state in the detector's own
    // sentence. Falling through to the generic template published
    // "The supplied evidence records small rendered target at <url>" — a
    // finding that names nothing a person could act on.
    case "small_rendered_target":
      return smallTargetStatement(diagnostics);
    case "missing_accessible_name":
    case "rendered_experience_failure":
      return distinctObservationStatement(diagnostics);
    case "missing_primary_heading":
      return `${pageSubject("readable page")} no non-empty primary heading in the supplied evidence.`;
    case "missing_meta_description":
      return `${pageSubject("readable page")} no observed non-empty meta description.`;
    case "missing_business_schema":
      return `${pageSubject("readable page")} no observed LocalBusiness or Service structured-data type.`;
    case "missing_image_text_alternative":
      return imageAltStatement(diagnostics);
    case "broken_internal_link":
      return brokenLinkStatement(first, count5);
    case "broken_conversion_path":
      return `A conversion-path target on ${label} has the recorded link, form, or HTTP defect.`;
    case "competitor_service_gap":
      return `Named competitor evidence records a service difference for ${label}.`;
    case "visual_conversion_obstacle":
      return `The captured page shows an obstructed action at ${label}.`;
  }
  return `The supplied evidence records ${first.problemType.replaceAll("_", " ")} at ${label}.`;
}
__name(safeStatement, "safeStatement");
function imageAltStatement(diagnostics) {
  const aggregates = [];
  const perPage = [];
  for (const diagnostic of diagnostics) {
    const measured = measuredMissingAltImages(diagnostic.observation);
    if (measured === null) continue;
    (measured.aggregate ? aggregates : perPage).push(measured.count);
  }
  const counts = aggregates.length > 0 ? aggregates : perPage;
  if (counts.length === 0) {
    return "The supplied evidence records images without a text alternative, but not how many were seen, so no count is published.";
  }
  const total = counts.reduce((sum, count5) => sum + count5, 0);
  return `${countLabel(total, "readable image")} ${total === 1 ? "has" : "have"} no observed text alternative.`;
}
__name(imageAltStatement, "imageAltStatement");
function measuredMissingAltImages(observation) {
  const aggregate = /^(\d+)\s+images?\s+across\s+\d+\s+affected\s+pages?\b/i.exec(
    observation.trim()
  );
  if (aggregate) {
    const count5 = Number.parseInt(aggregate[1], 10);
    if (count5 > 0) return { count: count5, aggregate: true };
  }
  const page = /\bcontains\s+(\d+)\s+images?\s+without an alt attribute\b/i.exec(observation);
  if (page) {
    const count5 = Number.parseInt(page[1], 10);
    if (count5 > 0) return { count: count5, aggregate: false };
  }
  return null;
}
__name(measuredMissingAltImages, "measuredMissingAltImages");
function brokenLinkStatement(first, pageCount) {
  const observation = first.observation.trim();
  const named = /\bpoints to\s+(\S+?),\s*which returned HTTP (\d{3})/i.exec(observation);
  if (!named) {
    return `An internal link returned a failing response on ${pageCount > 0 ? countLabel(pageCount, "page") : "the supplied evidence"}; the supplied evidence does not name the link or its destination, so it has to be re-checked on the live site.`;
  }
  const scope = pageCount > 1 ? ` The same target is linked from ${countLabel(pageCount, "page")}.` : "";
  return `${observation.replace(/\.$/, "")}.${scope}`;
}
__name(brokenLinkStatement, "brokenLinkStatement");
function thinServiceStatement(first) {
  const observation = first.observation.trim();
  const limit = /(\d+)-word/i.exec(observation)?.[1] ?? String(THIN_SERVICE_PAGE_WORD_LIMIT);
  const measured = pageMeasurements(observation);
  if (measured.length === 0) {
    const pages = affectedPages([first]);
    if (pages.length === 1) {
      return `A service page on ${pages[0]} is below the observed ${limit}-word content threshold; the supplied evidence does not record the measured length.`;
    }
    return `Service pages are below the observed ${limit}-word content threshold; the supplied evidence does not record their measured lengths.`;
  }
  if (measured.length === 1) {
    const only = measured[0];
    return `A service page on ${only.pageUrl} is below the observed ${limit}-word content threshold (${only.wordCount} words).`;
  }
  const list = measured.map((entry2) => `${entry2.pageUrl} (${entry2.wordCount} words)`).join("; ");
  return `${countLabel(measured.length, "service page")} ${measured.length === 1 ? "is" : "are"} below the observed ${limit}-word content threshold: ${list}.`;
}
__name(thinServiceStatement, "thinServiceStatement");
function pageMeasurements(observation) {
  const pairs = [];
  const contains = /(https?:\/\/\S+?)\s+contains\s+(\d+)\s+words?\b/i.exec(observation);
  if (contains) {
    pairs.push({ pageUrl: contains[1], wordCount: Number.parseInt(contains[2], 10) });
  }
  for (const match of observation.matchAll(/(https?:\/\/[^\s;]+?)\s*\((\d+)\s+words?\)/gi)) {
    const pageUrl = match[1];
    const wordCount = Number.parseInt(match[2], 10);
    if (!pairs.some((entry2) => entry2.pageUrl === pageUrl)) pairs.push({ pageUrl, wordCount });
  }
  const order = [...observation.matchAll(/https?:\/\/[^\s;]+/g)].map((match) => match[0]);
  pairs.sort((left, right) => order.indexOf(left.pageUrl) - order.indexOf(right.pageUrl));
  return pairs;
}
__name(pageMeasurements, "pageMeasurements");
function formAccessibilityStatement(diagnostics) {
  const groups = formControlGroups(diagnostics);
  const controlCount = groups.reduce((total, group) => total + group.occurrences, 0);
  if (controlCount === 0) {
    const observedPages = new Set(
      affectedPages(diagnostics).map((page) => documentIdentity(page))
    );
    const scope2 = observedPages.size > 0 ? ` across ${countLabel(observedPages.size, "page")}` : "";
    return `The supplied evidence records a form-labelling condition${scope2}, but the controls it names do not reconcile into a trustworthy distinct count, so no number is published. The condition itself is recorded; only the size of the affected set could not be established.`;
  }
  const byClause = /* @__PURE__ */ new Map();
  for (const group of groups) {
    byClause.set(group.clause, (byClause.get(group.clause) ?? 0) + group.occurrences);
  }
  const clauseCounts = [...byClause.entries()].sort(
    (left, right) => right[1] - left[1] || compareStrings2(left[0], right[0])
  );
  const pages = [
    ...new Set(groups.flatMap((group) => group.members.map((member) => documentIdentity(member.pageUrl))))
  ].sort();
  const scope = pages.length > 0 ? ` across ${countLabel(pages.length, "page")}` : "";
  const subject = `${countLabel(controlCount, "form control")}${scope}`;
  if (clauseCounts.length === 1) {
    return `${subject} ${controlCount === 1 ? "has" : "have"} no persistent label; ${controlCount === 1 ? "it relies" : "they rely"} ${formReasonClause(clauseCounts[0][0], controlCount)}.`;
  }
  const clauses = clauseCounts.map(
    ([clause, count5]) => `${countLabel(count5, "form control")} ${count5 === 1 ? "relies" : "rely"} ${formReasonClause(clause, count5)}`
  );
  return `${subject} have no persistent label: ${clauses.join("; ")}.`;
}
__name(formAccessibilityStatement, "formAccessibilityStatement");
var FORM_REASON_CLAUSE = {
  placeholder: {
    one: "on placeholder text as its only label, so the label disappears once the field is filled in",
    many: "on placeholder text as their only label, so the label disappears once the fields are filled in"
  },
  name: {
    one: "on an internal name attribute rather than a visible label",
    many: "on an internal name attribute rather than a visible label"
  },
  none: {
    one: "no label, placeholder or name attribute at all",
    many: "no label, placeholder or name attribute at all"
  },
  empty: {
    one: "no label, placeholder or name attribute at all",
    many: "no label, placeholder or name attribute at all"
  }
};
function formReasonClause(clause, count5) {
  const entry2 = FORM_REASON_CLAUSE[clause];
  if (!entry2) return "no persistent label";
  return count5 === 1 ? entry2.one : entry2.many;
}
__name(formReasonClause, "formReasonClause");
var FORM_REASON_STRENGTH = { none: 3, empty: 3, name: 2, placeholder: 1 };
function formControlGroups(diagnostics) {
  const members2 = [];
  for (const diagnostic of diagnostics) {
    const parsed = parseFormControlObservation(diagnostic.observation, formControlIdentity(diagnostic));
    if (!parsed) continue;
    if (!parsed.elementKey) continue;
    members2.push({
      // Identity is the DOCUMENT plus the page-local control key. The key alone
      // must not establish cross-page identity: it is assigned within the page,
      // and on Parkway six of fourteen keys name a different control on a
      // different page, so merging on it invented one control where the evidence
      // showed several.
      signature: `${documentIdentity(parsed.pageUrl)}|${parsed.elementKey}`,
      reason: parsed.reason,
      elementKey: parsed.elementKey,
      pageUrl: parsed.pageUrl,
      rank: LANE_RANK[parsed.source] ?? 0
    });
  }
  if (members2.length === 0) return [];
  const bestRankByPage = /* @__PURE__ */ new Map();
  for (const member of members2) {
    bestRankByPage.set(member.pageUrl, Math.max(bestRankByPage.get(member.pageUrl) ?? 0, member.rank));
  }
  const strongestLane = members2.filter(
    (member) => member.rank === bestRankByPage.get(member.pageUrl)
  );
  const bySignature = /* @__PURE__ */ new Map();
  for (const member of strongestLane) {
    bySignature.set(member.signature, [...bySignature.get(member.signature) ?? [], member]);
  }
  const groups = [];
  for (const group of bySignature.values()) {
    const reasons = [...new Set(group.map((member) => member.reason))].sort(
      (left, right) => (FORM_REASON_STRENGTH[right] ?? 0) - (FORM_REASON_STRENGTH[left] ?? 0)
    );
    groups.push({
      members: group,
      clause: Object.prototype.hasOwnProperty.call(FORM_REASON_CLAUSE, reasons[0]) ? reasons[0] : "none",
      occurrences: 1
    });
  }
  groups.sort((left, right) => compareStrings2(left.members[0].signature, right.members[0].signature));
  return groups;
}
__name(formControlGroups, "formControlGroups");
var LANE_RANK = { "form-field": 3, accessibility: 2, rendered: 1, unknown: 0 };
function formControlIdentity(diagnostic) {
  const keys = diagnostic.details?.kind === "broad" ? diagnostic.details.observationKeys : void 0;
  return keys?.find((key) => key.startsWith("control-identity:"));
}
__name(formControlIdentity, "formControlIdentity");
function duplicateTitleStatement(diagnostics) {
  const documents = /* @__PURE__ */ new Set();
  for (const diagnostic of diagnostics) {
    const pages = diagnostic.affectedPages ?? [];
    if (pages.length === 0) {
      documents.add(documentIdentity(diagnostic.subject.key));
      continue;
    }
    for (const page of pages) documents.add(documentIdentity(page));
  }
  const count5 = Math.max(documents.size, 1);
  const title2 = /"([^"]+)"/.exec(diagnostics[0]?.observation ?? "")?.[1] ?? /“([^”]+)”/.exec(diagnostics[0]?.observation ?? "")?.[1];
  const subject = countLabel(count5, "readable page");
  return title2 ? `The document title \u201C${title2}\u201D is repeated across ${subject} in the supplied evidence.` : `The same HTML title is repeated across ${subject} in the supplied evidence.`;
}
__name(duplicateTitleStatement, "duplicateTitleStatement");
function parseFormControlObservation(observation, identityKey) {
  const reason = /labelled only by its placeholder attribute/i.test(observation) ? "placeholder" : /labelled only by its name attribute/i.test(observation) ? "name" : /has no label, placeholder or name attribute/i.test(observation) ? "none" : null;
  if (!reason) return null;
  const carried = identityKey?.startsWith("control-identity:") ? identityKey.slice("control-identity:".length) : "";
  const carriedKey = carried && carried !== "unknown" ? carried : "";
  const parsedShape = /^The (\w[\w-]*) control in the form on (\S+?) has\b/.exec(observation);
  if (parsedShape) {
    return {
      pageUrl: parsedShape[2],
      elementKey: carriedKey || /\b(form:\d+:[a-z-]*field:\d+)\b/.exec(observation)?.[1] || "",
      controlType: parsedShape[1],
      reason,
      source: "form-field"
    };
  }
  const renderedShape = /^The rendered (\w[\w-]*) on (\S+?) has a\b/.exec(observation);
  if (renderedShape) {
    return {
      pageUrl: renderedShape[2],
      elementKey: carriedKey || /\b([a-z]+:\d+)\b/.exec(observation)?.[1] || "",
      controlType: renderedShape[1],
      reason,
      source: "rendered"
    };
  }
  const typedShape = /^The typed accessibility observation on (\S+?) records missing-label for (\S+)\./.exec(
    observation
  );
  if (typedShape) {
    return {
      pageUrl: typedShape[1],
      elementKey: carriedKey || typedShape[2],
      controlType: "",
      reason,
      source: "accessibility"
    };
  }
  return null;
}
__name(parseFormControlObservation, "parseFormControlObservation");
function joinClauses(clauses) {
  if (clauses.length === 1) return clauses[0];
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`;
  return `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;
}
__name(joinClauses, "joinClauses");
function distinctObservationStatement(diagnostics) {
  const observations = [
    ...new Set(diagnostics.map((diagnostic) => diagnostic.observation.trim()).filter(Boolean))
  ];
  if (observations.length === 0) {
    return "The supplied evidence records an accessibility condition, but no observation text was retained.";
  }
  const groups = [
    {
      key: "accessible-name",
      pages: /* @__PURE__ */ new Set(),
      controls: 0,
      sentence: /* @__PURE__ */ __name((n, p) => `${countLabel(n, "interactive control")} across ${countLabel(p, "page")} ${n === 1 ? "is" : "are"} recorded with no accessible name, so a screen-reader user hears a control that does not say what it does.`, "sentence")
    },
    {
      key: "form-label",
      pages: /* @__PURE__ */ new Set(),
      controls: 0,
      sentence: /* @__PURE__ */ __name((n, p) => `${countLabel(n, "form field")} across ${countLabel(p, "page")} ${n === 1 ? "has" : "have"} no persistent label a visitor can still read once the field is filled in.`, "sentence")
    },
    {
      key: "rendered-region",
      pages: /* @__PURE__ */ new Set(),
      controls: 0,
      sentence: /* @__PURE__ */ __name((n, p) => `${countLabel(n, "rendered region")} across ${countLabel(p, "page")} ${n === 1 ? "is" : "are"} clipped or measure no rendered area in the capture, so that part of the page could not be reviewed from it.`, "sentence")
    }
  ];
  const groupFor = /* @__PURE__ */ __name((key) => groups.find((group) => group.key === key), "groupFor");
  const unmatched = [];
  for (const observation of observations) {
    const typed = /^The typed accessibility observation on (\S+?) records ([\w-]+) for \S+\.$/.exec(observation);
    if (typed) {
      const group = groupFor(typed[2] === "missing-accessible-name" ? "accessible-name" : "form-label");
      group.pages.add(documentIdentity(typed[1]));
      group.controls += 1;
      continue;
    }
    const unnamedCta = /^The [\w-]+ on (\S+?) has no literal label or accessible name in the typed CTA evidence\.$/.exec(
      observation
    );
    if (unnamedCta) {
      const group = groupFor("accessible-name");
      group.pages.add(documentIdentity(unnamedCta[1]));
      group.controls += 1;
      continue;
    }
    const renderedLabel = /^The rendered ([\w-]+) on (\S+?) has a (?:missing|empty) literal label\/access-name state\.$/.exec(
      observation
    );
    if (renderedLabel) {
      const group = groupFor(renderedLabel[1] === "form-control" ? "form-label" : "accessible-name");
      group.pages.add(documentIdentity(renderedLabel[2]));
      group.controls += 1;
      continue;
    }
    const renderedRegion = /^The rendered (?:[\w-]+) observation on (\S+?) is clipped or has zero rendered area; the affected region requires review\.$/.exec(
      observation
    );
    if (renderedRegion) {
      const group = groupFor("rendered-region");
      group.pages.add(documentIdentity(renderedRegion[1]));
      group.controls += 1;
      continue;
    }
    unmatched.push(sanitizeCustomerObservation(observation));
  }
  const sentences = groups.filter((group) => group.controls > 0).map((group) => group.sentence(group.controls, group.pages.size));
  return [...sentences, ...unmatched].join(" ");
}
__name(distinctObservationStatement, "distinctObservationStatement");
function sanitizeCustomerObservation(observation) {
  return observation.replace(/\b(?:cta|input|form|accessibility|rendered-element|form-field|landmark|section):[^\s.,;)]+/gi, "the control").replace(/\bmissing-accessible-names?\b/gi, "no accessible name").replace(/\bmissing-labels?\b/gi, "no label").replace(/\bempty-labels?\b/gi, "an empty label").replace(/\bmissing-alts?\b/gi, "no text alternative").replace(/\binvalid-aria-references?\b/gi, "an invalid aria reference").replace(/\btyped accessibility observations?\b/gi, "accessibility evidence").replace(/\s+/g, " ").trim();
}
__name(sanitizeCustomerObservation, "sanitizeCustomerObservation");
function smallTargetStatement(diagnostics) {
  const measured = diagnostics.map((diagnostic) => {
    const match = /The rendered (\w[\w-]*) on (\S+) measures (\d+)×(\d+)px/i.exec(
      diagnostic.observation
    );
    if (!match) return null;
    return {
      kind: match[1],
      pageUrl: match[2],
      elementKey: formControlIdentity(diagnostic)?.slice("control-identity:".length) ?? /\b([a-z]+:\d+)\b/.exec(diagnostic.observation)?.[1] ?? "",
      width: match[3],
      height: match[4]
    };
  }).filter((value) => value !== null);
  if (measured.length === 0) return distinctObservationStatement(diagnostics);
  const byControl = /* @__PURE__ */ new Map();
  for (const value of measured) {
    const key = value.elementKey || `${value.kind}|${value.width}\xD7${value.height}`;
    if (!byControl.has(key)) byControl.set(key, value);
  }
  const distinct = [...byControl.values()];
  const pages = new Set(measured.map((value) => documentIdentity(value.pageUrl)));
  const kinds = [...new Set(distinct.map((value) => value.kind))].sort();
  const dimensions = [...new Set(distinct.map((value) => `${value.width}\xD7${value.height}px`))];
  const subject = `${countLabel(distinct.length, "control")} ${distinct.length === 1 ? "measures" : "measure"}`;
  return `${subject} ${joinClauses(dimensions)} across ${countLabel(
    pages.size,
    "page"
  )}, each below the observed 44px target dimension (${joinClauses(kinds)}).`;
}
__name(smallTargetStatement, "smallTargetStatement");
function safeWhyItMatters(problemType, claimScope) {
  if (claimScope === "hypothesis") {
    return "This item is retained for audit only; manual validation is required before any condition is stated.";
  }
  switch (problemType) {
    case "broken_conversion_path":
      return "A visitor using the recorded path may encounter the observed defect.";
    case "visual_conversion_obstacle":
      return "A visitor using the captured viewport may encounter the recorded obstruction.";
    case "competitor_service_gap":
      return "The comparison identifies a service difference that should be reviewed against the current offer.";
    case "missing_service_path":
    case "no_service_section":
      return "The inspected service path does not expose the requested offering in the available evidence.";
    case "placeholder_production_content":
      return "A visitor reading this page is shown text written for whoever built the site, not content about the business.";
    case "unreplaced_platform_default":
      return "The page still carries a platform default in place of the business's own details.";
    case "mismatched_item_content":
      return "The content attached to this item describes something else, so the item's own meaning is not communicated.";
    case "field_value_mismatch":
      return "A visitor who reads one value and follows the action reaches a different destination.";
    case "inconsistent_contact_fact":
      return "Visitors cannot tell which contact value the business intends them to use.";
    case "inconsistent_content_fact":
      return "Two owned pages state different values for the same fact, so the site is not self-consistent.";
    case "dead_action_target":
      return "Whether the action works cannot be established from the served markup alone.";
    case "form_friction":
      return "The form's structure may add effort to an enquiry; whether it obstructs completion needs a person to check.";
    // The subtypes below previously fell through to the generic sentence "The
    // supplied evidence records a site condition that can be checked again after
    // a bounded change", which tells a business owner nothing about their own
    // website. Each now states the consequence the subtype's policy declares.
    case "missing_page_title":
      return "Visitors and search engines have less precise identification of the page.";
    case "duplicate_page_title":
      return "Search results and browser tabs show the same title for different pages, so a visitor cannot tell them apart before opening them.";
    case "missing_primary_heading":
      return "Visitors and assistive technology are given no single top-level heading that says what the page is about.";
    case "missing_meta_description":
      return "Search engines have no supplied summary for the page, so the listing snippet is generated from page content rather than the business's own wording.";
    case "missing_business_schema":
      return "Search engines have no machine-readable statement of the business or its services on the affected pages, so rich results that depend on that markup cannot be produced.";
    case "missing_image_text_alternative":
      return "People who cannot see the image are given no equivalent text for it.";
    case "broken_internal_link":
      return "A visitor following the recorded link reaches a failure instead of the page it names.";
    case "thin_service_content":
      return "A visitor deciding whether to enquire has very little on the page describing the service.";
    case "missing_accessible_name":
      return "A screen-reader user hears a control that does not say what it does, so it cannot be used with confidence.";
    case "form_accessibility_failure":
      return "A field whose only label disappears once it is filled in is hard to check before submitting, and a screen-reader user loses the field's purpose.";
    case "small_rendered_target":
      return "Controls below the observed 44px target dimension are harder to hit accurately, particularly on a phone.";
    case "rendered_experience_failure":
      return "Part of the captured page could not be reviewed, so what a visitor sees there is not established by this audit.";
    case "measured_performance_regression":
      return "The measured response is slow enough to add waiting time to the visit; it is a lab measurement, not a statement about real visitors.";
    case "resource_failure":
      return "A resource the page asks for did not load, so part of the page may not render for a visitor.";
    case "console_error":
      return "The page reported a script error while loading, which can leave interactive parts of the page not working.";
    case "stale_business_fact":
      return "A visitor acting on the recorded detail may use information the business no longer intends to publish.";
    case "conflicting_action":
      return "Two controls that look like the same action lead to different destinations; which one is intended needs the business to say.";
    case "obscured_conversion_action":
      return "The measured rendered geometry places another element over the conversion action, which can stop a visitor using it.";
    default:
      return "The supplied evidence records a site condition that can be checked again after a bounded change.";
  }
}
__name(safeWhyItMatters, "safeWhyItMatters");
function safeBusinessConsequence(problemType, claimScope) {
  if (claimScope === "hypothesis") {
    return "No business consequence is claimed from this hypothesis.";
  }
  switch (problemType) {
    case "missing_page_title":
    case "duplicate_page_title":
      return "Visitors and assistive tools may have less precise page identification.";
    case "missing_primary_heading":
      return "Visitors may have less immediate orientation on the affected page.";
    case "missing_meta_description":
      return "The page has no observed summary field for a later review to validate.";
    case "missing_business_schema":
      return "The affected page has no observed structured-data signal for the recorded business type.";
    case "missing_image_text_alternative":
      return "People who cannot use the image may not receive the observed image meaning.";
    case "broken_internal_link":
      return "A visitor following the recorded internal link may reach the observed failure.";
    case "broken_conversion_path":
      return "A visitor using the recorded conversion path may be unable to reach its target.";
    default:
      return "The recorded condition should be validated against the current site and client context.";
  }
}
__name(safeBusinessConsequence, "safeBusinessConsequence");
function validationSteps(problemType) {
  switch (problemType) {
    case "missing_service_path":
    case "no_service_section":
      return ["Review the requested service path and re-run the bounded crawl."];
    case "broken_conversion_path":
      return ["Open the recorded target and confirm the link or form response."];
    case "visual_conversion_obstacle":
      return ["Inspect the cited viewport and confirm the action is visibly usable."];
    case "competitor_service_gap":
      return ["Review the named competitor evidence against the client's current offer."];
    default:
      return ["Re-run the crawl and verify the recorded page condition is resolved."];
  }
}
__name(validationSteps, "validationSteps");
function synthesizeProblemsInternal(input, hashIdentity) {
  const workspaceId = boundedIdentity(input.workspaceId, "workspaceId");
  const runId = boundedIdentity(input.runId, "runId");
  const clientId2 = boundedIdentity(input.clientId, "clientId");
  const byDiagnosticId = /* @__PURE__ */ new Map();
  for (const rawDiagnostic of input.diagnostics) {
    const parsed = DiagnosticSchema.parse(rawDiagnostic);
    if (parsed.workspaceId !== workspaceId) throw new Error("Diagnostic crosses workspace boundary.");
    if (parsed.runId !== runId) throw new Error("Diagnostic crosses run boundary.");
    if (parsed.clientId !== clientId2) throw new Error("Diagnostic crosses client boundary.");
    const canonical2 = stableJson2(parsed);
    const previous = byDiagnosticId.get(parsed.id);
    if (previous && previous.canonical !== canonical2) {
      throw new Error(`Diagnostic ID conflict for ${parsed.id}.`);
    }
    if (!previous) byDiagnosticId.set(parsed.id, { diagnostic: parsed, canonical: canonical2 });
  }
  const diagnostics = [...byDiagnosticId.values()].map(({ diagnostic }) => diagnostic);
  assertCompatibleDiagnostics(diagnostics);
  const groups = /* @__PURE__ */ new Map();
  for (const diagnostic of diagnostics) {
    const key = compatibleGroupKey(diagnostic);
    const group = groups.get(key) ?? [];
    group.push(diagnostic);
    groups.set(key, group);
  }
  const result = [];
  const problemIds = /* @__PURE__ */ new Map();
  for (const key of [...groups.keys()].sort(compareStrings2)) {
    const group = groups.get(key).sort((left, right) => compareStrings2(left.id, right.id));
    const assessment = combineAssessments(group);
    const qualityGate = gateForCluster(group, assessment);
    const canonicalKey = problemKey(group);
    const root2 = rootKey(group[0]);
    const diagnosticIds = sortedStrings2(group.map((diagnostic) => diagnostic.id));
    const evidenceRefs = sortedStrings2(group.flatMap((diagnostic) => diagnostic.evidenceRefs));
    const pages = affectedPages(group);
    const rejectionReasons = [];
    if (qualityGate === "rejected") {
      if (assessment.claimScope === "hypothesis") rejectionReasons.push("Hypothesis claims cannot be published as supported problems.");
      if (assessment.grade === "insufficient") rejectionReasons.push("The supplied evidence is insufficient for this problem.");
      if (assessment.limitations.some((limitation3) => /conflicts with|contradict/i.test(limitation3))) {
        rejectionReasons.push("Counter-evidence conflicts with the proposed condition.");
      }
    } else if (qualityGate === "limited") {
      rejectionReasons.push(...assessment.limitations.filter((limitation3) => limitation3.length > 0));
      if (rejectionReasons.length === 0) rejectionReasons.push("The evidence is limited by the subtype policy.");
    }
    const problemId = `problem_${hashIdentity(`${runId}|${canonicalKey}`)}`;
    const previousCanonicalKey = problemIds.get(problemId);
    if (previousCanonicalKey && previousCanonicalKey !== canonicalKey) {
      throw new Error(`Problem ID collision for ${problemId}.`);
    }
    problemIds.set(problemId, canonicalKey);
    const problem = ProblemSchema.parse({
      id: problemId,
      workspaceId,
      runId,
      clientId: clientId2,
      canonicalKey,
      category: group[0].category,
      problemType: group[0].problemType,
      surfaceKey: root2,
      statement: safeStatement(group, assessment),
      whyItMatters: safeWhyItMatters(group[0].problemType, assessment.claimScope),
      businessConsequence: safeBusinessConsequence(group[0].problemType, assessment.claimScope),
      diagnosticIds,
      evidenceRefs,
      affectedPages: pages,
      assessment,
      validationSteps: validationSteps(group[0].problemType),
      qualityGate,
      rejectionReasons: sortedStrings2(rejectionReasons),
      createdAt: `run:${runId}`
    });
    result.push(problem);
  }
  return result.sort((left, right) => compareStrings2(left.canonicalKey, right.canonicalKey));
}
__name(synthesizeProblemsInternal, "synthesizeProblemsInternal");
function synthesizeProblems(input) {
  return synthesizeProblemsInternal(input, fnv1a643);
}
__name(synthesizeProblems, "synthesizeProblems");
