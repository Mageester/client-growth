// src/core/rules/brokenInternalLink.ts
function normalizedUrl(value, base) {
  const parsed = normalizeAndValidateUrl(value, base);
  return parsed.ok ? parsed.url.toString() : null;
}
__name(normalizedUrl, "normalizedUrl");
function elementLabel2(link) {
  return link.label || link.ariaLabel || link.title || "(unlabelled)";
}
__name(elementLabel2, "elementLabel");
function definiteMissing(result) {
  return (result.outcome === void 0 || result.outcome === "complete") && (result.status === 404 || result.status === 410);
}
__name(definiteMissing, "definiteMissing");
async function detectBrokenInternalLinkDiagnostic(ctx) {
  const pages = uniquePages(ctx.evidence.site.pages);
  const firstPage = pages[0]?.url;
  if (!firstPage) return [];
  const base = new URL(firstPage);
  base.pathname = "/";
  base.search = "";
  base.hash = "";
  const pageByUrl = /* @__PURE__ */ new Map();
  for (const page of pages) {
    const url = normalizedUrl(page.url, base.toString());
    if (url) pageByUrl.set(crawlKey(url), page);
  }
  const budget3 = ctx.probeBudget ?? { remaining: 8 };
  const targets = /* @__PURE__ */ new Map();
  const links2 = [...ctx.evidence.site.links].filter((link) => link.scheme === "http").sort((left, right) => linkPriority(right) - linkPriority(left));
  for (const link of links2) {
    let target;
    try {
      target = normalizedUrl(link.href, base.toString());
    } catch {
      target = null;
    }
    if (!target) continue;
    const parsedTarget = new URL(target);
    if (!isSameSite(parsedTarget, base)) continue;
    if (isPlatformInfrastructurePath(target)) continue;
    const key = crawlKey(target);
    const crawled = pageByUrl.get(key);
    let status;
    if (crawled?.status === 404 || crawled?.status === 410) {
      status = crawled.status;
    } else if (!crawled && ctx.probe && budget3.remaining > 0) {
      budget3.remaining--;
      const result = await ctx.probe(target);
      if (definiteMissing(result)) status = result.status === 404 ? 404 : 410;
    }
    if (status === void 0) continue;
    const existing = targets.get(key);
    if (existing) {
      existing.foundOn = [.../* @__PURE__ */ new Set([...existing.foundOn, ...link.foundOn])];
      if (existing.label === "(unlabelled)") existing.label = elementLabel2(link);
      continue;
    }
    targets.set(key, {
      target,
      status,
      foundOn: [...link.foundOn],
      label: elementLabel2(link)
    });
  }
  return [...targets.values()].map(
    (broken) => legacyDiagnosticDraft({
      detectorId: "broken-internal-link",
      problemType: "broken_internal_link",
      subject: { kind: "element", key: broken.target },
      observation: `The internal link "${broken.label}" on ${broken.foundOn[0] ?? base.origin} points to ${broken.target}, which returned HTTP ${broken.status}.`,
      legacyEvidenceRefs: [
        ...broken.foundOn.map((url) => `page:${url}`),
        `target:${broken.target}`,
        `status:${broken.status}`
      ],
      rawConfidence: 0.95
    })
  );
}
__name(detectBrokenInternalLinkDiagnostic, "detectBrokenInternalLinkDiagnostic");
function linkPriority(link) {
  const isConversion = classifyConversionLink(link) !== null;
  if (!isConversion) return link.inNav ? 3 : 2;
  return link.inNav ? 1 : 0;
}
__name(linkPriority, "linkPriority");
