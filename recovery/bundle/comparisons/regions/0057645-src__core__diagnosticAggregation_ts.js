// src/core/diagnosticAggregation.ts
var TECHNICAL_RULE_IDS = [
  "missing-title",
  "duplicate-title",
  "thin-service-page",
  "missing-h1",
  "broken-internal-link",
  "missing-meta-description",
  "missing-structured-data",
  "missing-image-alt"
];
var TECHNICAL_RULE_SET = new Set(TECHNICAL_RULE_IDS);
function aggregateTechnicalDiagnostics(input) {
  const grouped = /* @__PURE__ */ new Map();
  for (const diagnostic of input.diagnostics) {
    if (diagnostic.details?.kind === "broad") continue;
    if (!isTechnicalRuleId(diagnostic.detectorId)) continue;
    const ruleId = diagnostic.detectorId;
    const group = grouped.get(ruleId) ?? [];
    group.push(diagnostic);
    grouped.set(ruleId, group);
  }
  const result = [];
  for (const diagnostic of input.diagnostics) {
    if (diagnostic.details?.kind === "broad") continue;
    if (!isTechnicalRuleId(diagnostic.detectorId)) continue;
    if (result.some((existing) => existing.detectorId === diagnostic.detectorId)) continue;
    const ruleId = diagnostic.detectorId;
    const aggregate = aggregateTechnicalGroup({
      ruleId,
      diagnostics: grouped.get(ruleId) ?? [],
      domain: input.client.domain,
      suppressedEvidenceRefs: input.suppressedEvidenceRefsByRule?.[ruleId] ?? []
    });
    if (aggregate) result.push(aggregate);
  }
  return result;
}
__name(aggregateTechnicalDiagnostics, "aggregateTechnicalDiagnostics");
function isTechnicalRuleId(value) {
  return TECHNICAL_RULE_SET.has(value);
}
__name(isTechnicalRuleId, "isTechnicalRuleId");
function aggregateTechnicalGroup(input) {
  const suppressedPages = new Set(
    input.suppressedEvidenceRefs.filter((ref) => ref.startsWith("page:")).map((ref) => normalizedPageUrl(ref.slice("page:".length)) ?? ref)
  );
  const contributing = [];
  for (const diagnostic of input.diagnostics) {
    const pageRefs = diagnostic.legacyEvidenceRefs.filter((ref) => ref.startsWith("page:"));
    const keptPageRefs = pageRefs.filter(
      (ref) => !suppressedPages.has(
        normalizedPageUrl(ref.slice("page:".length)) ?? ref
      )
    );
    const keptPageKeys = new Set(
      keptPageRefs.map(
        (ref) => normalizedPageUrl(ref.slice("page:".length)) ?? ref
      )
    );
    if (pageRefs.length > 0 && keptPageKeys.size === 0) continue;
    if (input.ruleId === "duplicate-title" && keptPageKeys.size < 2) continue;
    const legacyEvidenceRefs = diagnostic.legacyEvidenceRefs.filter(
      (ref) => !ref.startsWith("page:") || !suppressedPages.has(
        normalizedPageUrl(ref.slice("page:".length)) ?? ref
      )
    );
    contributing.push({ ...diagnostic, legacyEvidenceRefs });
  }
  if (contributing.length === 0) return null;
  const evidenceRefs = unique(
    contributing.flatMap((diagnostic) => diagnostic.legacyEvidenceRefs)
  );
  const pageUrls = evidenceRefs.filter((ref) => ref.startsWith("page:")).map((ref) => ref.slice("page:".length));
  const targetUrls = evidenceRefs.filter((ref) => ref.startsWith("target:")).map((ref) => ref.slice("target:".length));
  const imageCountByPage = /* @__PURE__ */ new Map();
  const addImageCount = /* @__PURE__ */ __name((pageKey3, count5) => {
    imageCountByPage.set(pageKey3, Math.max(imageCountByPage.get(pageKey3) ?? 0, count5));
  }, "addImageCount");
  for (const diagnostic of contributing) {
    let attributed = false;
    for (const ref of diagnostic.legacyEvidenceRefs) {
      const keyed = parseImageAltCountRef(ref);
      if (!keyed) continue;
      addImageCount(crawlKey(keyed.pageUrl), keyed.count);
      attributed = true;
    }
    const pageRefs = diagnostic.legacyEvidenceRefs.filter((ref) => ref.startsWith("page:"));
    const bare = diagnostic.legacyEvidenceRefs.reduce(
      (total, ref) => total + bareMissingImageCount(ref),
      0
    );
    if (!attributed && bare > 0 && pageRefs.length === 1) {
      addImageCount(crawlKey(pageRefs[0].slice("page:".length)), bare);
    }
  }
  const imageCount = [...imageCountByPage.values()].reduce(
    (total, count5) => total + count5,
    0
  );
  const wordCountsByPage = /* @__PURE__ */ new Map();
  for (const diagnostic of contributing) {
    for (const ref of diagnostic.legacyEvidenceRefs) {
      const parsed = parseWordCountRef(ref);
      if (parsed) {
        wordCountsByPage.set(crawlKey(parsed.pageUrl), parsed.wordCount);
      }
    }
    const pageRefs = diagnostic.legacyEvidenceRefs.filter((ref) => ref.startsWith("page:"));
    const bare = diagnostic.legacyEvidenceRefs.map((ref) => /^word-count:(\d+)$/.exec(ref)?.[1]).find((value) => value !== void 0);
    if (bare !== void 0 && pageRefs.length === 1) {
      wordCountsByPage.set(crawlKey(pageRefs[0].slice("page:".length)), Number.parseInt(bare, 10));
    }
  }
  const first = contributing[0];
  const problemType = problemTypeFor(first);
  const aggregate = DiagnosticDraftSchema.parse({
    detectorId: input.ruleId,
    detectorVersion: first.detectorVersion,
    category: definitionForProblemType(problemType).category,
    problemType,
    subject: { kind: "site", key: input.domain },
    observation: aggregateDetected({
      ruleId: input.ruleId,
      pageCount: pageUrls.length,
      targetCount: targetUrls.length,
      imageCount,
      pageUrls,
      wordCountsByPage,
      targetUrls,
      titleValues: evidenceRefs.filter((ref) => ref.startsWith("title:")).map((ref) => ref.slice("title:".length))
    }),
    legacyEvidenceRefs: evidenceRefs,
    rawConfidence: Math.min(...contributing.map((diagnostic) => diagnostic.rawConfidence)),
    state: first.state,
    details: {
      kind: "legacy",
      legacyRuleId: input.ruleId,
      suppressedEvidenceRefs: unique(input.suppressedEvidenceRefs)
    }
  });
  return aggregate;
}
__name(aggregateTechnicalGroup, "aggregateTechnicalGroup");
function problemTypeFor(diagnostic) {
  if (diagnostic.details?.kind === "legacy") {
    switch (diagnostic.details.legacyRuleId) {
      case "missing-title":
        return "missing_page_title";
      case "duplicate-title":
        return "duplicate_page_title";
      case "thin-service-page":
        return "thin_service_content";
      case "missing-h1":
        return "missing_primary_heading";
      case "broken-internal-link":
        return "broken_internal_link";
      case "missing-meta-description":
        return "missing_meta_description";
      case "missing-structured-data":
        return "missing_business_schema";
      case "missing-image-alt":
        return "missing_image_text_alternative";
      default:
        break;
    }
  }
  const direct = diagnostic.problemType;
  if (definitionForProblemType(direct).legacyRuleId === diagnostic.detectorId) {
    return direct;
  }
  throw new Error(`Unsupported technical diagnostic rule: ${diagnostic.detectorId}`);
}
__name(problemTypeFor, "problemTypeFor");
function unique(values) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const value of values) {
    const key = evidenceRefKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
__name(unique, "unique");
function evidenceRefKey(ref) {
  if (ref.startsWith("page:") || ref.startsWith("target:")) {
    const prefix = ref.slice(0, ref.indexOf(":") + 1);
    const url = normalizedPageUrl(ref.slice(prefix.length));
    return `${prefix}${url ?? ref.slice(prefix.length)}`;
  }
  return ref;
}
__name(evidenceRefKey, "evidenceRefKey");
function bareMissingImageCount(ref) {
  const match = /^images-without-alt:(\d+)$/.exec(ref);
  return match ? Number(match[1]) : 0;
}
__name(bareMissingImageCount, "bareMissingImageCount");
function count(value, singular, plural3 = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural3}`;
}
__name(count, "count");
function aggregateDetected(input) {
  const pages = count(input.pageCount, "affected page");
  const pageList = input.pageUrls.length > 0 ? `${input.pageUrls.join(", ")}.` : "none.";
  switch (input.ruleId) {
    case "missing-title":
      return `${pages} ${input.pageCount === 1 ? "is" : "are"} missing a non-empty HTML title: ${pageList}`;
    case "duplicate-title":
      return input.titleValues.length > 0 ? `The title "${input.titleValues[0]}" is repeated on ${count(input.pageCount, "readable page")}: ${pageList}` : `Duplicate HTML titles affect ${pages}: ${pageList}`;
    case "thin-service-page":
      return `${pages} ${input.pageCount === 1 ? "is" : "are"} below the observed 120-word content threshold: ${input.pageUrls.map((url) => {
        const words = input.wordCountsByPage.get(crawlKey(url));
        return words === void 0 ? url : `${url} (${words} words)`;
      }).join(", ") || "none"}.`;
    case "missing-h1":
      return `${pages} ${input.pageCount === 1 ? "has" : "have"} no non-empty H1 heading: ${pageList}`;
    case "broken-internal-link":
      return `${count(input.targetCount, "verified broken internal-link target")} ${input.targetCount === 1 ? "is" : "are"} linked from ${pages}. Targets: ${input.targetUrls.join(", ") || "none"}. Sources: ${pageList}`;
    case "missing-meta-description":
      return `${pages} ${input.pageCount === 1 ? "is" : "are"} missing a non-empty meta description: ${pageList}`;
    case "missing-structured-data":
      return `${pages} ${input.pageCount === 1 ? "has" : "have"} no observed LocalBusiness or Service structured-data type: ${pageList}`;
    case "missing-image-alt":
      return input.imageCount === 0 ? `Images on ${pages} have no observed alt attribute; decorative alt="" images are excluded. Pages: ${pageList}` : `${count(input.imageCount, "image")} across ${pages} ${input.imageCount === 1 ? "is" : "are"} missing an alt attribute; decorative alt="" images are excluded. Pages: ${pageList}`;
  }
}
__name(aggregateDetected, "aggregateDetected");
function normalizedPageUrl(url) {
  const parsed = normalizeAndValidateUrl(url);
  return parsed.ok ? crawlKey(parsed.url) : null;
}
__name(normalizedPageUrl, "normalizedPageUrl");
