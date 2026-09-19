// src/core/rules/brokenConversionPath.ts
var REPEAT_5XX = /* @__PURE__ */ new Set([500, 502, 503]);
var INTENT_WORD = {
  contact: "contact link",
  quote: "quote request button",
  book: "booking button",
  call: "click-to-call link"
};
var INTENT_PAGE = {
  contact: "contact page",
  quote: "quote request page",
  book: "booking page",
  call: "call page"
};
function toOrigin(domain) {
  const parsed = normalizeOrigin(domain);
  return parsed.ok ? parsed.url.origin : null;
}
__name(toOrigin, "toOrigin");
function normalizeTarget(target) {
  const parsed = normalizeAndValidateUrl(target);
  return parsed.ok ? parsed.url.toString() : null;
}
__name(normalizeTarget, "normalizeTarget");
function isDeadLinkStatus(status) {
  return status === 404 || status === 410 || status === 405;
}
__name(isDeadLinkStatus, "isDeadLinkStatus");
function isDeadFormStatus(status) {
  return status === 404 || status === 410;
}
__name(isDeadFormStatus, "isDeadFormStatus");
function confidenceFor(kind, status) {
  if (kind === "malformed-tel") return 0.9;
  if (kind === "broken-form-target") return status === void 0 ? 0.9 : 0.85;
  if (kind === "conversion-page-error") return status && status >= 500 ? 0.75 : 0.85;
  if (status === void 0) return 0.9;
  if (status === 404 || status === 410) return 0.85;
  if (status === 405) return 0.75;
  return 0.75;
}
__name(confidenceFor, "confidenceFor");
function elementLabel(link) {
  return link.label || link.ariaLabel || link.title || "(unlabelled)";
}
__name(elementLabel, "elementLabel");
async function collectConversionDefects(ctx) {
  const origin = toOrigin(ctx.client.domain);
  if (!origin) return { defects: [], unassessed: [] };
  const probe = ctx.probe;
  const budget3 = ctx.probeBudget ?? { remaining: 8 };
  const pages = uniquePages(ctx.evidence.site.pages);
  const pageByUrl = new Map(
    pages.map((p) => [crawlKey(normalizeTarget(p.url) ?? p.url), p])
  );
  const defects = [];
  const seenKeys = /* @__PURE__ */ new Set();
  const unassessed = [];
  const unassessedKeys = /* @__PURE__ */ new Set();
  const add = /* @__PURE__ */ __name((d) => {
    const key = `${d.kind}:${d.target ?? d.elementHref}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    defects.push(d);
  }, "add");
  const addUnassessed = /* @__PURE__ */ __name((input) => {
    const key = `${input.elementHref}:${input.target}`;
    if (unassessedKeys.has(key)) return;
    unassessedKeys.add(key);
    unassessed.push(input);
  }, "addUnassessed");
  const confirm5xx = /* @__PURE__ */ __name(async (url) => {
    if (!probe || budget3.remaining <= 0) return false;
    budget3.remaining--;
    const r = await probe(url);
    return REPEAT_5XX.has(r.status);
  }, "confirm5xx");
  for (const link of ctx.evidence.site.links) {
    if (link.scheme !== "tel") continue;
    if (telDefect(link.href) !== "malformed") continue;
    add({
      kind: "malformed-tel",
      pageUrl: link.foundOn[0] ?? origin,
      elementText: elementLabel(link),
      elementHref: link.href,
      seenOn: link.foundOn,
      note: "the click-to-call link is not a dialable phone number"
    });
  }
  for (const page of pages) {
    for (const form of page.forms) {
      const action2 = form.action.trim();
      if (!action2 || action2 === "#") continue;
      let target;
      try {
        target = new URL(action2, page.url).toString();
      } catch {
        continue;
      }
      const normalizedTarget = normalizeTarget(target);
      if (!normalizedTarget) continue;
      target = normalizedTarget;
      if (isPlaceholderTarget(action2) || isPlaceholderTarget(target)) {
        add({
          kind: "broken-form-target",
          pageUrl: page.url,
          elementText: "form",
          elementHref: action2,
          target,
          seenOn: [page.url],
          note: "the enquiry form submits to an unconfigured placeholder address"
        });
        continue;
      }
      const external = new URL(target).origin !== origin;
      if (external || form.method !== "GET") continue;
      if (!probe || budget3.remaining <= 0) {
        addUnassessed({
          target,
          pageUrl: page.url,
          elementText: "form",
          elementHref: action2,
          reason: !probe ? "no status probe was available" : "the conversion probe budget was exhausted"
        });
        continue;
      }
      budget3.remaining--;
      const r = await probe(target);
      if (isDeadFormStatus(r.status)) {
        add({
          kind: "broken-form-target",
          pageUrl: page.url,
          elementText: "form",
          elementHref: action2,
          target,
          observedStatus: r.status,
          seenOn: [page.url],
          note: `the enquiry form submits to an address that returns HTTP ${r.status}`
        });
      } else if (REPEAT_5XX.has(r.status)) {
        if (await confirm5xx(target)) {
          add({
            kind: "broken-form-target",
            pageUrl: page.url,
            elementText: "form",
            elementHref: action2,
            target,
            observedStatus: r.status,
            seenOn: [page.url],
            note: `the enquiry form submits to an address that returns HTTP ${r.status} (confirmed)`
          });
        } else {
          addUnassessed({
            target,
            pageUrl: page.url,
            elementText: "form",
            elementHref: action2,
            reason: "a repeat probe was unavailable after an inconclusive server error"
          });
        }
      }
    }
  }
  const targets = /* @__PURE__ */ new Map();
  for (const link of ctx.evidence.site.links) {
    if (link.scheme !== "http") continue;
    const target = normalizeTarget(link.href);
    if (!target) continue;
    const intent = classifyConversionLink({ ...link, href: target });
    if (!intent) continue;
    const key = crawlKey(target);
    const existing = targets.get(key);
    if (!existing) {
      targets.set(key, { link: { ...link, href: target, foundOn: [...link.foundOn] }, intent });
    } else {
      existing.link.foundOn = [.../* @__PURE__ */ new Set([...existing.link.foundOn, ...link.foundOn])];
    }
  }
  for (const [target, { link, intent }] of targets) {
    const external = new URL(target).origin !== origin;
    if (external) {
      if (isPlaceholderTarget(target)) {
        add({
          kind: "dead-conversion-link",
          pageUrl: link.foundOn[0] ?? origin,
          elementText: elementLabel(link),
          elementHref: link.href,
          target,
          seenOn: link.foundOn,
          note: `the ${INTENT_WORD[intent]} points to an unconfigured external placeholder`
        });
      }
      continue;
    }
    const crawled = pageByUrl.get(crawlKey(target));
    if (crawled) {
      if (crawled.status < 400) continue;
      if (isDeadLinkStatus(crawled.status)) {
        add(deadLink(link, intent, target, crawled.status));
      } else if (REPEAT_5XX.has(crawled.status)) {
        if (await confirm5xx(target)) {
          add(deadLink(link, intent, target, crawled.status));
        } else {
          addUnassessed({
            target,
            pageUrl: link.foundOn[0] ?? origin,
            elementText: elementLabel(link),
            elementHref: link.href,
            reason: "a repeat probe was unavailable after an inconclusive server error"
          });
        }
      }
      continue;
    }
    if (!probe || budget3.remaining <= 0) {
      addUnassessed({
        target,
        pageUrl: link.foundOn[0] ?? origin,
        elementText: elementLabel(link),
        elementHref: link.href,
        reason: !probe ? "no status probe was available" : "the conversion probe budget was exhausted"
      });
      continue;
    }
    budget3.remaining--;
    const r = await probe(target);
    if (isDeadLinkStatus(r.status)) {
      add(deadLink(link, intent, target, r.status));
    } else if (REPEAT_5XX.has(r.status)) {
      if (await confirm5xx(target)) {
        add(deadLink(link, intent, target, r.status));
      } else {
        addUnassessed({
          target,
          pageUrl: link.foundOn[0] ?? origin,
          elementText: elementLabel(link),
          elementHref: link.href,
          reason: "a repeat probe was unavailable after an inconclusive server error"
        });
      }
    }
  }
  for (const page of ctx.evidence.site.pages) {
    if (page.status < 400) continue;
    const target = normalizeTarget(page.url);
    if (!target || new URL(target).origin !== origin) continue;
    if (targets.has(crawlKey(target))) continue;
    const asLink = {
      href: target,
      label: "",
      ariaLabel: "",
      title: "",
      scheme: "http",
      inNav: false,
      inServiceNav: false,
      foundOn: [target]
    };
    const intent = classifyConversionLink(asLink);
    if (!intent) continue;
    if (isDeadLinkStatus(page.status)) {
      add({
        kind: "conversion-page-error",
        pageUrl: target,
        elementText: INTENT_PAGE[intent],
        elementHref: target,
        target,
        observedStatus: page.status,
        seenOn: [target],
        note: `the ${INTENT_PAGE[intent]} returns HTTP ${page.status}`
      });
    } else if (REPEAT_5XX.has(page.status)) {
      if (await confirm5xx(target)) {
        add({
          kind: "conversion-page-error",
          pageUrl: target,
          elementText: INTENT_PAGE[intent],
          elementHref: target,
          observedStatus: page.status,
          seenOn: [target],
          note: `the ${INTENT_PAGE[intent]} returns HTTP ${page.status} (confirmed)`
        });
      } else {
        addUnassessed({
          target,
          pageUrl: target,
          elementText: INTENT_PAGE[intent],
          elementHref: target,
          reason: "a repeat probe was unavailable after an inconclusive server error"
        });
      }
    }
  }
  return { defects, unassessed };
}
__name(collectConversionDefects, "collectConversionDefects");
async function detectBrokenConversionPathDiagnostic(ctx) {
  const detection = await collectConversionDefects(ctx);
  const observed = detection.defects.map((defect) => {
    const candidateShape = toCandidate(defect, "diagnostic-only");
    return legacyDiagnosticDraft({
      detectorId: "broken-conversion-path",
      problemType: "broken_conversion_path",
      subject: { kind: "element", key: candidateShape.subject },
      observation: candidateShape.detected,
      legacyEvidenceRefs: candidateShape.evidenceRefs,
      rawConfidence: candidateShape.rawConfidence,
      details: { kind: "conversion_defect", conversionDefect: defect }
    });
  });
  const unknown2 = detection.unassessed.map(
    (target) => legacyDiagnosticDraft({
      detectorId: "broken-conversion-path",
      problemType: "broken_conversion_path",
      subject: { kind: "element", key: `unassessed:${target.target}` },
      observation: `The conversion target ${target.target} on ${target.pageUrl} was not assessed: ${target.reason}.`,
      legacyEvidenceRefs: [`page:${target.pageUrl}`, `target:${target.target}`],
      rawConfidence: 0,
      state: "unknown"
    })
  );
  return [...observed, ...unknown2];
}
__name(detectBrokenConversionPathDiagnostic, "detectBrokenConversionPathDiagnostic");
function deadLink(link, intent, target, status) {
  return {
    kind: "dead-conversion-link",
    pageUrl: link.foundOn[0] ?? "",
    elementText: elementLabel(link),
    elementHref: link.href,
    target,
    observedStatus: status,
    seenOn: link.foundOn,
    note: `the ${INTENT_WORD[intent]} links to an address that returns HTTP ${status}`
  };
}
__name(deadLink, "deadLink");
function toCandidate(d, serviceId) {
  const also = d.seenOn.length > 1 ? ` Appears on ${d.seenOn.length} pages.` : "";
  let detected;
  switch (d.kind) {
    case "malformed-tel":
      detected = `The click-to-call link on ${d.pageUrl} uses href="${d.elementHref}", which will not dial on a phone.${also}`;
      break;
    case "broken-form-target":
      detected = d.observedStatus ? `The form on ${d.pageUrl} submits (GET) to ${d.target}, which returns HTTP ${d.observedStatus}.` : `The form on ${d.pageUrl} submits to "${d.elementHref}", an unconfigured placeholder target.`;
      break;
    case "conversion-page-error":
      detected = `The ${d.elementText} (${d.pageUrl}) returns HTTP ${d.observedStatus} \u2014 visitors cannot reach it.`;
      break;
    default:
      detected = d.observedStatus ? `The "${d.elementText}" ${d.kind === "dead-conversion-link" ? "conversion button" : "element"} on ${d.pageUrl} links to ${d.target}, which returns HTTP ${d.observedStatus}.${also}` : `The "${d.elementText}" conversion button on ${d.pageUrl} points to an unconfigured placeholder URL (${d.target}).${also}`;
  }
  const evidenceRefs = [
    ...d.seenOn.map((u) => `page:${u}`),
    ...d.elementHref ? [`element:${d.elementHref}`] : [],
    ...d.target ? [`target:${d.target}`] : [],
    ...d.observedStatus !== void 0 ? [`status:${d.observedStatus}`] : []
  ];
  return {
    ruleId: "broken-conversion-path",
    subject: `${d.kind}:${d.target ?? d.elementHref}`,
    detected,
    evidenceRefs,
    rawConfidence: confidenceFor(d.kind, d.observedStatus),
    suggestedServiceId: serviceId,
    conversionDefect: d
  };
}
__name(toCandidate, "toCandidate");
