// src/core/rules/broadDetectors.ts
var LEGACY_DETECTOR_IDS = [
  "missing-service-page",
  "no-service-pages",
  "broken-conversion-path",
  "missing-title",
  "duplicate-title",
  "thin-service-page",
  "missing-h1",
  "broken-internal-link",
  "missing-meta-description",
  "missing-structured-data",
  "missing-image-alt"
];
var LEGACY_PROBLEM_TYPES = {
  "missing-service-page": "missing_service_path",
  "no-service-pages": "no_service_section",
  "broken-conversion-path": "broken_conversion_path",
  "missing-title": "missing_page_title",
  "duplicate-title": "duplicate_page_title",
  "thin-service-page": "thin_service_content",
  "missing-h1": "missing_primary_heading",
  "broken-internal-link": "broken_internal_link",
  "missing-meta-description": "missing_meta_description",
  "missing-structured-data": "missing_business_schema",
  "missing-image-alt": "missing_image_text_alternative"
};
var BROAD_CAP = 50;
function normalized(value) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}
__name(normalized, "normalized");
function compact2(value, max = 480) {
  const valueTrimmed = value.trim();
  return valueTrimmed.length <= max ? valueTrimmed : `${valueTrimmed.slice(0, Math.max(1, max - 1))}\u2026`;
}
__name(compact2, "compact");
function originFor(domain) {
  try {
    const value = domain.includes("://") ? domain : `https://${domain}`;
    return new URL(value).origin;
  } catch {
    return null;
  }
}
__name(originFor, "originFor");
function sameSite(url, origin) {
  if (typeof url !== "string" || !origin) return false;
  try {
    return new URL(url, origin).origin === origin;
  } catch {
    return false;
  }
}
__name(sameSite, "sameSite");
function pagesOf(context) {
  const pages = context.evidence?.site?.pages;
  return Array.isArray(pages) ? pages : [];
}
__name(pagesOf, "pagesOf");
function pageRef(url) {
  return `page:${sanitizeEvidenceUrl(url)}`;
}
__name(pageRef, "pageRef");
function scopedPageUrl(url) {
  return crawlKey(url);
}
__name(scopedPageUrl, "scopedPageUrl");
function unique2(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
}
__name(unique2, "unique");
function subjectKey(value) {
  return compact2(sanitizeEvidenceText(value || "site"), 480);
}
__name(subjectKey, "subjectKey");
function broadDraft(input) {
  return DiagnosticDraftSchema.parse({
    detectorId: input.detectorId,
    detectorVersion: "1",
    category: definitionForProblemType(input.problemType).category,
    problemType: input.problemType,
    subject: {
      kind: input.subject.kind,
      key: subjectKey(input.subject.key)
    },
    observation: compact2(sanitizeEvidenceText(input.observation), 4900),
    legacyEvidenceRefs: unique2(input.evidenceRefs.map((reference) => sanitizeEvidenceText(reference))),
    rawConfidence: input.rawConfidence ?? 0.85,
    state: input.state ?? "observed",
    ...input.origin ? { origin: input.origin } : {},
    details: {
      kind: "broad",
      evidenceType: input.evidenceType,
      observationKeys: unique2(input.observationKeys).slice(0, 100),
      ...input.measurements && input.measurements.length > 0 ? { measurements: input.measurements.slice(0, 20) } : {},
      ...input.contactFactKind ? { contactFactKind: input.contactFactKind } : {},
      reason: compact2(input.reason, 490)
    },
    claimScope: input.claimScope ?? "observed",
    counterEvidence: input.counterEvidence ? unique2(input.counterEvidence.map((evidence) => sanitizeEvidenceText(evidence))) : [],
    counterEvidenceState: input.counterEvidenceState ?? "not_checked"
  });
}
__name(broadDraft, "broadDraft");
function output(drafts, limitation3, rejected = 0, duplicateCount = 0) {
  return {
    drafts,
    rejected,
    duplicateCount,
    ...limitation3 ? { limitation: compact2(limitation3) } : {}
  };
}
__name(output, "output");
function extractionAvailable(page, key) {
  return Object.prototype.hasOwnProperty.call(page, key);
}
__name(extractionAvailable, "extractionAvailable");
function hasRenderedElementCoverage(context) {
  return Array.isArray(context.evidence.renderedPages) && context.evidence.renderedPages.some((page) => Array.isArray(page.elements) && page.elements.length > 0);
}
__name(hasRenderedElementCoverage, "hasRenderedElementCoverage");
function hasParsedElementCoverage(context, kind) {
  return pagesOf(context).some((page) => {
    if (kind === "element") return extractionAvailable(page, "ctas");
    return extractionAvailable(page, "accessibility") || page.ctas !== void 0 || page.forms.length > 0;
  });
}
__name(hasParsedElementCoverage, "hasParsedElementCoverage");
function primaryCtaLabel(cta) {
  const accessibleName = typeof cta.accessibleName === "string" ? cta.accessibleName : "";
  const label = typeof cta.label === "string" ? cta.label : "";
  const href2 = typeof cta.href === "string" ? cta.href : "";
  return `${accessibleName} ${label} ${href2}`.trim();
}
__name(primaryCtaLabel, "primaryCtaLabel");
function ctaDisplayName(cta) {
  for (const key of ["accessibleName", "label"]) {
    const value = cta[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().replace(/\s+/g, " ");
    }
  }
  return "";
}
__name(ctaDisplayName, "ctaDisplayName");
function isPrimaryAction(cta) {
  return cta.actionKind === "submit" || /quote|contact|book|schedule|appointment|call|request|get started|enquir|estimate|consult/i.test(
    primaryCtaLabel(cta)
  );
}
__name(isPrimaryAction, "isPrimaryAction");
function isVisitorEnteredControl(field) {
  if (!field || typeof field !== "object") return false;
  const controlType = field.controlType;
  if (typeof controlType !== "string") return false;
  return !["hidden", "submit", "button", "reset", "image"].includes(controlType.trim().toLocaleLowerCase());
}
__name(isVisitorEnteredControl, "isVisitorEnteredControl");
function hasPageSubmitAffordance(ctas) {
  if (!Array.isArray(ctas)) return false;
  return ctas.some((cta) => {
    if (!cta || typeof cta !== "object") return false;
    const record2 = cta;
    const actionKind = typeof record2.actionKind === "string" ? record2.actionKind : "";
    if (actionKind === "submit") return true;
    const href2 = typeof record2.href === "string" ? record2.href.trim() : "";
    return actionKind === "button" && href2 === "";
  });
}
__name(hasPageSubmitAffordance, "hasPageSubmitAffordance");
function describeSubmitAssociation(input) {
  if (input.hasSubmit) return null;
  if (hasPageSubmitAffordance(input.ctas) || !Array.isArray(input.ctas)) {
    return "has a submit control the parser could not associate with the form element, though the page records one";
  }
  return "has no submit control in the markup that was read";
}
__name(describeSubmitAssociation, "describeSubmitAssociation");
function ctaObservationKey(pageUrl, elementKey) {
  return `cta:${scopedPageUrl(pageUrl)}#${typeof elementKey === "string" ? elementKey : "unknown"}`;
}
__name(ctaObservationKey, "ctaObservationKey");
var CONFLICTING_VALUES_SHOWN = 4;
function conflictingValuesList(values) {
  const shown = values.slice(0, CONFLICTING_VALUES_SHOWN).map((value) => `\u201C${compact2(value, 100)}\u201D`);
  const hidden = values.length - shown.length;
  const remainder = hidden > 0 ? [`${hidden} more`] : [];
  return [...shown, ...remainder].join(" vs ");
}
__name(conflictingValuesList, "conflictingValuesList");
function controlIdentityKey(elementKey) {
  return `control-identity:${typeof elementKey === "string" && elementKey ? elementKey : "unknown"}`;
}
__name(controlIdentityKey, "controlIdentityKey");
function sectionObservationKey(pageUrl, elementKey) {
  return `section:${scopedPageUrl(pageUrl)}#${typeof elementKey === "string" ? elementKey : "unknown"}`;
}
__name(sectionObservationKey, "sectionObservationKey");
function literalHttpActionTarget(pageUrl, href2) {
  if (typeof href2 !== "string" || !href2.trim()) return null;
  try {
    const target = new URL(href2.trim(), pageUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") return null;
    return crawlKey(target);
  } catch {
    return null;
  }
}
__name(literalHttpActionTarget, "literalHttpActionTarget");
async function runConversion(context, detectorId) {
  const drafts = [];
  let sawRichEvidence = false;
  let rejected = 0;
  let redactedAction = false;
  for (const page of pagesOf(context)) {
    const pageRecord = page;
    const ctas = Array.isArray(pageRecord.ctas) ? pageRecord.ctas : void 0;
    const forms = Array.isArray(pageRecord.forms) ? pageRecord.forms : [];
    if (ctas !== void 0 || forms.length > 0) sawRichEvidence = true;
    const validCtas = (ctas ?? []).filter((cta) => {
      if (!cta || typeof cta !== "object") {
        rejected++;
        return false;
      }
      return true;
    });
    const primary = validCtas.filter(isPrimaryAction);
    const hasValidFormSubmit = forms.some(
      (form) => form !== null && typeof form === "object" && form.hasSubmit === true
    );
    for (const cta of validCtas) {
      if (!isPrimaryAction(cta)) continue;
      const geometry = cta.geometry;
      if (!geometry || typeof geometry !== "object") continue;
      const shape = geometry;
      const clipped = shape.horizontallyClipped === true || shape.verticallyClipped === true || typeof shape.width === "number" && shape.width <= 0 || typeof shape.height === "number" && shape.height <= 0;
      if (!clipped) continue;
      const elementKey = typeof cta.elementKey === "string" ? cta.elementKey : "unknown";
      const name = ctaDisplayName(cta);
      const label = name || "primary action";
      const width = typeof shape.width === "number" ? shape.width : 0;
      const height = typeof shape.height === "number" ? shape.height : 0;
      drafts.push(
        broadDraft({
          detectorId,
          problemType: "obscured_conversion_action",
          subject: { kind: "element", key: `${page.url}#${elementKey}` },
          observation: name ? `The primary conversion action \u201C${compact2(name, 120)}\u201D on ${page.url} is clipped in the rendered geometry; the action's full visibility was not established.` : `A primary conversion action on ${page.url} is clipped in the rendered geometry; the action's own label could not be read from the supplied evidence, so its full visibility was not established.`,
          evidenceRefs: [pageRef(page.url), ctaObservationKey(page.url, elementKey)],
          evidenceType: "rendered",
          observationKeys: ["cta", "rendered-geometry", "clipping"],
          measurements: [
            { key: "width", value: width, unit: "px" },
            { key: "height", value: height, unit: "px" }
          ],
          reason: "A typed rendered geometry observation marks the primary action as clipped."
        })
      );
    }
    const sections = Array.isArray(pageRecord.sections) ? pageRecord.sections : [];
    const conversionRelevant = forms.length > 0 || sections.some((section2) => {
      if (!section2 || typeof section2 !== "object") return false;
      const kind = section2.kind;
      return kind === "hero" || kind === "contact";
    });
    if (ctas !== void 0 && primary.length === 0 && !hasValidFormSubmit && conversionRelevant && context.evidence.site.crawlExhaustive) {
      drafts.push(
        broadDraft({
          detectorId,
          problemType: "obscured_conversion_action",
          subject: { kind: "page", key: page.url },
          observation: `The complete parsed CTA inventory for ${page.url} contains no primary conversion action on a conversion-relevant page; no submission result is inferred.`,
          evidenceRefs: [pageRef(page.url)],
          evidenceType: "page",
          observationKeys: ["page", "cta-inventory", "primary-action", "complete-page-inventory"],
          reason: "A complete crawl supplied a typed CTA inventory for the conversion-relevant page."
        })
      );
    }
    const targets = /* @__PURE__ */ new Map();
    for (const cta of primary) {
      const key = literalHttpActionTarget(page.url, cta.href);
      if (!key) continue;
      const identity = normalized(ctaDisplayName(cta));
      if (!identity) continue;
      const group = targets.get(identity) ?? [];
      group.push({
        key,
        label: ctaDisplayName(cta),
        elementKey: typeof cta.elementKey === "string" ? cta.elementKey : "unknown"
      });
      targets.set(identity, group);
    }
    for (const [identity, group] of targets) {
      const distinctTargets = [...new Set(group.map((entry2) => entry2.key))];
      if (distinctTargets.length < 2) continue;
      drafts.push(
        broadDraft({
          detectorId,
          problemType: "conflicting_action",
          subject: { kind: "page", key: page.url },
          observation: `${distinctTargets.length} controls on ${page.url} are both labelled \u201C${compact2(group[0].label || identity, 80)}\u201D and lead to different destinations (${distinctTargets.slice(0, 3).join(", ")}). Nothing in the supplied evidence distinguishes them, so whether a visitor is actually misled cannot be established here.`,
          evidenceRefs: [
            pageRef(page.url),
            ...group.map((entry2) => ctaObservationKey(page.url, entry2.elementKey))
          ],
          evidenceType: "cta",
          observationKeys: ["cta", "action-target", "multiple-primary-actions", "no-distinguishing-context"],
          reason: "Repeated primary actions share a label and lead to distinct HTTP targets, and the CTA evidence records nothing that tells them apart.",
          counterEvidence: [
            "Repeated same-label actions pointing at different per-item targets are normal design when the surrounding content distinguishes the items.",
            "No supplied evidence establishes which action is authoritative."
          ],
          counterEvidenceState: "present",
          // The claim is conditional on context Orbit does not hold, so it is
          // graded as such rather than as a verified defect. `calibrationFor`
          // cannot see counter-evidence, so the scope carries the demotion.
          claimScope: "supported_inference"
        })
      );
    }
    for (let index = 0; index < forms.length; index++) {
      const form = forms[index];
      if (!form || typeof form !== "object") {
        rejected++;
        continue;
      }
      const shape = form;
      const fields = Array.isArray(shape.fields) ? shape.fields : void 0;
      const visitorFields = fields?.filter(isVisitorEnteredControl) ?? [];
      if (!fields && !Object.prototype.hasOwnProperty.call(shape, "hasSubmit")) continue;
      const hasSubmit = shape.hasSubmit === true;
      const actionState = typeof shape.actionTargetState === "string" ? shape.actionTargetState : void 0;
      const frictionReasons = [];
      if (visitorFields.length > 8) frictionReasons.push(`contains ${visitorFields.length} visitor-entered fields`);
      const submitClause = describeSubmitAssociation({ hasSubmit, ctas });
      if (submitClause) frictionReasons.push(submitClause);
      if (actionState === "invalid") frictionReasons.push("has an invalid action target");
      if (actionState === "redacted") redactedAction = true;
      const disabledSubmit = shape.submitDisabled === true && shape.hasEnabledSubmitAlternative !== true;
      if (disabledSubmit) {
        frictionReasons.push(
          "has a submit control that is inactive in the served HTML, and no enabled submit alternative"
        );
      }
      if (frictionReasons.length === 0) continue;
      drafts.push(
        broadDraft({
          detectorId,
          problemType: "form_friction",
          subject: { kind: "element", key: `${page.url}#form:${index}` },
          observation: `The enquiry form on ${page.url} ${frictionReasons.join(" and ")}. This observes form structure only; no submission was attempted.`,
          evidenceRefs: [pageRef(page.url), `form:${page.url}#${index}`],
          evidenceType: "form",
          observationKeys: ["form", "form-field-count", "submit-control", "action-target", ...disabledSubmit ? ["submit-disabled-in-dom", "no-interaction-attempted"] : []],
          measurements: fields ? [{ key: "field_count", value: visitorFields.length, unit: "count" }] : void 0,
          reason: disabledSubmit ? "A submit control that is inactive in the served HTML may be validation behaviour; only an interaction test could decide, and none was attempted." : "Typed form structure exposes friction without claiming a submission result.",
          ...disabledSubmit ? { origin: "INTERACTION" } : {}
        })
      );
    }
  }
  return sawRichEvidence ? output(
    drafts,
    redactedAction ? "One or more form action targets were redacted, so action validity remains unassessed." : void 0,
    rejected
  ) : output([], "CTA and form observations were not available for this run.", rejected);
}
__name(runConversion, "runConversion");
async function runAccessibility(context, detectorId) {
  const drafts = [];
  let sawRichEvidence = false;
  let rejected = 0;
  let unsupportedIssue = false;
  for (const page of pagesOf(context)) {
    const pageRecord = page;
    const accessibility = Array.isArray(pageRecord.accessibility) ? pageRecord.accessibility : void 0;
    const forms = Array.isArray(pageRecord.forms) ? pageRecord.forms : [];
    const ctas = Array.isArray(pageRecord.ctas) ? pageRecord.ctas : [];
    if (accessibility !== void 0 || forms.length > 0 || ctas.length > 0) sawRichEvidence = true;
    for (const observation of accessibility ?? []) {
      if (!observation || typeof observation !== "object") {
        rejected++;
        continue;
      }
      const value = observation;
      const elementKey = typeof value.elementKey === "string" ? value.elementKey : "unknown";
      const issue2 = typeof value.issue === "string" ? value.issue : "";
      if (!issue2) {
        rejected++;
        continue;
      }
      if (!["missing-accessible-name", "missing-label", "empty-label"].includes(issue2)) {
        rejected++;
        unsupportedIssue = true;
        continue;
      }
      const missingName = issue2 === "missing-accessible-name";
      const problemType = missingName ? "missing_accessible_name" : "form_accessibility_failure";
      drafts.push(
        broadDraft({
          detectorId,
          problemType,
          subject: { kind: "element", key: `${page.url}#${elementKey}` },
          observation: `The typed accessibility observation on ${page.url} records ${issue2} for ${elementKey}.`,
          evidenceRefs: [pageRef(page.url), `accessibility:${scopedPageUrl(page.url)}#${elementKey}:${issue2}`],
          evidenceType: "accessibility",
          observationKeys: ["accessibility", issue2, controlIdentityKey(elementKey)],
          reason: "The issue is recorded by the parsed or rendered accessibility evidence."
        })
      );
    }
    for (const cta of ctas) {
      if (!cta || typeof cta !== "object") {
        rejected++;
        continue;
      }
      const value = cta;
      const label = typeof value.label === "string" ? value.label : "";
      const accessibleName = typeof value.accessibleName === "string" ? value.accessibleName : "";
      const actionKind = typeof value.actionKind === "string" ? value.actionKind : "";
      if ((actionKind === "button" || actionKind === "submit") && !label && !accessibleName) {
        const elementKey = typeof value.elementKey === "string" ? value.elementKey : "unknown";
        drafts.push(
          broadDraft({
            detectorId,
            problemType: "missing_accessible_name",
            subject: { kind: "element", key: `${page.url}#${elementKey}` },
            observation: `The ${actionKind} on ${page.url} has no literal label or accessible name in the typed CTA evidence.`,
            evidenceRefs: [pageRef(page.url), ctaObservationKey(page.url, elementKey)],
            evidenceType: "cta",
            observationKeys: ["cta", "accessible-name"],
            reason: "The parser recorded both label and accessible-name as empty."
          })
        );
      }
    }
    for (let formIndex = 0; formIndex < forms.length; formIndex++) {
      const form = forms[formIndex];
      if (!form || typeof form !== "object") {
        rejected++;
        continue;
      }
      const fields = Array.isArray(form.fields) ? form.fields : [];
      for (const field of fields) {
        if (!field || typeof field !== "object") {
          rejected++;
          continue;
        }
        const value = field;
        const label = typeof value.label === "string" ? value.label : "";
        const accessibleName = typeof value.accessibleName === "string" ? value.accessibleName : "";
        const labelSource = typeof value.labelSource === "string" ? value.labelSource : "none";
        const trustedAccessibleSource = ["aria-label", "aria-labelledby"].includes(labelSource);
        if (label || trustedAccessibleSource) continue;
        const elementKey = typeof value.elementKey === "string" ? value.elementKey : "unknown";
        const controlType = typeof value.controlType === "string" && value.controlType ? value.controlType : "control";
        const fallbackLabel = ["name", "placeholder"].includes(labelSource);
        drafts.push(
          broadDraft({
            detectorId,
            problemType: "form_accessibility_failure",
            subject: { kind: "element", key: `${page.url}#${elementKey}` },
            // Name the control and the label state that was actually parsed, so
            // the published sentence is actionable. An earlier version shipped
            // the bare template "The supplied evidence records form
            // accessibility failure at <url>", which named neither the control
            // nor the reason.
            observation: fallbackLabel ? `The ${controlType} control in the form on ${page.url} has no label of its own and is labelled only by its ${labelSource} attribute.` : `The ${controlType} control in the form on ${page.url} has no label, placeholder or name attribute in the supplied HTML.`,
            evidenceRefs: [pageRef(page.url), `form-field:${scopedPageUrl(page.url)}#${elementKey}`],
            evidenceType: "form-field",
            observationKeys: ["form-field", "label", "accessible-name", controlIdentityKey(elementKey)],
            reason: fallbackLabel ? "A name or placeholder fallback is not treated as a persistent user-facing label; no contrast or keyboard behavior is inferred." : "The field has no supplied label, accessible name, or trusted label source."
          })
        );
      }
    }
  }
  const rendered = context.evidence.renderedPages;
  if (Array.isArray(rendered)) {
    for (const renderedPage of rendered) {
      for (const element of renderedPage.elements ?? []) {
        if (!element || typeof element !== "object") {
          rejected++;
          continue;
        }
        if (!["anchor", "button", "form-control"].includes(element.kind)) continue;
        if (element.source !== "rendered") continue;
        if (element.labelState === "missing" || element.labelState === "empty") {
          const problemType = element.kind === "form-control" ? "form_accessibility_failure" : "missing_accessible_name";
          drafts.push(
            broadDraft({
              detectorId,
              problemType,
              subject: { kind: "element", key: `${element.pageUrl}#${element.elementKey}` },
              observation: `The rendered ${element.kind} on ${element.pageUrl} has a ${element.labelState} literal label/access-name state.`,
              evidenceRefs: [pageRef(element.pageUrl), `rendered-element:${element.screenshotId}#${element.elementKey}`],
              evidenceType: "rendered",
              observationKeys: ["rendered-label-state", "accessible-name", controlIdentityKey(element.elementKey)],
              reason: "The rendered observation records the literal label state; no keyboard or contrast behavior is inferred."
            })
          );
        }
        const severelyClipped = element.geometry.horizontallyClipped || element.geometry.verticallyClipped || element.geometry.width === 0 || element.geometry.height === 0;
        const tooSmall = !severelyClipped && (element.geometry.width < 44 || element.geometry.height < 44);
        if (!tooSmall) continue;
        drafts.push(
          broadDraft({
            detectorId,
            problemType: "small_rendered_target",
            subject: { kind: "element", key: `${element.pageUrl}#${element.elementKey}` },
            observation: `The rendered ${element.kind} on ${element.pageUrl} measures ${element.geometry.width}\xD7${element.geometry.height}px, below the observed 44px target dimension.`,
            evidenceRefs: [pageRef(element.pageUrl), `rendered-element:${element.screenshotId}#${element.elementKey}`],
            evidenceType: "rendered",
            observationKeys: ["rendered-target", "target-dimensions"],
            measurements: [
              { key: "width", value: element.geometry.width, unit: "px" },
              { key: "height", value: element.geometry.height, unit: "px" }
            ],
            reason: "The finding uses measured rendered target geometry; no contrast or keyboard behavior is inferred."
          })
        );
      }
    }
  }
  const renderedCoverageMissing = Array.isArray(rendered) && rendered.length > 0 && !hasRenderedElementCoverage(context) && !sawRichEvidence;
  return sawRichEvidence || Array.isArray(rendered) && rendered.length > 0 ? output(
    drafts,
    unsupportedIssue ? "Some accessibility issue types are outside this detector's semantic scope." : renderedCoverageMissing ? "Rendered accessibility element coverage was empty, so rendered accessibility remains limited." : void 0,
    rejected
  ) : output([], "Accessibility and rendered target observations were not available for this run.", rejected);
}
__name(runAccessibility, "runAccessibility");
function normalizedContactValue(kind, value) {
  if (kind === "phone") return value.replace(/\D/g, "");
  return normalized(value);
}
__name(normalizedContactValue, "normalizedContactValue");
function addConsistencyObservation(groups, observation) {
  const group = groups.get(observation.identity) ?? [];
  group.push(observation);
  groups.set(observation.identity, group);
}
__name(addConsistencyObservation, "addConsistencyObservation");
async function runConsistency(context, detectorId) {
  const factsByIdentity = /* @__PURE__ */ new Map();
  const siteOrigin = originFor(context.client.domain);
  const drafts = [];
  let sawFacts = false;
  let rejected = 0;
  for (const page of pagesOf(context)) {
    if (!siteOrigin || !isSameSite(page.url, siteOrigin)) continue;
    const facts = page.contactFacts;
    if (Array.isArray(facts)) {
      sawFacts = true;
      const onThisPage = /* @__PURE__ */ new Map();
      for (const fact of facts) {
        if (!fact || typeof fact !== "object") {
          rejected++;
          continue;
        }
        const value = fact;
        if (typeof value.kind !== "string" || typeof value.value !== "string") {
          rejected++;
          continue;
        }
        const sourceKey = typeof value.sourceKey === "string" ? value.sourceKey : "unknown";
        const observation = {
          family: "contact",
          identity: `contact:${normalized(value.kind)}`,
          factKind: normalized(value.kind),
          page: page.url,
          value: value.value,
          sourceKey,
          evidenceRef: `contact-fact:${scopedPageUrl(page.url)}#${sourceKey}`,
          evidenceType: "contact-fact",
          factOrigin: typeof value.origin === "string" ? value.origin : void 0
        };
        addConsistencyObservation(factsByIdentity, observation);
        const group = onThisPage.get(observation.identity) ?? [];
        group.push(observation);
        onThisPage.set(observation.identity, group);
      }
      for (const [identity, group] of onThisPage) {
        const visible = group.filter((entry2) => entry2.factOrigin === "visible_text");
        const targets = group.filter((entry2) => entry2.factOrigin === "action_target");
        if (visible.length === 0 || targets.length === 0) continue;
        const visibleValues = unique2(visible.map((entry2) => entry2.value));
        const targetValues = unique2(targets.map((entry2) => entry2.value));
        const differing = visibleValues.some(
          (value) => targetValues.some(
            (target) => normalizedContactValue(identity.slice("contact:".length), target) !== normalizedContactValue(identity.slice("contact:".length), value)
          )
        );
        if (!differing) continue;
        const label = identity.slice("contact:".length);
        drafts.push(
          broadDraft({
            detectorId,
            problemType: "field_value_mismatch",
            subject: { kind: "page", key: page.url },
            observation: `On ${page.url} the ${label} a visitor reads (${visibleValues.map((value) => `\u201C${compact2(value, 80)}\u201D`).join(", ")}) differs from the ${label} its own action target uses (${targetValues.map((value) => `\u201C${compact2(value, 80)}\u201D`).join(", ")}). ${preservedValuesClause(
              (/* @__PURE__ */ new Set([...visibleValues, ...targetValues])).size
            )}`,
            evidenceRefs: group.flatMap((entry2) => [pageRef(entry2.page), entry2.evidenceRef]),
            evidenceType: "contact-fact",
            observationKeys: ["contact-fact", label, "visible-text", "action-target", "same-page-mismatch"],
            reason: "A single owned page carries a visible contact value and an action target that disagree.",
            contactFactKind: label,
            counterEvidenceState: "present",
            counterEvidence: [
              "The page does not establish which of the two values the business intends to publish."
            ]
          })
        );
      }
    }
    const datedFacts = page.datedFacts;
    if (Array.isArray(datedFacts)) {
      sawFacts = true;
      for (const fact of datedFacts) {
        if (!fact || typeof fact !== "object") {
          rejected++;
          continue;
        }
        const value = fact;
        const sourceKey = typeof value.sourceKey === "string" ? value.sourceKey : "";
        if (value.kind !== "offer-expiry" && value.kind !== "copyright" || !sourceKey || typeof value.value !== "string") {
          if (value.kind !== "published" && value.kind !== "updated" && value.kind !== "event") rejected++;
          continue;
        }
        addConsistencyObservation(factsByIdentity, {
          family: "date",
          identity: `date:${normalized(value.kind)}:${normalized(sourceKey)}`,
          factKind: normalized(value.kind),
          page: page.url,
          value: value.value,
          sourceKey,
          evidenceRef: `date-fact:${scopedPageUrl(page.url)}#${sourceKey}`,
          evidenceType: "date-fact"
        });
      }
    }
  }
  for (const facts of factsByIdentity.values()) {
    const byValue = /* @__PURE__ */ new Map();
    for (const fact of facts) {
      const key = fact.family === "contact" ? normalizedContactValue(facts[0]?.identity.slice("contact:".length) ?? "", fact.value) : normalized(fact.value);
      const existing = byValue.get(key) ?? [];
      existing.push(fact);
      byValue.set(key, existing);
    }
    if (new Set(facts.map((fact) => fact.page)).size < 2 || byValue.size < 2) continue;
    const literalValues = [...new Set(facts.map((fact) => fact.value))];
    const label = facts[0]?.family === "date" ? `${facts[0]?.factKind ?? "business"} date` : facts[0]?.identity.slice("contact:".length) ?? "contact";
    const family = facts[0]?.family ?? "contact";
    drafts.push(
      broadDraft({
        detectorId,
        // Contact conflicts and content conflicts are different claims, so they
        // are different problem types with different categories. Reporting a
        // service or date difference as "inconsistent contact details" was a
        // classification error, not a wording problem.
        problemType: family === "contact" ? "inconsistent_contact_fact" : "inconsistent_content_fact",
        subject: { kind: "site", key: context.client.domain },
        observation: family === "contact" ? `Owned pages record conflicting ${label} facts: ${conflictingValuesList(literalValues)}. ${preservedValuesClause(literalValues.length)}` : `Owned pages record conflicting ${label} facts: ${conflictingValuesList(literalValues)}. ${preservedValuesClause(literalValues.length)}`,
        evidenceRefs: facts.flatMap((fact) => [pageRef(fact.page), fact.evidenceRef]),
        evidenceType: facts[0]?.evidenceType ?? "contact-fact",
        observationKeys: [family, "multiple-owned-pages", "conflicting-values"],
        reason: family === "date" ? "At least two owned pages contain distinct literals for the same explicit site-wide date identity." : "At least two owned pages contain distinct normalized values for the same contact fact.",
        counterEvidenceState: "present",
        counterEvidence: ["The supplied pages do not establish which literal value is current."]
      })
    );
  }
  const comparablePageSet = [...factsByIdentity.values()].some(
    (facts) => new Set(facts.map((fact) => fact.page)).size >= 2
  );
  return sawFacts && (comparablePageSet || drafts.length > 0) ? output(drafts, void 0, rejected) : output([], "Comparable contact or explicit offer-expiry facts were not available across at least two owned pages.", rejected);
}
__name(runConsistency, "runConsistency");
function rootMessage(value) {
  return normalized(sanitizeEvidenceText(value)).replace(/https?:\/\/\S+/g, "url").replace(/\b(?:authorization|bearer|token|secret|password|api[-_]?key|auth|credential)\s*[:=]\s*\S+/gi, "[redacted]").replace(
    /([?&\s])([^?&=\s]+)=([^&\s]+)/gi,
    (match, prefix, key) => isCredentialQueryKey(key) ? `${prefix}${key}=[redacted]` : match
  ).replace(/\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "email").replace(/\b\d{2,}\b/g, "#").slice(0, 180);
}
__name(rootMessage, "rootMessage");
async function runReliability(context, detectorId) {
  const origin = originFor(context.client.domain);
  const drafts = [];
  let rejected = 0;
  let duplicateCount = 0;
  let sawEvidence = false;
  let sawOutOfScope = false;
  let sawEligible = false;
  const seenFailureKeys = /* @__PURE__ */ new Set();
  const resourceGroups = /* @__PURE__ */ new Map();
  const failures = context.evidence.resourceFailures;
  if (Array.isArray(failures)) {
    sawEvidence = true;
    for (const failure of failures) {
      if (!failure || typeof failure !== "object") {
        rejected++;
        continue;
      }
      const value = failure;
      if (!sameSite(value.pageUrl, origin) || !sameSite(value.url, origin)) {
        sawOutOfScope = true;
        continue;
      }
      sawEligible = true;
      if (typeof value.reason !== "string" || typeof value.resourceType !== "string") {
        rejected++;
        continue;
      }
      const status = typeof value.status === "number" ? value.status : void 0;
      const exactKey = `${value.pageUrl}|${value.url}|${value.resourceType}|${status ?? "none"}|${rootMessage(value.reason)}`;
      if (seenFailureKeys.has(exactKey)) duplicateCount++;
      seenFailureKeys.add(exactKey);
      const key = `${crawlKey(value.pageUrl)}:${value.resourceType ?? "resource"}:${status ?? "none"}:${rootMessage(value.reason)}`;
      const existing = resourceGroups.get(key);
      const orbitLimit = value.cause === "orbit-limit";
      const refs = [pageRef(value.pageUrl), resourceFailureEvidenceAlias(value)];
      if (existing) {
        existing.refs.push(...refs);
        existing.orbitLimit ||= orbitLimit;
      } else {
        resourceGroups.set(key, {
          pageUrl: value.pageUrl,
          url: value.url,
          reason: rootMessage(value.reason),
          ...status === void 0 ? {} : { status },
          refs,
          orbitLimit
        });
      }
    }
  }
  for (const page of pagesOf(context)) {
    if (page.status < 400 || !sameSite(page.url, origin)) continue;
    sawEvidence = true;
    sawEligible = true;
    const key = `document:${crawlKey(page.url)}:${page.status}`;
    const existing = resourceGroups.get(key);
    const refs = [pageRef(page.url)];
    if (existing) existing.refs.push(...refs);
    else resourceGroups.set(key, {
      pageUrl: page.url,
      url: page.url,
      reason: `same-site document returned HTTP ${page.status}`,
      status: page.status,
      refs,
      orbitLimit: false
    });
  }
  const firstPageUrl3 = pagesOf(context)[0]?.url ?? origin ?? void 0;
  for (const link of context.evidence.site.links) {
    if (link.scheme !== "http" || !firstPageUrl3) continue;
    let target;
    try {
      target = new URL(link.href, firstPageUrl3);
    } catch {
      continue;
    }
    if (target.origin !== origin) continue;
    const targetPage = pagesOf(context).find((page) => {
      try {
        const pageUrl = new URL(page.url);
        return pageUrl.origin === target.origin && pageUrl.pathname === target.pathname && pageUrl.search === target.search && page.status >= 400;
      } catch {
        return false;
      }
    });
    if (!targetPage) continue;
    sawEvidence = true;
    sawEligible = true;
    const status = targetPage.status;
    const sourcePages = link.foundOn.length > 0 ? link.foundOn : [targetPage.url];
    for (const sourcePage of sourcePages) {
      const key = `link:${crawlKey(sourcePage)}:${target.href}:${status}`;
      const refs = [
        pageRef(sourcePage),
        `target:${link.href}`,
        pageRef(targetPage.url)
      ];
      const existing = resourceGroups.get(key);
      if (existing) existing.refs.push(...refs);
      else {
        resourceGroups.set(key, {
          pageUrl: sourcePage,
          url: target.href,
          reason: `same-site internal link target returned HTTP ${status}`,
          status,
          refs,
          orbitLimit: false
        });
      }
    }
  }
  for (const group of resourceGroups.values()) {
    drafts.push(
      broadDraft({
        detectorId,
        problemType: "resource_failure",
        subject: { kind: "page", key: group.pageUrl },
        observation: `A same-site resource condition affected ${group.pageUrl}: ${compact2(group.reason, 220)}${group.status !== void 0 ? ` (HTTP ${group.status})` : ""}.`,
        evidenceRefs: group.refs,
        evidenceType: "resource",
        observationKeys: [
          "resource",
          "same-site",
          "root-condition",
          ...group.orbitLimit ? [ORBIT_LIMIT_OBSERVATION_KEY] : []
        ],
        measurements: group.status === void 0 ? void 0 : [{ key: "status", value: group.status, unit: "status" }],
        reason: "Same-site resource or document failure evidence was grouped by its observed root condition; third-party failures are excluded.",
        ...group.orbitLimit ? { origin: "MEASUREMENT" } : {}
      })
    );
  }
  const consoleGroups = /* @__PURE__ */ new Map();
  const consoleSeenKeys = /* @__PURE__ */ new Set();
  const errors = context.evidence.consoleErrors;
  if (Array.isArray(errors)) {
    sawEvidence = true;
    for (const error3 of errors) {
      if (!error3 || typeof error3 !== "object") {
        rejected++;
        continue;
      }
      const value = error3;
      if (typeof value.pageUrl !== "string" || typeof value.message !== "string" || value.level !== "error" && value.level !== "warning" || value.source !== "rendered") {
        rejected++;
        continue;
      }
      if (!sameSite(value.pageUrl, origin) || value.sourceUrl !== void 0 && !sameSite(value.sourceUrl, origin) || typeof value.message !== "string") {
        sawOutOfScope = true;
        continue;
      }
      sawEligible = true;
      if (value.level !== "error") continue;
      const key = `${crawlKey(value.pageUrl)}:${rootMessage(value.message)}`;
      const exactKey = `${value.pageUrl}|${rootMessage(value.message)}`;
      if (consoleSeenKeys.has(exactKey)) duplicateCount++;
      consoleSeenKeys.add(exactKey);
      const refs = [pageRef(value.pageUrl), consoleErrorEvidenceAlias(value)];
      const existing = consoleGroups.get(key);
      if (existing) existing.refs.push(...refs);
      else consoleGroups.set(key, { pageUrl: value.pageUrl, message: rootMessage(value.message), refs });
    }
  }
  for (const group of consoleGroups.values()) {
    drafts.push(
      broadDraft({
        detectorId,
        problemType: "console_error",
        subject: { kind: "page", key: group.pageUrl },
        observation: `The rendered page ${group.pageUrl} recorded a console error: ${compact2(group.message, 260)}.`,
        evidenceRefs: group.refs,
        evidenceType: "console",
        observationKeys: ["console", "redacted-message", "root-condition"],
        reason: "The console message is bounded and redacted by the evidence contract."
      })
    );
  }
  if (sawOutOfScope && !sawEligible) {
    return output(
      [],
      "Only third-party reliability observations were supplied and they were excluded.",
      rejected,
      duplicateCount
    );
  }
  return sawEvidence ? output(drafts, void 0, rejected, duplicateCount) : output([], "Resource and console reliability observations were not available for this run.", rejected, duplicateCount);
}
__name(runReliability, "runReliability");
async function runPerformance(context, detectorId) {
  const observations = context.evidence.performanceObservations;
  if (!Array.isArray(observations) || observations.length === 0) {
    return output([], "Bounded lab performance observations were not available for this run.");
  }
  const drafts = [];
  let rejected = 0;
  let outOfScope = false;
  const origin = originFor(context.client.domain);
  for (const observation of observations) {
    if (!observation || typeof observation !== "object") {
      rejected++;
      continue;
    }
    const value = observation;
    if (typeof value.pageUrl !== "string" || typeof value.responseTimeMs !== "number" || typeof value.transferSizeBytes !== "number") {
      rejected++;
      continue;
    }
    if (!sameSite(value.pageUrl, origin)) {
      outOfScope = true;
      continue;
    }
    const slow = value.responseTimeMs >= 1e3 || value.transferSizeBytes >= 1e6;
    if (!slow) continue;
    const capturedAt2 = Date.parse(context.evidence.capturedAt);
    const observedAt = typeof value.observedAt === "string" ? Date.parse(value.observedAt) : Number.NaN;
    const stale = Number.isFinite(capturedAt2) && Number.isFinite(observedAt) ? capturedAt2 - observedAt > 180 * 24 * 60 * 60 * 1e3 : false;
    drafts.push(
      broadDraft({
        detectorId,
        problemType: "measured_performance_regression",
        subject: { kind: "page", key: value.pageUrl },
        observation: `A bounded lab observation for ${value.pageUrl} recorded ${value.responseTimeMs}ms response time and ${value.transferSizeBytes} bytes transferred. This is a lab measurement, not real-user performance or business impact.`,
        evidenceRefs: [pageRef(value.pageUrl), performanceEvidenceAlias(value)],
        evidenceType: "performance",
        observationKeys: ["performance", "lab-observation", "response-time", "transfer-size"],
        measurements: [
          { key: "response_time_ms", value: value.responseTimeMs, unit: "ms" },
          { key: "transfer_size_bytes", value: value.transferSizeBytes, unit: "bytes" }
        ],
        reason: "The threshold is applied only to the bounded lab/response observation.",
        state: stale ? "stale" : "observed",
        origin: "MEASUREMENT"
      })
    );
  }
  return outOfScope && drafts.length === 0 ? output([], "Only third-party performance observations were supplied and they were excluded.", rejected) : output(drafts, void 0, rejected);
}
__name(runPerformance, "runPerformance");
function yearFrom(value) {
  const match = value.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}
__name(yearFrom, "yearFrom");
function clearlyPastDate(value, capturedAt2) {
  const observed = Date.parse(value);
  const captured = Date.parse(capturedAt2);
  if (Number.isFinite(observed) && Number.isFinite(captured)) return observed < captured;
  const observedYear = yearFrom(value);
  const capturedYear = yearFrom(capturedAt2);
  return observedYear !== null && capturedYear !== null && observedYear < capturedYear;
}
__name(clearlyPastDate, "clearlyPastDate");
async function runFreshness(context, detectorId) {
  let sawFacts = false;
  let rejected = 0;
  const drafts = [];
  for (const page of pagesOf(context)) {
    const datedFacts = page.datedFacts;
    if (!Array.isArray(datedFacts)) continue;
    sawFacts = true;
    for (const fact of datedFacts) {
      if (!fact || typeof fact !== "object") {
        rejected++;
        continue;
      }
      const value = fact;
      if (typeof value.kind !== "string" || typeof value.value !== "string") {
        rejected++;
        continue;
      }
      const sourceKey = typeof value.sourceKey === "string" ? value.sourceKey : "unknown";
      const expiringFact = value.kind === "offer-expiry";
      if (expiringFact && clearlyPastDate(value.value, context.evidence.capturedAt)) {
        drafts.push(
          broadDraft({
            detectorId,
            problemType: "stale_business_fact",
            subject: { kind: "page", key: page.url },
            observation: `The explicit ${value.kind} fact on ${page.url} contains the dated value \u201C${compact2(value.value, 120)}\u201D, which precedes the captured run timestamp.`,
            evidenceRefs: [pageRef(page.url), `date-fact:${scopedPageUrl(page.url)}#${sourceKey}`],
            evidenceType: "date-fact",
            observationKeys: ["date-fact", "stale-date"],
            reason: "Only explicit offer-expiry dates that precede the captured run timestamp are treated as stale; publication, update, and generic event dates are not expiration claims.",
            state: "stale"
          })
        );
      }
    }
  }
  return sawFacts ? output(drafts, void 0, rejected) : output([], "Dated business facts were not available for this run.", rejected);
}
__name(runFreshness, "runFreshness");
async function runRenderedExperience(context, detectorId) {
  const rendered = context.evidence.renderedPages;
  if (!Array.isArray(rendered) || rendered.length === 0) {
    return output([], "Rendered page observations were not available for this run.");
  }
  if (!hasRenderedElementCoverage(context)) {
    return output([], "Rendered element coverage was empty, so rendered experience remains limited.");
  }
  const drafts = [];
  let rejected = 0;
  const parsedClippedCtaKeys = /* @__PURE__ */ new Set();
  for (const page of pagesOf(context)) {
    const ctas = page.ctas;
    if (!Array.isArray(ctas)) continue;
    for (const cta of ctas) {
      if (!cta || typeof cta !== "object") continue;
      const value = cta;
      const geometry = value.geometry;
      const elementKey = typeof value.elementKey === "string" ? value.elementKey : "";
      if (!elementKey || !geometry || typeof geometry !== "object") continue;
      const shape = geometry;
      const clipped = shape.horizontallyClipped === true || shape.verticallyClipped === true || shape.width === 0 || shape.height === 0;
      if (clipped) parsedClippedCtaKeys.add(`${scopedPageUrl(page.url)}#${elementKey}`);
    }
  }
  for (const page of rendered) {
    for (const element of page.elements ?? []) {
      if (!element || typeof element !== "object") {
        rejected++;
        continue;
      }
      const severeClip = element.geometry.horizontallyClipped || element.geometry.verticallyClipped || element.geometry.width === 0 || element.geometry.height === 0;
      if (!severeClip) continue;
      if (parsedClippedCtaKeys.has(`${scopedPageUrl(element.pageUrl)}#${element.elementKey}`)) continue;
      drafts.push(
        broadDraft({
          detectorId,
          problemType: "rendered_experience_failure",
          subject: { kind: "element", key: `${element.pageUrl}#${element.elementKey}` },
          observation: `The rendered ${element.kind} observation on ${element.pageUrl} is clipped or has zero rendered area; the affected region requires review.`,
          evidenceRefs: [pageRef(element.pageUrl), `rendered-element:${element.screenshotId}#${element.elementKey}`],
          evidenceType: "rendered",
          observationKeys: ["rendered-geometry", "clipping", "visible-region"],
          reason: "The finding is limited to the measured rendered geometry and does not infer visual preference or business impact.",
          // Rendered geometry is a measurement of our own render. A capture
          // that rendered badly produces clipped rectangles that say nothing
          // about the site, so this stays a measurement limitation rather than
          // a defect claim.
          origin: "MEASUREMENT"
        })
      );
    }
  }
  return output(drafts, void 0, rejected);
}
__name(runRenderedExperience, "runRenderedExperience");
async function runPlaceholder(context, detectorId) {
  const pages = pagesOf(context);
  if (pages.length === 0) {
    return output([], "No evidence pages were supplied, so production copy was not assessed.");
  }
  const readable = pages.filter(isReadablePageForPlaceholder);
  if (readable.length === 0) {
    return output([], "No readable page text was supplied, so production copy was not assessed.");
  }
  const drafts = [];
  for (const page of readable) {
    const matches = placeholderMatchesForPage(page);
    if (matches.length === 0) continue;
    const quoted = matches.map((match) => `\u201C${match.excerpt}\u201D`).join("; ");
    drafts.push(
      broadDraft({
        detectorId,
        problemType: "placeholder_production_content",
        subject: { kind: "page", key: page.url },
        observation: `The readable page ${page.url} still contains site-builder placeholder text: ${quoted}. The copy is written for whoever is building the page rather than for a visitor.`,
        // Cite only the page row. The exact scaffolding each match came from is
        // recorded in the bounded observation keys below rather than as
        // invented element references: an evidence ref that no ledger row
        // backs would resolve as unresolved and silently weaken the finding.
        evidenceRefs: [pageRef(page.url)],
        evidenceType: "page",
        observationKeys: ["placeholder-copy", "template-copy", ...matches.map((match) => `signature:${match.key}`)],
        // Deliberately not enumerating every label: the assessment-limitation
        // field caps one string at 500 characters, and the matched scaffolding
        // is already quoted in the observation above.
        reason: `Matched ${matches.length} high-precision production placeholder signature(s). The detector reports only the scaffolding it literally matched; broader placeholder judgement remains with the bounded semantic pass.`,
        rawConfidence: 0.9
      })
    );
  }
  return output(drafts);
}
__name(runPlaceholder, "runPlaceholder");
var INTENDED_CURRENCY_FROM_TYPED_EVIDENCE = null;
async function runBookingSkeleton(context, detectorId) {
  const pages = pagesOf(context);
  if (pages.length === 0) {
    return output([], "No evidence pages were supplied, so booking-card copy was not assessed.");
  }
  let readable = 0;
  const drafts = [];
  for (const page of pages) {
    if (page.status < 200 || page.status >= 300 || page.wordCount <= 0) continue;
    readable += 1;
    const analysis = bookingSkeletonForPage(page);
    if (!analysis) continue;
    const quoted = analysis.amounts.map((amount2) => `\u201C${amount2}\u201D`).join(", ");
    const currencyNote = analysis.displayedCurrencies.length === 1 ? ` The amounts quoted on those cards are priced in ${analysis.displayedCurrencies[0]} (${quoted}).` : ` The amounts quoted on those cards are marked as money but do not name a single currency (${quoted}).`;
    const mismatch = currencyMismatchFor({
      displayedCurrencies: analysis.displayedCurrencies,
      intendedCurrency: INTENDED_CURRENCY_FROM_TYPED_EVIDENCE
    });
    const mismatchNote = mismatch ? ` The currency those cards display (${mismatch.displayed}) is not the business currency established from the site's own evidence (${mismatch.intended}).` : "";
    drafts.push(
      broadDraft({
        detectorId,
        problemType: "placeholder_production_content",
        subject: { kind: "page", key: page.url },
        observation: `The page ${page.url} repeats one unfilled booking-card template ${analysis.occurrences} times verbatim: \u201C${analysis.unit}\u201D. Every repeated card is titled with the template slot \u201C${analysis.slotTitle}\u201D, and each copy carries only a duration (${analysis.durations.map((duration3) => `\u201C${duration3}\u201D`).join(", ")}), an amount and a booking action (${analysis.actions.map((action2) => `\u201C${action2}\u201D`).join(", ")}), so no service name appears on the cards.${currencyNote}${mismatchNote}`,
        // The page row plus the exact card rows the unit was quoted from. Both
        // are ledger aliases the crawler already writes; an invented reference
        // would resolve as unresolved and silently weaken the finding.
        evidenceRefs: [
          pageRef(page.url),
          ...analysis.sectionKeys.map((key) => sectionObservationKey(page.url, key))
        ],
        evidenceType: "section",
        observationKeys: [
          "unreplaced-booking-card",
          "repeated-card-unit",
          `booking-card-count:${analysis.occurrences}`,
          `booking-surface:${analysis.bookingSurface}`,
          `slot-title:${analysis.slotToken}`,
          "card-content-is-skeleton-only"
        ],
        reason: "Three or more distinct evidence rows carried identical card content on one booking surface; the card title was a template slot label rather than a service name; and the repeated unit was checked for any other content and contained none. Broader placeholder judgement remains with the bounded semantic pass.",
        rawConfidence: 0.9,
        counterEvidenceState: "checked_none"
      })
    );
  }
  if (readable === 0) {
    return output([], "No readable page text was supplied, so booking-card copy was not assessed.");
  }
  return output(drafts);
}
__name(runBookingSkeleton, "runBookingSkeleton");
function dedupeKeyFor(draft) {
  const refs = [...draft.legacyEvidenceRefs].sort().join("|");
  return `${draft.problemType}:${draft.subject.kind}:${normalized(draft.subject.key)}:${refs}`;
}
__name(dedupeKeyFor, "dedupeKeyFor");
function dedupeKeyForDetector(detectorId, draft) {
  if (detectorId === "broad-accessibility") {
    return `${draft.problemType}:${draft.subject.kind}:${normalized(draft.subject.key)}`;
  }
  return dedupeKeyFor(draft);
}
__name(dedupeKeyForDetector, "dedupeKeyForDetector");
var BROAD_RUNS = {
  "broad-conversion": runConversion,
  "broad-accessibility": runAccessibility,
  "broad-consistency": runConsistency,
  "broad-reliability": runReliability,
  "broad-performance": runPerformance,
  "broad-freshness": runFreshness,
  "broad-rendered-experience": runRenderedExperience,
  "broad-placeholder": runPlaceholder,
  "broad-booking-skeleton": runBookingSkeleton
};
function definition(detectorId, category, evidenceKinds, coverage, counterEvidence) {
  return {
    detectorId,
    detectorVersion: "1",
    category,
    evidenceKinds,
    cap: BROAD_CAP,
    dedupeKey: /* @__PURE__ */ __name((draft) => dedupeKeyForDetector(detectorId, draft), "dedupeKey"),
    counterEvidence,
    coverage,
    run: /* @__PURE__ */ __name(async (context, availability3) => (BROAD_RUNS[detectorId] ?? (() => Promise.resolve(output([], "Detector implementation unavailable."))))(
      context,
      detectorId,
      availability3
    ), "run")
  };
}
__name(definition, "definition");
var BROAD_DETECTORS = [
  definition(
    "broad-conversion",
    "conversion",
    ["element", "link", "form", "screenshot"],
    { requiredKinds: ["page"], minimumPages: 1 },
    ["typed CTA target and geometry", "typed form action and submit state"]
  ),
  definition(
    "broad-accessibility",
    "accessibility_usability",
    ["accessibility", "element", "form", "screenshot"],
    { requiredKinds: ["page"], minimumPages: 1 },
    ["literal accessible name", "literal form label", "measured target geometry"]
  ),
  definition(
    "broad-consistency",
    "local_market",
    ["contact-fact", "element", "page"],
    { requiredKinds: ["page"], minimumPages: 2 },
    ["at least two owned pages", "both literal normalized values"]
  ),
  definition(
    "broad-reliability",
    "technical_reliability",
    ["page", "link", "probe"],
    { requiredKinds: ["page"], minimumPages: 1 },
    ["same-site root condition", "redacted console/resource observation"]
  ),
  definition(
    "broad-performance",
    "technical_reliability",
    ["performance", "page"],
    { requiredKinds: ["performance"], minimumPages: 1 },
    ["bounded lab/response measurement"]
  ),
  definition(
    "broad-freshness",
    "content_freshness",
    ["page", "contact-fact"],
    { requiredKinds: ["page"], minimumPages: 1 },
    ["explicit date or contradictory literal fact"]
  ),
  definition(
    "broad-rendered-experience",
    "experience",
    ["screenshot", "element"],
    { requiredKinds: ["screenshot"], minimumPages: 1 },
    ["measured rendered geometry"]
  ),
  definition(
    "broad-placeholder",
    "content_freshness",
    ["page", "element"],
    { requiredKinds: ["page"], minimumPages: 1 },
    ["readable page text"]
  ),
  definition(
    "broad-booking-skeleton",
    "content_freshness",
    ["page", "element"],
    { requiredKinds: ["page"], minimumPages: 1 },
    [
      "at least three distinct ledger rows carrying the identical card",
      "a card title that is a template slot label, matched exactly",
      "duration, currency-marked amount and booking action in the same row",
      "a booking surface established from the page path or typed booking controls"
    ]
  )
];
function availabilityForKind(context, availability3, kind) {
  if (availability3.unavailableEvidenceKinds?.includes(kind)) {
    return { state: "unavailable", reason: `${kind} evidence was marked unavailable.` };
  }
  const explicit = context.evidence.evidenceAvailability?.find((entry2) => entry2.kind === kind);
  if (explicit?.state === "unavailable") {
    return { state: "unavailable", reason: explicit.reason ?? `${kind} evidence was unavailable.` };
  }
  if (explicit?.state === "partial") {
    return { state: "limited", reason: explicit.reason ?? `${kind} evidence was partial.` };
  }
  if (explicit?.state === "available") {
    if (!context.evidence.site.crawlExhaustive && (kind === "page" || kind === "link")) {
      return { state: "limited", reason: "The crawl was partial." };
    }
    if (explicit.observedCount === 0) {
      return { state: "unassessed", reason: `${kind} evidence was marked available but contained no observations.` };
    }
    if ((kind === "element" || kind === "accessibility") && Array.isArray(context.evidence.renderedPages) && context.evidence.renderedPages.length > 0 && !hasRenderedElementCoverage(context) && !hasParsedElementCoverage(context, kind)) {
      return { state: "unassessed", reason: `Rendered ${kind} element coverage was empty.` };
    }
    return { state: "assessed" };
  }
  const pages = pagesOf(context);
  const present3 = (() => {
    switch (kind) {
      case "page":
        return pages.length > 0;
      case "element":
        return hasParsedElementCoverage(context, "element") || hasRenderedElementCoverage(context);
      case "form":
        return pages.some((page) => page.forms.length > 0);
      case "accessibility":
        return hasParsedElementCoverage(context, "accessibility") || hasRenderedElementCoverage(context);
      case "contact-fact":
        return pages.some((page) => extractionAvailable(page, "contactFacts"));
      case "performance":
        return Array.isArray(context.evidence.performanceObservations) && context.evidence.performanceObservations.length > 0;
      case "screenshot":
        return Array.isArray(context.evidence.renderedPages) && context.evidence.renderedPages.length > 0;
      case "link":
        return Array.isArray(context.evidence.site.links);
      case "probe":
        return typeof context.probe === "function";
      case "competitor":
        return false;
    }
  })();
  if (!present3) return { state: "unassessed", reason: `${kind} evidence was not supplied.` };
  if (!context.evidence.site.crawlExhaustive && (kind === "page" || kind === "link")) {
    return { state: "limited", reason: "The crawl was partial." };
  }
  return { state: "assessed" };
}
__name(availabilityForKind, "availabilityForKind");
function detectorInputState(definitionValue, context, availability3) {
  const requiredKinds = new Set(definitionValue.coverage.requiredKinds);
  const requiredStates = definitionValue.coverage.requiredKinds.map(
    (kind) => availabilityForKind(context, availability3, kind)
  );
  const unavailable5 = requiredStates.find((item) => item.state === "unavailable");
  if (unavailable5) return unavailable5;
  if (definitionValue.coverage.minimumPages !== void 0 && pagesOf(context).length < definitionValue.coverage.minimumPages) {
    return {
      state: "unassessed",
      reason: `At least ${definitionValue.coverage.minimumPages} owned evidence pages are required for this detector.`
    };
  }
  if (definitionValue.coverage.requiresCompleteCrawl && !context.evidence.site.crawlExhaustive) {
    return { state: "limited", reason: "The crawl was partial." };
  }
  const requiredUnassessed = requiredStates.find((item) => item.state === "unassessed");
  if (requiredUnassessed) return requiredUnassessed;
  const requiredLimited = requiredStates.find((item) => item.state === "limited");
  const optionalLimitations = definitionValue.evidenceKinds.filter((kind) => !requiredKinds.has(kind)).filter(
    (kind) => availability3.unavailableEvidenceKinds?.includes(kind) || context.evidence.evidenceAvailability?.some((entry2) => entry2.kind === kind) || (kind === "element" || kind === "accessibility" || kind === "screenshot") && Array.isArray(context.evidence.renderedPages)
  ).map((kind) => availabilityForKind(context, availability3, kind)).filter((item) => item.state !== "assessed").map((item) => item.reason).filter((reason) => Boolean(reason));
  return {
    state: requiredLimited?.state ?? "assessed",
    ...requiredLimited?.reason ? { reason: requiredLimited.reason } : {},
    ...optionalLimitations.length > 0 ? { optionalLimitations: unique2(optionalLimitations) } : {}
  };
}
__name(detectorInputState, "detectorInputState");
function explicitlyEnabled(detectorId, availability3) {
  if (availability3.disabledDetectorIds?.includes(detectorId)) {
    return { enabled: false, reason: "Detector was disabled for this run." };
  }
  if (availability3.enabledDetectorIds && !availability3.enabledDetectorIds.includes(detectorId)) {
    return { enabled: false, reason: "Detector was not included in the enabled manifest." };
  }
  return { enabled: true };
}
__name(explicitlyEnabled, "explicitlyEnabled");
async function executeBroadDetector(detector, context, availability3) {
  const enabled = explicitlyEnabled(detector.detectorId, availability3);
  if (!enabled.enabled) {
    return {
      drafts: [],
      accounting: DetectorAccountingSchema.parse({
        detectorId: detector.detectorId,
        detectorVersion: detector.detectorVersion,
        category: detector.category,
        state: "unavailable",
        enabled: false,
        emitted: 0,
        rejected: 0,
        duplicateCount: 0,
        capped: false,
        disabledReason: enabled.reason
      })
    };
  }
  const inputState = detectorInputState(detector, context, availability3);
  if (inputState.state === "unavailable") {
    return {
      drafts: [],
      accounting: DetectorAccountingSchema.parse({
        detectorId: detector.detectorId,
        detectorVersion: detector.detectorVersion,
        category: detector.category,
        state: "unavailable",
        enabled: true,
        emitted: 0,
        rejected: 0,
        duplicateCount: 0,
        capped: false,
        limitation: inputState.reason ?? "Required evidence was unavailable."
      })
    };
  }
  let runOutput;
  try {
    runOutput = await detector.run(context, availability3);
  } catch (error3) {
    const reason = error3 instanceof Error ? error3.message : "Detector input was malformed.";
    return {
      drafts: [],
      accounting: DetectorAccountingSchema.parse({
        detectorId: detector.detectorId,
        detectorVersion: detector.detectorVersion,
        category: detector.category,
        state: "limited",
        enabled: true,
        emitted: 0,
        rejected: 1,
        duplicateCount: 0,
        capped: false,
        limitation: compact2([
          ...inputState.optionalLimitations ?? [],
          `Detector input was malformed: ${reason}`
        ].join(" "))
      })
    };
  }
  const seen = /* @__PURE__ */ new Set();
  const drafts = [];
  let rejected = Math.max(0, runOutput.rejected);
  let duplicateCount = Math.max(0, runOutput.duplicateCount);
  const cap = Math.max(
    0,
    Math.min(
      detector.cap,
      Number.isFinite(availability3.maxDiagnosticsPerDetector ?? detector.cap) ? Math.floor(availability3.maxDiagnosticsPerDetector ?? detector.cap) : detector.cap
    )
  );
  let capObserved = 0;
  for (const candidate of runOutput.drafts) {
    let parsed;
    try {
      parsed = DiagnosticDraftSchema.parse(candidate);
    } catch {
      rejected++;
      continue;
    }
    const key = detector.dedupeKey(parsed);
    if (seen.has(key)) {
      duplicateCount++;
      continue;
    }
    seen.add(key);
    capObserved++;
    if (capObserved > cap) {
      rejected++;
      continue;
    }
    drafts.push(parsed);
  }
  const malformedLimitation = runOutput.rejected > 0 ? "One or more supplied evidence observations were malformed and were excluded." : void 0;
  const staleLimitation = runOutput.drafts.some((draft) => draft.state === "stale") ? "One or more observations are stale and remain limited to their captured evidence." : void 0;
  const capped = capObserved > cap;
  const limitation3 = capped ? `Detector cap ${cap} was reached; ${capObserved - cap} additional observation(s) were retained in accounting.` : compact2([
    ...inputState.optionalLimitations ?? [],
    ...inputState.reason && inputState.state !== "assessed" ? [inputState.reason] : [],
    runOutput.limitation,
    malformedLimitation,
    staleLimitation
  ].filter((item) => Boolean(item)).join(" ")) || void 0;
  const state = capped || limitation3 || inputState.state === "limited" ? "limited" : inputState.state === "unassessed" ? "unassessed" : "assessed";
  const accounting = DetectorAccountingSchema.parse({
    detectorId: detector.detectorId,
    detectorVersion: detector.detectorVersion,
    category: detector.category,
    state,
    enabled: true,
    emitted: drafts.length,
    rejected,
    duplicateCount,
    capped,
    ...capped ? {
      cap: {
        limit: cap,
        observed: capObserved,
        reason: limitation3 ?? "Detector cap was reached."
      }
    } : {},
    ...limitation3 ? { limitation: limitation3 } : {}
  });
  return { drafts, accounting };
}
__name(executeBroadDetector, "executeBroadDetector");
function probeLimitFor(context) {
  const configured = context.probeBudget?.remaining;
  return Math.max(0, Number.isFinite(configured) ? Math.floor(configured) : 8);
}
__name(probeLimitFor, "probeLimitFor");
function allocateProbeBudgets(total, conversion, internalLink) {
  const count5 = Number(conversion) + Number(internalLink);
  if (count5 === 0) return { conversion: 0, internalLink: 0 };
  if (count5 === 1) return { conversion: conversion ? total : 0, internalLink: internalLink ? total : 0 };
  const internal = Math.ceil(total / 2);
  return { conversion: total - internal, internalLink: internal };
}
__name(allocateProbeBudgets, "allocateProbeBudgets");
function legacyEnabledFor(detectorId, availability3) {
  if (availability3.disabledDetectorIds?.includes(detectorId)) return false;
  if (availability3.enabledDetectorIds && !availability3.enabledDetectorIds.includes(detectorId)) {
    return false;
  }
  return true;
}
__name(legacyEnabledFor, "legacyEnabledFor");
function legacyDisabledReason(detectorId, availability3) {
  if (availability3.disabledDetectorIds?.includes(detectorId)) {
    return "Legacy detector was disabled for this run.";
  }
  if (availability3.enabledDetectorIds && !availability3.enabledDetectorIds.includes(detectorId)) {
    return "Legacy detector was not included in the enabled manifest.";
  }
  if (detectorId === "broken-conversion-path" && availability3.conversion === false) {
    return "Conversion probes were disabled for this compatibility run.";
  }
  if (detectorId === "broken-internal-link" && availability3.internalLink === false) {
    return "Internal-link probes were disabled for this compatibility run.";
  }
  return void 0;
}
__name(legacyDisabledReason, "legacyDisabledReason");
async function runLegacyDiagnostics(context, availability3) {
  const pageAvailable = availabilityForKind(context, availability3, "page").state !== "unavailable";
  const conversionActive = pageAvailable && availability3.conversion !== false && legacyEnabledFor("broken-conversion-path", availability3);
  const internalLinkActive = pageAvailable && availability3.internalLink !== false && legacyEnabledFor("broken-internal-link", availability3);
  const totalProbeBudget = probeLimitFor(context);
  const budgets = allocateProbeBudgets(totalProbeBudget, conversionActive, internalLinkActive);
  const conversionBudgetObject = { remaining: budgets.conversion };
  const internalBudgetObject = { remaining: budgets.internalLink };
  const [
    missingService,
    noService,
    conversion,
    missingTitle,
    duplicateTitle,
    thinService,
    missingH1,
    brokenInternalLink,
    missingMetaDescription,
    missingStructuredData,
    missingImageAlt
  ] = await Promise.all([
    pageAvailable && legacyEnabledFor("missing-service-page", availability3) ? detectMissingServicePageDiagnostic({ ...context }) : Promise.resolve([]),
    pageAvailable && legacyEnabledFor("no-service-pages", availability3) ? detectNoServicePagesDiagnostic({ ...context }) : Promise.resolve([]),
    conversionActive ? detectBrokenConversionPathDiagnostic({
      ...context,
      probe: context.probe,
      probeBudget: conversionBudgetObject
    }) : Promise.resolve([]),
    pageAvailable && legacyEnabledFor("missing-title", availability3) ? detectMissingTitleDiagnostic(context) : Promise.resolve([]),
    pageAvailable && legacyEnabledFor("duplicate-title", availability3) ? detectDuplicateTitleDiagnostic(context) : Promise.resolve([]),
    pageAvailable && legacyEnabledFor("thin-service-page", availability3) ? detectThinServicePageDiagnostic(context) : Promise.resolve([]),
    pageAvailable && legacyEnabledFor("missing-h1", availability3) ? detectMissingH1Diagnostic(context) : Promise.resolve([]),
    internalLinkActive ? detectBrokenInternalLinkDiagnostic({
      ...context,
      probe: context.probe,
      probeBudget: internalBudgetObject
    }) : Promise.resolve([]),
    pageAvailable && legacyEnabledFor("missing-meta-description", availability3) ? detectMissingMetaDescriptionDiagnostic(context) : Promise.resolve([]),
    pageAvailable && legacyEnabledFor("missing-structured-data", availability3) ? detectMissingStructuredDataDiagnostic(context) : Promise.resolve([]),
    pageAvailable && legacyEnabledFor("missing-image-alt", availability3) ? detectMissingImageAltDiagnostic(context) : Promise.resolve([])
  ]);
  const raw = [
    ...missingService,
    ...noService,
    ...conversion,
    ...missingTitle,
    ...duplicateTitle,
    ...thinService,
    ...missingH1,
    ...brokenInternalLink,
    ...missingMetaDescription,
    ...missingStructuredData,
    ...missingImageAlt
  ];
  const technical = aggregateTechnicalDiagnostics({
    client: context.client,
    diagnostics: raw,
    suppressedEvidenceRefsByRule: context.technicalSuppressedEvidenceRefsByRule
  });
  const result = [];
  let insertedTechnical = false;
  for (const draft of raw) {
    if ([
      "missing-title",
      "duplicate-title",
      "thin-service-page",
      "missing-h1",
      "broken-internal-link",
      "missing-meta-description",
      "missing-structured-data",
      "missing-image-alt"
    ].includes(draft.detectorId)) {
      if (!insertedTechnical) {
        result.push(...technical);
        insertedTechnical = true;
      }
      continue;
    }
    result.push(draft);
  }
  const detectorDrafts = /* @__PURE__ */ new Map();
  for (const detectorId of LEGACY_DETECTOR_IDS) {
    detectorDrafts.set(
      detectorId,
      result.filter((draft) => draft.detectorId === detectorId)
    );
  }
  return {
    drafts: result,
    probeLimit: totalProbeBudget,
    probeUsed: budgets.conversion - conversionBudgetObject.remaining + budgets.internalLink - internalBudgetObject.remaining,
    detectorDrafts
  };
}
__name(runLegacyDiagnostics, "runLegacyDiagnostics");
function legacyInputState(detectorId, context, availability3) {
  const pageAvailability = availabilityForKind(context, availability3, "page");
  if (pageAvailability.state !== "assessed") return pageAvailability;
  const pages = pagesOf(context);
  if (pages.length === 0) {
    return { state: "unassessed", reason: "No evidence pages were supplied to the legacy detector." };
  }
  const readablePages = pages.filter((page) => page.status >= 200 && page.status < 300 && page.wordCount > 0);
  if (readablePages.length === 0) {
    return { state: "unassessed", reason: "No readable evidence pages were supplied to the legacy detector." };
  }
  if (["missing-meta-description", "missing-image-alt"].includes(detectorId)) {
    const field = detectorId === "missing-meta-description" ? "metaDescription" : "images";
    if (readablePages.some((page) => !Object.prototype.hasOwnProperty.call(page, field))) {
      return { state: "unassessed", reason: `${field} evidence was not supplied for every readable page.` };
    }
  }
  if (detectorId === "missing-structured-data") {
    const relevantPages = readablePages.filter((page) => {
      try {
        return new URL(page.url).pathname === "/" || isServiceShapedPage(page.url);
      } catch {
        return false;
      }
    });
    if (relevantPages.length === 0 || relevantPages.some((page) => page.structuredDataTypes === void 0)) {
      return { state: "unassessed", reason: "Structured-data evidence was not supplied for every relevant readable page." };
    }
  }
  if ((detectorId === "missing-service-page" || detectorId === "no-service-pages") && !context.evidence.site.crawlExhaustive) {
    return { state: "limited", reason: "The crawl was partial, so site-wide service absence is not assessed." };
  }
  return { state: "assessed" };
}
__name(legacyInputState, "legacyInputState");
function legacyDetectorAccounting(detectorId, drafts, enabled, inputState, disabledReason) {
  const category = definitionForProblemType(LEGACY_PROBLEM_TYPES[detectorId]).category;
  const limited = drafts.some((draft) => draft.state !== "observed");
  const state = !enabled ? "unavailable" : inputState.state !== "assessed" ? inputState.state : limited ? "limited" : "assessed";
  const limitation3 = inputState.state !== "assessed" ? inputState.reason : limited ? "One or more legacy observations were unknown or otherwise limited." : void 0;
  return DetectorAccountingSchema.parse({
    detectorId,
    detectorVersion: "1",
    category,
    state,
    enabled,
    emitted: enabled ? drafts.length : 0,
    rejected: 0,
    duplicateCount: 0,
    capped: false,
    ...limitation3 && enabled ? { limitation: limitation3 } : {},
    ...!enabled ? { disabledReason: disabledReason ?? "Legacy detector was unavailable for this run." } : {}
  });
}
__name(legacyDetectorAccounting, "legacyDetectorAccounting");
function budget(limit, used, attempted = used, capped = false, capReason) {
  const safeLimit = Math.max(0, Math.floor(limit));
  const safeUsed = Math.max(0, Math.min(safeLimit, Math.floor(used)));
  const value = {
    limit: safeLimit,
    used: safeUsed,
    remaining: safeLimit - safeUsed,
    attempted: Math.max(safeUsed, Math.floor(attempted)),
    capped,
    ...capped ? { capReason: capReason ?? "Budget was capped." } : {}
  };
  return value;
}
__name(budget, "budget");
function categoryAccounting(category, detectors) {
  const scoped = detectors.filter((detector) => detector.category === category);
  const enabled = scoped.filter((detector) => detector.enabled);
  const state = scoped.length === 0 ? "unassessed" : enabled.length === 0 ? "unavailable" : scoped.some((detector) => detector.state === "unavailable") ? "unavailable" : scoped.some((detector) => detector.state === "blocked") ? "blocked" : scoped.some((detector) => detector.state === "unassessed") ? "unassessed" : scoped.some((detector) => detector.state === "limited") ? "limited" : enabled.some((detector) => detector.state === "assessed") ? "assessed" : "unassessed";
  const limitations = scoped.flatMap((detector) => [
    ...detector.limitation ? [detector.limitation] : [],
    ...detector.disabledReason ? [detector.disabledReason] : []
  ]);
  const reason = state === "assessed" ? void 0 : limitations[0] ?? (scoped.length === 0 ? `Category ${category} has no deterministic detector in the current manifest.` : enabled.length === 0 ? `Category ${category} has no enabled detector in the current manifest.` : `Category ${category} was not fully assessed by the deterministic manifest.`);
  return CategoryAccountingSchema.parse({
    category,
    state,
    detectorCount: scoped.length,
    emitted: scoped.reduce((total, detector) => total + detector.emitted, 0),
    rejected: scoped.reduce((total, detector) => total + detector.rejected, 0),
    capped: scoped.some((detector) => detector.capped),
    ...reason ? { reason } : {},
    ...limitations.length > 0 ? { limitations: unique2(limitations).slice(0, 100) } : {}
  });
}
__name(categoryAccounting, "categoryAccounting");
function overallAccountingState(categories) {
  const nonAssessed = categories.find((category) => category.state !== "assessed");
  if (!nonAssessed) return { state: "assessed" };
  return {
    state: nonAssessed.state,
    reason: nonAssessed.reason ?? nonAssessed.limitation ?? nonAssessed.limitations?.[0] ?? "The run completed with limitations."
  };
}
__name(overallAccountingState, "overallAccountingState");
async function runDiagnosticRun(context, availability3 = {}) {
  const legacy = await runLegacyDiagnostics(context, availability3);
  const broadResults = [];
  for (const detector of BROAD_DETECTORS) {
    broadResults.push(await executeBroadDetector(detector, context, availability3));
  }
  const legacyAccounting = LEGACY_DETECTOR_IDS.map(
    (detectorId) => legacyDetectorAccounting(
      detectorId,
      legacy.detectorDrafts.get(detectorId) ?? [],
      legacyEnabledFor(detectorId, availability3) && !(detectorId === "broken-conversion-path" && availability3.conversion === false) && !(detectorId === "broken-internal-link" && availability3.internalLink === false),
      legacyInputState(detectorId, context, availability3),
      legacyDisabledReason(detectorId, availability3)
    )
  );
  const detectorAccounting = [...legacyAccounting, ...broadResults.map((result) => result.accounting)];
  const categories = INSIGHT_CATEGORIES.map((category) => categoryAccounting(category, detectorAccounting));
  const overall = overallAccountingState(categories);
  const pages = pagesOf(context).length;
  const renders = context.evidence.renderedPages?.length ?? 0;
  const probes = budget(legacy.probeLimit, legacy.probeUsed, legacy.probeUsed);
  const accounting = InsightAccountingSchema.parse({
    state: overall.state,
    ...overall.reason ? { reason: overall.reason } : {},
    detectors: detectorAccounting,
    categories,
    budgets: {
      pages: budget(pages, pages),
      renders: budget(renders, renders),
      probes,
      modelCalls: budget(0, 0)
    },
    enabledDetectorCount: detectorAccounting.filter((detector) => detector.enabled).length,
    disabledDetectorCount: detectorAccounting.filter((detector) => !detector.enabled).length,
    modelShadow: {
      state: "unassessed",
      understandingCalls: 0,
      criticCalls: 0,
      skippedCalls: 0,
      cappedCalls: 0,
      draftsBeforeCritic: 0,
      draftsAfterCritic: 0,
      rejectedDrafts: 0,
      limitations: [overall.reason ?? "Task 4 does not run model stages."]
    },
    visual: {
      state: "unassessed",
      suggestions: 0,
      accepted: 0,
      rejected: 0,
      truncated: 0,
      capped: false,
      limitations: [overall.reason ?? "Task 4 does not run visual model stages."]
    },
    publication: {
      state: "unassessed",
      attempted: 0,
      published: 0,
      blocked: 0,
      limitations: [overall.reason ?? "Task 4 does not publish catalog-backed opportunities."]
    }
  });
  return {
    drafts: [...legacy.drafts, ...broadResults.flatMap((result) => result.drafts)],
    accounting
  };
}
__name(runDiagnosticRun, "runDiagnosticRun");
