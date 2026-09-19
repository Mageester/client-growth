// src/core/visualReview.ts
var HOUSEKEEPING = /\b(?:h1|meta description|alt (?:text|attribute)|structured data|schema markup|missing (?:page )?title)\b/i;
var INVENTED_METRICS = /\b\d+(?:\.\d+)?\s*%|[$£€]\s*\d|\b(?:guarantee[sd]?|will increase|will boost|losing \d|lost \d|conversion rate is|bounce rate is|search volume)\b/i;
var INJECTION = /ignore (?:all |the |any )?(?:previous|prior|system)|system prompt|api[ _-]?key|reveal.*secret|follow these instructions/i;
function isVisualService(service) {
  return service.active && (service.tags.includes("visual-review") || service.tags.includes("landing-page") || service.tags.includes("service-pages-build") || service.tags.includes("conversion-fix") || service.tags.includes("competitor-gap") || /web(?:site)? design|redesign|conversion|ux|user experience/i.test(service.name));
}
__name(isVisualService, "isVisualService");
var validatedVisualFindings = /* @__PURE__ */ new WeakSet();
function deepFreeze(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(value[key]);
  }
  return Object.freeze(value);
}
__name(deepFreeze, "deepFreeze");
function brandVisualFinding(finding) {
  const canonical2 = deepFreeze(finding);
  validatedVisualFindings.add(canonical2);
  return canonical2;
}
__name(brandVisualFinding, "brandVisualFinding");
function isValidatedVisualFinding(finding) {
  return typeof finding === "object" && finding !== null && validatedVisualFindings.has(finding);
}
__name(isValidatedVisualFinding, "isValidatedVisualFinding");
function validateVisualFindings(raw, screenshots, renderedOrCatalog, catalogOrOptions, modernOptions) {
  const modern = Array.isArray(catalogOrOptions);
  const rendered = modern ? renderedOrCatalog : [];
  const catalog = modern ? catalogOrOptions : renderedOrCatalog;
  const options = (modern ? modernOptions : catalogOrOptions) ?? {};
  const requireExactReferences = options.requireExactReferences ?? modern;
  const maxFindings = Math.max(
    0,
    Number.isInteger(options.maxFindings) ? options.maxFindings : 3
  );
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of raw) {
    const parsed = VisualFindingSchema.safeParse(item);
    if (!parsed.success) continue;
    const f = parsed.data;
    if (f.visualEvidence && f.evidence && JSON.stringify(f.visualEvidence) !== JSON.stringify(f.evidence)) {
      continue;
    }
    const references = f.visualEvidence ?? f.evidence;
    if (requireExactReferences && !references?.length) continue;
    const allText = [
      f.title,
      f.observation,
      f.impact,
      f.recommendation,
      f.counterEvidence ?? "",
      ...f.scope,
      ...f.acceptanceCriteria
    ].join(" ");
    if (HOUSEKEEPING.test(allText) || INVENTED_METRICS.test(allText) || INJECTION.test(allText))
      continue;
    if (requireExactReferences && !screenshots.some((s) => isUsableVisualCapture(s))) {
      continue;
    }
    if (options.mode !== "shadow" && (!f.serviceId || !catalog.some((s) => s.id === f.serviceId && isVisualService(s))))
      continue;
    const normalized3 = references ? exactVisualEvidence(
      f,
      references,
      screenshots,
      rendered,
      requireExactReferences
    ) : f.screenshotIds.every(
      (id) => screenshots.some(
        (s) => s.id === id && samePage2(s.pageUrl, f.pageUrl)
      )
    ) ? f : void 0;
    if (!normalized3) continue;
    const key = visualSubject(f);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(brandVisualFinding(normalized3));
  }
  return result.sort(
    (a, b) => Number(b.priority === "high") - Number(a.priority === "high")
  ).slice(0, maxFindings);
}
__name(validateVisualFindings, "validateVisualFindings");
function isUsableVisualCapture(screenshot) {
  const candidate = screenshot;
  const title2 = candidate.page?.title ?? "";
  const text = candidate.text ?? "";
  const combined = `${title2} ${text}`;
  if (/just a moment|access denied|attention required|verify you are human|checking your browser|page not found|service unavailable|sign in to continue|log in to continue/i.test(
    combined
  )) {
    return false;
  }
  if (typeof candidate.page?.status === "number" && (candidate.page.status < 200 || candidate.page.status >= 300)) {
    return false;
  }
  if (candidate.page && typeof candidate.page.wordCount === "number" && candidate.page.wordCount < 25 && text.trim().length < 120) {
    return false;
  }
  return true;
}
__name(isUsableVisualCapture, "isUsableVisualCapture");
function samePage2(a, b) {
  return crawlKey(a) === crawlKey(b);
}
__name(samePage2, "samePage");
function matchingRenderedElement(rendered, reference) {
  if (!reference.renderedObservationId) return void 0;
  const ids = /* @__PURE__ */ new Set([
    reference.renderedObservationId,
    `${reference.screenshotId}:${reference.renderedObservationId}`,
    `rendered:${reference.screenshotId}:${reference.renderedObservationId}`
  ]);
  return rendered.filter(
    (page) => page.source === "rendered" && page.screenshotId === reference.screenshotId && samePage2(page.pageUrl, reference.pageUrl) && page.viewport === reference.viewport && page.width === reference.width && page.height === reference.height
  ).flatMap((page) => page.elements).find((element) => element.source === "rendered" && ids.has(element.elementKey));
}
__name(matchingRenderedElement, "matchingRenderedElement");
function geometryIntersects(a, b) {
  return Math.max(a.left, b.left) < Math.min(a.left + a.width, b.left + b.width) && Math.max(a.top, b.top) < Math.min(a.top + a.height, b.top + b.height);
}
__name(geometryIntersects, "geometryIntersects");
function exactVisualEvidence(finding, rawReferences, screenshots, rendered, requireExactReferences) {
  const references = rawReferences.map(
    (reference) => VisualEvidenceReferenceSchema.safeParse(reference)
  );
  if (references.some((reference) => !reference.success)) return void 0;
  const parsedReferences = references.map((reference) => reference.data);
  const screenshotIds = [...new Set(finding.screenshotIds)];
  if (finding.screenshotIds.length !== screenshotIds.length || parsedReferences.length < screenshotIds.length || parsedReferences.some((reference) => !screenshotIds.includes(reference.screenshotId)) || screenshotIds.some(
    (screenshotId) => !parsedReferences.some((reference) => reference.screenshotId === screenshotId)
  )) {
    return void 0;
  }
  const matchedElements = [];
  for (const reference of parsedReferences) {
    const screenshot = screenshots.find((candidate) => candidate.id === reference.screenshotId);
    if (!screenshot) return void 0;
    if (requireExactReferences && !isUsableVisualCapture(screenshot)) return void 0;
    if (!samePage2(reference.pageUrl, screenshot.pageUrl) || !samePage2(finding.pageUrl, screenshot.pageUrl) || reference.viewport !== screenshot.viewport || reference.width !== screenshot.width || reference.height !== screenshot.height) {
      return void 0;
    }
    const right = reference.visibleRegion.left + reference.visibleRegion.width;
    const bottom = reference.visibleRegion.top + reference.visibleRegion.height;
    if (right > reference.width || bottom > reference.height) return void 0;
    const element = matchingRenderedElement(rendered, reference);
    if (reference.renderedObservationId && !element) return void 0;
    if (element && !geometryIntersects(element.geometry, {
      ...reference.visibleRegion,
      horizontallyClipped: false,
      verticallyClipped: false
    })) {
      return void 0;
    }
    if (element) matchedElements.push(element);
  }
  const geometryClaim = (/* @__PURE__ */ new Set([
    "overlap",
    "clipped",
    "obscured-action",
    "small-target",
    "target-size"
  ])).has(finding.problem ?? "");
  if (requireExactReferences && geometryClaim && matchedElements.length === 0) {
    return void 0;
  }
  if (requireExactReferences && (finding.problem === "clipped" || finding.problem === "small-target" || finding.problem === "target-size")) {
    if (finding.problem === "clipped" && !matchedElements.some((element) => element.geometry.horizontallyClipped || element.geometry.verticallyClipped)) {
      return void 0;
    }
    if ((finding.problem === "small-target" || finding.problem === "target-size") && !matchedElements.some((element) => element.geometry.width < 44 || element.geometry.height < 44)) {
      return void 0;
    }
  }
  if (requireExactReferences && (finding.problem === "overlap" || finding.problem === "obscured-action")) {
    const observationIds = new Set(
      parsedReferences.map((reference) => reference.renderedObservationId).filter((id) => Boolean(id))
    );
    if (matchedElements.length < 2 || observationIds.size < 2) return void 0;
    const overlaps = matchedElements.some(
      (left, index) => matchedElements.slice(index + 1).some((right) => geometryIntersects(left.geometry, right.geometry))
    );
    if (!overlaps) return void 0;
  }
  if (!requireExactReferences) return finding;
  const canonicalPageUrl = screenshots.find((candidate) => candidate.id === parsedReferences[0]?.screenshotId)?.pageUrl ?? finding.pageUrl;
  return {
    ...finding,
    pageUrl: canonicalPageUrl,
    visualEvidence: parsedReferences.map((reference) => ({
      ...reference,
      pageUrl: screenshots.find((candidate) => candidate.id === reference.screenshotId)?.pageUrl ?? reference.pageUrl
    }))
  };
}
__name(exactVisualEvidence, "exactVisualEvidence");
function visualSubject(f) {
  return `${f.region && f.problem ? `${f.region}:${f.problem}` : f.category}:${crawlKey(f.pageUrl)}`;
}
__name(visualSubject, "visualSubject");
function diagnosticFromVisualFinding(f) {
  if (!isValidatedVisualFinding(f)) {
    throw new TypeError("Visual finding must be validated before adaptation");
  }
  const base = legacyDiagnosticDraft({
    detectorId: "visual-conversion-opportunity",
    problemType: "visual_conversion_obstacle",
    subject: { kind: "element", key: visualSubject(f) },
    observation: f.observation,
    legacyEvidenceRefs: [f.pageUrl, ...f.screenshotIds.map((id) => `visual:${id}`)],
    rawConfidence: 0.7
  });
  return DiagnosticDraftSchema.parse({
    ...base,
    ...f.counterEvidence ? {
      counterEvidence: [f.counterEvidence],
      counterEvidenceState: "present"
    } : { counterEvidenceState: "not_checked" }
  });
}
__name(diagnosticFromVisualFinding, "diagnosticFromVisualFinding");
function matchingVisualPrior(f, clientId2, existing) {
  const key = dedupeKey(
    clientId2,
    "visual-conversion-opportunity",
    visualSubject(f)
  );
  const exact = existing.find(
    (o) => o.clientId === clientId2 && o.dedupeKey === key
  );
  if (exact) return exact;
  const normalize = /* @__PURE__ */ __name((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), "normalize");
  const legacy = existing.filter(
    (o) => o.clientId === clientId2 && o.ruleId === "visual-conversion-opportunity" && o.suggestedServiceId === f.serviceId && o.evidenceRefs.some(
      (r) => /^https?:/.test(r) && crawlKey(r) === crawlKey(f.pageUrl)
    ) && (normalize(o.title) === normalize(f.title) || normalize(o.detected) === normalize(f.observation))
  );
  return legacy.length === 1 ? legacy[0] : void 0;
}
__name(matchingVisualPrior, "matchingVisualPrior");
function visualCandidate(f) {
  if (!f.serviceId) {
    throw new TypeError("A visual candidate requires an active catalog service");
  }
  return {
    ruleId: "visual-conversion-opportunity",
    subject: visualSubject(f),
    visualTitle: f.title,
    detected: f.observation,
    evidenceRefs: [f.pageUrl, ...f.screenshotIds.map((id) => `visual:${id}`)],
    // A fixed internal gate value, deliberately never shown as an AI confidence %.
    rawConfidence: 0.7,
    suggestedServiceId: f.serviceId
  };
}
__name(visualCandidate, "visualCandidate");
function visualEvaluation(f) {
  return {
    verdict: "surface",
    confidence: 0.7,
    commerciallyActionable: true,
    rationale: f.impact,
    suggestedScope: [
      f.recommendation,
      ...f.scope,
      ...f.acceptanceCriteria.map((s) => `Acceptance check: ${s}`)
    ]
  };
}
__name(visualEvaluation, "visualEvaluation");
