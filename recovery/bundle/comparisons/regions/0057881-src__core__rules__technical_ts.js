// src/core/rules/technical.ts
var TECHNICAL_RULE_IDS2 = [
  "missing-title",
  "duplicate-title",
  "thin-service-page",
  "missing-h1",
  "broken-internal-link",
  "missing-meta-description",
  "missing-structured-data",
  "missing-image-alt"
];
function isTechnicalRuleId2(ruleId) {
  return TECHNICAL_RULE_IDS2.includes(ruleId);
}
__name(isTechnicalRuleId2, "isTechnicalRuleId");
function isReadablePage(page) {
  return page.status >= 200 && page.status < 300 && page.wordCount > 0;
}
__name(isReadablePage, "isReadablePage");
function uniquePages(pages) {
  const seen = /* @__PURE__ */ new Set();
  return pages.filter((page) => {
    const key = crawlKey(page.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
__name(uniquePages, "uniquePages");
function normalizedTitle(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
__name(normalizedTitle, "normalizedTitle");
function isServiceShapedPage(url) {
  return !isRegistryPath(url) && looksLikeServiceUrl(url) && !isEditorialPath(url) && !isArchivePath(url);
}
__name(isServiceShapedPage, "isServiceShapedPage");
function isStructuredDataRelevantPage(page) {
  try {
    const parsed = canonicalizeCrawlUrl(page.url);
    return parsed.pathname === "/" || parsed.pathname === "" || isServiceShapedPage(parsed.toString());
  } catch {
    return false;
  }
}
__name(isStructuredDataRelevantPage, "isStructuredDataRelevantPage");
function normalizedPageUrl2(url) {
  const parsed = normalizeAndValidateUrl(url);
  return parsed.ok ? crawlKey(parsed.url) : null;
}
__name(normalizedPageUrl2, "normalizedPageUrl");
function knownPageUrls(evidence) {
  return new Set(
    uniquePages(evidence.site.pages).map((page) => normalizedPageUrl2(page.url)).filter((url) => url !== null)
  );
}
__name(knownPageUrls, "knownPageUrls");
function readablePageUrls(evidence) {
  return new Set(
    uniquePages(evidence.site.pages).filter(isReadablePage).map((page) => normalizedPageUrl2(page.url)).filter((url) => url !== null)
  );
}
__name(readablePageUrls, "readablePageUrls");
function canReconcileTechnicalRule(ruleId, evidence) {
  if (!isTechnicalRuleId2(ruleId)) return false;
  if (!evidence.site.crawlExhaustive || evidence.networkEvents.length > 0) return false;
  const canonicalPages = uniquePages(evidence.site.pages);
  const readablePages = canonicalPages.filter(isReadablePage);
  if (readablePages.length === 0) return false;
  if (canonicalPages.some(
    (page) => page.status >= 200 && page.status < 300 && page.wordCount === 0
  )) {
    return false;
  }
  if (ruleId === "missing-meta-description") {
    return readablePages.every((page) => page.metaDescription !== void 0);
  }
  if (ruleId === "missing-structured-data") {
    const relevantPages = readablePages.filter(isStructuredDataRelevantPage);
    return relevantPages.length > 0 && relevantPages.every(
      (page) => page.structuredDataTypes !== void 0 && (page.structuredDataPresent !== void 0 || page.structuredDataTypes.length === 0)
    );
  }
  if (ruleId === "missing-image-alt") {
    return readablePages.every((page) => page.images !== void 0);
  }
  if (ruleId === "broken-internal-link") {
    const originPage = readablePages[0]?.url;
    if (!originPage) return false;
    const base = new URL(originPage);
    base.pathname = "/";
    base.search = "";
    base.hash = "";
    const pageUrls = knownPageUrls(evidence);
    return evidence.site.links.filter((link) => link.scheme === "http").every((link) => {
      let target;
      try {
        target = normalizedPageUrl2(new URL(link.href, base).toString());
      } catch {
        return false;
      }
      if (!target) return false;
      const parsedTarget = new URL(target);
      return !isSameSite(parsedTarget, base) || pageUrls.has(target);
    });
  }
  return true;
}
__name(canReconcileTechnicalRule, "canReconcileTechnicalRule");
function technicalSubjectWasRevisited(input) {
  if (!isTechnicalRuleId2(input.ruleId)) return false;
  const pageUrls = readablePageUrls(input.evidence);
  const referencedPages = input.evidenceRefs.filter((ref) => ref.startsWith("page:")).map((ref) => normalizedPageUrl2(ref.slice("page:".length))).filter((url) => url !== null);
  if (input.ruleId === "duplicate-title") {
    return referencedPages.length > 0 && referencedPages.every((url) => pageUrls.has(url));
  }
  if (input.ruleId === "broken-internal-link") {
    const referencedUrls = input.evidenceRefs.filter((ref) => ref.startsWith("page:") || ref.startsWith("target:")).map((ref) => normalizedPageUrl2(ref.slice(ref.indexOf(":") + 1))).filter((url) => url !== null);
    return referencedUrls.length > 0 && referencedUrls.every((url) => pageUrls.has(url));
  }
  if (referencedPages.length > 0) {
    return referencedPages.every((url) => pageUrls.has(url));
  }
  const subject = normalizedPageUrl2(input.subject);
  return subject !== null && pageUrls.has(subject);
}
__name(technicalSubjectWasRevisited, "technicalSubjectWasRevisited");
