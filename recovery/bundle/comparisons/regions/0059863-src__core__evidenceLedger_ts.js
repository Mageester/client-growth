// src/core/evidenceLedger.ts
var MAX_LOCATOR_LENGTH = 5e3;
var MAX_PAGE_URL_LENGTH = 2e3;
var MAX_PAYLOAD_STRING_LENGTH = 4e3;
var MAX_LEDGER_ENTRIES = 1e4;
function fnv1a642(value) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}
__name(fnv1a642, "fnv1a64");
function boundedTrim(value, maxLength, label) {
  if (value.length > maxLength) {
    throw new Error(`${label} cannot be represented losslessly within ${maxLength} characters.`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required and cannot be whitespace-only.`);
  return trimmed;
}
__name(boundedTrim, "boundedTrim");
function canonicalUrl(value, preserveFragment = false) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const key = crawlKey(url);
    return preserveFragment && url.hash ? `${key}${url.hash}` : key;
  } catch {
    return null;
  }
}
__name(canonicalUrl, "canonicalUrl");
function normalizeLocator(value, preserveFragment = false) {
  const trimmed = value.trim();
  return canonicalUrl(trimmed, preserveFragment) ?? trimmed;
}
__name(normalizeLocator, "normalizeLocator");
var CREDENTIAL_LABEL = /\b(authorization|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|pass|api[-_]?key|auth|credential|bearer|basic|key|signature|sig)\b/i;
var MAX_REDACTION_DECODE_PASSES = 6;
var MAX_NESTED_URL_DEPTH = 5;
function boundedDecode2(value, passes = MAX_REDACTION_DECODE_PASSES) {
  let decoded = value;
  for (let index = 0; index < passes; index += 1) {
    const next = decoded.replace(
      /%([0-9a-f]{2})/gi,
      (_match, hex2) => String.fromCharCode(Number.parseInt(hex2, 16))
    );
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}
__name(boundedDecode2, "boundedDecode");
function sanitizeCredentialPathSegments(value) {
  return value.replace(
    new RegExp(`(^|[/#])(${CREDENTIAL_LABEL.source})(?:/|%[0-9a-f]{0,2}/)([^/?#&\\s]+)`, "gi"),
    (_match, prefix, label) => `${prefix}${label}/[redacted]`
  );
}
__name(sanitizeCredentialPathSegments, "sanitizeCredentialPathSegments");
function sanitizeCredentialText(value) {
  return value.replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{3,}/gi, (scheme) => `${scheme.split(/\s+/)[0]} [redacted]`).replace(new RegExp(`${CREDENTIAL_LABEL.source}(?:\\s*[:=]\\s*|\\s+)[^\\s,;]+`, "gi"), (match) => {
    const key = CREDENTIAL_LABEL.exec(match)?.[1] ?? match;
    CREDENTIAL_LABEL.lastIndex = 0;
    return `${key}=[redacted]`;
  }).replace(
    /([?&\s])([^?&=\s]+)=([^&\s]+)/gi,
    (match, prefix, key) => isCredentialQueryKey(key) ? `${prefix}${key}=[redacted]` : match
  );
}
__name(sanitizeCredentialText, "sanitizeCredentialText");
function sanitizeEncodedCredentialText(value) {
  const raw = sanitizeCredentialPathSegments(sanitizeCredentialText(value));
  const decoded = boundedDecode2(value);
  const redactedDecoded = sanitizeCredentialPathSegments(sanitizeCredentialText(decoded));
  return redactedDecoded !== decoded ? redactedDecoded : raw;
}
__name(sanitizeEncodedCredentialText, "sanitizeEncodedCredentialText");
function sanitizedUrlComponent(value) {
  const raw = sanitizeCredentialPathSegments(sanitizeCredentialText(value));
  const decoded = boundedDecode2(value);
  const redactedDecoded = sanitizeCredentialPathSegments(sanitizeCredentialText(decoded));
  if (redactedDecoded !== decoded) return redactedDecoded;
  return raw;
}
__name(sanitizedUrlComponent, "sanitizedUrlComponent");
function urlComponentHasCredential(value) {
  return sanitizedUrlComponent(value) !== value;
}
__name(urlComponentHasCredential, "urlComponentHasCredential");
function nestedQueryValue(value, depth) {
  const decoded = boundedDecode2(value);
  if (depth < MAX_NESTED_URL_DEPTH && /^https?:\/\//i.test(decoded.trim()) && urlHasCredential(decoded, depth + 1)) {
    return sanitizeEvidenceUrlInternal(decoded, depth + 1);
  }
  return sanitizeEncodedCredentialText(value);
}
__name(nestedQueryValue, "nestedQueryValue");
function urlHasCredential(value, depth) {
  if (urlComponentHasCredential(value)) return true;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return true;
    for (const key of parsed.searchParams.keys()) {
      if (isCredentialQueryKey(key)) return true;
    }
    for (const queryValue of parsed.searchParams.values()) {
      const decoded = boundedDecode2(queryValue);
      if (urlComponentHasCredential(decoded)) return true;
      if (depth < MAX_NESTED_URL_DEPTH && /^https?:\/\//i.test(decoded.trim()) && urlHasCredential(decoded, depth + 1)) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}
__name(urlHasCredential, "urlHasCredential");
function sanitizeEvidenceUrlInternal(value, depth) {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
    }
    const pathname = sanitizedUrlComponent(parsed.pathname);
    if (pathname !== parsed.pathname) parsed.pathname = pathname;
    const hash = sanitizedUrlComponent(parsed.hash);
    if (hash !== parsed.hash) parsed.hash = hash;
    for (const key of [...parsed.searchParams.keys()]) {
      if (isCredentialQueryKey(key)) {
        parsed.searchParams.set(key, "[redacted]");
        continue;
      }
      const current = parsed.searchParams.get(key) ?? "";
      const sanitized = nestedQueryValue(current, depth);
      if (sanitized !== current) parsed.searchParams.set(key, sanitized);
    }
    return parsed.toString().replace(/%5Bredacted%5D/gi, "[redacted]");
  } catch {
    return sanitizeEncodedCredentialText(trimmed);
  }
}
__name(sanitizeEvidenceUrlInternal, "sanitizeEvidenceUrlInternal");
function sanitizeEvidenceUrl(value) {
  return sanitizeEvidenceUrlInternal(value, 0);
}
__name(sanitizeEvidenceUrl, "sanitizeEvidenceUrl");
function sanitizeEvidenceText(value) {
  const redacted = sanitizeEncodedCredentialText(value);
  return redacted.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeEvidenceUrl(url));
}
__name(sanitizeEvidenceText, "sanitizeEvidenceText");
function uniqueStrings(values) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const value of values) {
    const trimmed = sanitizeEvidenceText(value).trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
__name(uniqueStrings, "uniqueStrings");
function jsonValue(value) {
  const json2 = JSON.stringify(uniqueStrings(value));
  if (json2.length > MAX_PAYLOAD_STRING_LENGTH) {
    throw new Error(
      `Evidence legacyRefs cannot be represented losslessly within ${MAX_PAYLOAD_STRING_LENGTH} characters.`
    );
  }
  return json2;
}
__name(jsonValue, "jsonValue");
function payloadValue(value, label = "Evidence payload value") {
  if (value === null) return null;
  if (typeof value === "string") {
    const sanitized = sanitizeEvidenceText(value);
    if (sanitized.length > MAX_PAYLOAD_STRING_LENGTH) {
      throw new Error(
        `${label} cannot be represented losslessly within ${MAX_PAYLOAD_STRING_LENGTH} characters.`
      );
    }
    return sanitized;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
  if (typeof value === "boolean") return value;
  return void 0;
}
__name(payloadValue, "payloadValue");
function makePayload(aliases, fields) {
  const refs = uniqueStrings(aliases);
  if (refs.length === 0) {
    throw new Error("Evidence ledger entry requires an observed legacy reference.");
  }
  const payload = {
    // Every generated row carries one observed compatibility ref. `legacyRefs`
    // below retains additional aliases without changing the strict schema shape.
    legacyRef: payloadValue(refs[0], "Evidence legacyRef")
  };
  if (refs.length > 1) payload.legacyRefs = jsonValue(refs);
  for (const [key, value] of Object.entries(fields)) {
    if (key === "legacyRef" || key === "legacyRefs" || value === void 0) continue;
    const bounded3 = payloadValue(value, `Evidence payload field "${key}"`);
    if (bounded3 !== void 0) payload[key] = bounded3;
  }
  return payload;
}
__name(makePayload, "makePayload");
function resolvedHttpTarget(raw, pageUrl, preserveFragment = false) {
  const value = raw.trim();
  try {
    const url = pageUrl ? new URL(value, pageUrl) : new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return canonicalUrl(url.toString(), preserveFragment);
  } catch {
    return null;
  }
}
__name(resolvedHttpTarget, "resolvedHttpTarget");
function firstPageUrl(link) {
  const first = link.foundOn.find((url) => url.trim().length > 0);
  return first ? boundedTrim(first, MAX_PAGE_URL_LENGTH, "link foundOn URL") : void 0;
}
__name(firstPageUrl, "firstPageUrl");
function formLocator(pageUrl, index, action2) {
  const page = normalizeLocator(pageUrl);
  const target = resolvedHttpTarget(action2, pageUrl, true) ?? action2.trim();
  return `form|${page}|${index}|${target}`;
}
__name(formLocator, "formLocator");
function pageAliases(page) {
  const aliases = [`page:${page.url}`, page.url];
  if (page.title.trim() === "") aliases.push("title:missing");
  if (page.h1s.length === 0) aliases.push("h1:missing");
  if (page.metaDescription !== void 0 && page.metaDescription.trim() === "") {
    aliases.push("meta-description:missing");
  }
  if (page.structuredDataTypes !== void 0 && (page.structuredDataPresent ?? page.structuredDataTypes.length > 0) === false) {
    aliases.push("structured-data:localbusiness-or-service-missing");
  }
  if (page.images !== void 0) {
    const missingAlt = page.images.filter((image) => image.alt === void 0).length;
    if (missingAlt > 0) {
      aliases.push(imageAltCountRef(page.url, missingAlt));
      aliases.push(`images-without-alt:${missingAlt}`);
    }
  }
  aliases.push(wordCountRef(page.url, page.wordCount));
  aliases.push(`word-count:${page.wordCount}`);
  return aliases;
}
__name(pageAliases, "pageAliases");
function addLegacyAliases(payload, aliases) {
  const existing = /* @__PURE__ */ new Set([
    typeof payload.legacyRef === "string" ? payload.legacyRef : ""
  ]);
  if (typeof payload.legacyRefs === "string") {
    try {
      const parsed = JSON.parse(payload.legacyRefs);
      if (Array.isArray(parsed)) {
        for (const item of parsed) if (typeof item === "string") existing.add(item);
      }
    } catch {
    }
  }
  for (const alias of aliases) existing.add(alias.trim());
  const values = [...existing].filter(Boolean);
  payload.legacyRefs = jsonValue(values);
}
__name(addLegacyAliases, "addLegacyAliases");
function kindOrder(kind) {
  return [
    "page",
    "link",
    "form",
    "screenshot",
    "performance",
    "accessibility",
    "contact-fact",
    "competitor",
    "probe",
    "element"
  ].indexOf(kind);
}
__name(kindOrder, "kindOrder");
function compareCodePoints(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftPoint = leftPoints[index] ?? 0;
    const rightPoint = rightPoints[index] ?? 0;
    if (leftPoint < rightPoint) return -1;
    if (leftPoint > rightPoint) return 1;
  }
  if (leftPoints.length < rightPoints.length) return -1;
  if (leftPoints.length > rightPoints.length) return 1;
  return 0;
}
__name(compareCodePoints, "compareCodePoints");
function assertEvidenceIdCollisionFree(existing, incoming) {
  if (existing.id !== incoming.id) return;
  if (existing.runId !== incoming.runId || existing.kind !== incoming.kind || existing.locator !== incoming.locator) {
    throw new Error(
      `Evidence ID collision for ${existing.id}: identity tuple differs (${existing.runId}|${existing.kind}|${existing.locator}) vs (${incoming.runId}|${incoming.kind}|${incoming.locator}).`
    );
  }
}
__name(assertEvidenceIdCollisionFree, "assertEvidenceIdCollisionFree");
function pageObservationFields(page) {
  return {
    status: page.status,
    title: page.title,
    h1s: page.h1s,
    headings: page.headings,
    textExcerpt: page.textExcerpt,
    wordCount: page.wordCount,
    forms: page.forms,
    ...page.metaDescription !== void 0 ? { metaDescription: page.metaDescription } : {},
    ...page.structuredDataTypes !== void 0 ? { structuredDataTypes: page.structuredDataTypes } : {},
    ...page.structuredDataPresent !== void 0 ? { structuredDataPresent: page.structuredDataPresent } : {},
    ...page.images !== void 0 ? { images: page.images } : {},
    ...page.ctas !== void 0 ? { ctas: page.ctas } : {},
    ...page.landmarks !== void 0 ? { landmarks: page.landmarks } : {},
    ...page.sections !== void 0 ? { sections: page.sections } : {},
    ...page.proofSignals !== void 0 ? { proofSignals: page.proofSignals } : {},
    ...page.contactFacts !== void 0 ? { contactFacts: page.contactFacts } : {},
    ...page.datedFacts !== void 0 ? { datedFacts: page.datedFacts } : {},
    ...page.accessibility !== void 0 ? { accessibility: page.accessibility } : {}
  };
}
__name(pageObservationFields, "pageObservationFields");
function canonicalObservationValue(value, field) {
  if (Array.isArray(value)) {
    const normalized3 = value.map((item) => canonicalObservationValue(item));
    if (field === "structuredDataTypes") {
      return normalized3.sort((left, right) => compareCodePoints(String(left), String(right)));
    }
    return normalized3;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => compareCodePoints(left, right)).map(([key, item]) => [key, canonicalObservationValue(item)])
    );
  }
  return value;
}
__name(canonicalObservationValue, "canonicalObservationValue");
function sameObservedValue(field, left, right) {
  return JSON.stringify(canonicalObservationValue(left, field)) === JSON.stringify(canonicalObservationValue(right, field));
}
__name(sameObservedValue, "sameObservedValue");
function assertCompatibleObservation(locator, existing, incoming, kind) {
  if (!existing || !incoming) return;
  const keys = /* @__PURE__ */ new Set([...Object.keys(existing), ...Object.keys(incoming)]);
  for (const key of keys) {
    const previous = existing[key];
    const next = incoming[key];
    if (previous === void 0 || next === void 0) continue;
    if (!sameObservedValue(key, previous, next)) {
      throw new Error(
        `Conflicting ${kind} observation for canonical identity ${locator}: field ${key} differs.`
      );
    }
  }
}
__name(assertCompatibleObservation, "assertCompatibleObservation");
function evidenceIdWithHash(runId, kind, locator, hashIdentity) {
  const normalizedRunId = boundedTrim(runId, 200, "runId");
  const normalizedKind = kind.trim().toLowerCase();
  if (!normalizedKind) throw new Error("Evidence kind is required and cannot be whitespace-only.");
  const normalizedLocator = boundedTrim(
    normalizeLocator(
      locator,
      normalizedKind === "link" || normalizedKind === "element" || normalizedKind === "target"
    ),
    MAX_LOCATOR_LENGTH,
    "locator"
  );
  return `ev_${hashIdentity(`${normalizedRunId}|${normalizedKind}|${normalizedLocator}`)}`;
}
__name(evidenceIdWithHash, "evidenceIdWithHash");
function buildRecord(runId, spec, hashIdentity) {
  const preserveFragment = spec.kind === "link";
  const normalizedLocator = boundedTrim(
    normalizeLocator(spec.locator, preserveFragment),
    MAX_LOCATOR_LENGTH,
    "Evidence locator"
  );
  const locator = boundedTrim(
    sanitizeEvidenceText(normalizedLocator),
    MAX_LOCATOR_LENGTH,
    "Evidence locator"
  );
  const pageUrl = spec.pageUrl ? boundedTrim(
    sanitizeEvidenceUrl(
      boundedTrim(spec.pageUrl, MAX_PAGE_URL_LENGTH, "Evidence pageUrl")
    ),
    MAX_PAGE_URL_LENGTH,
    "Evidence pageUrl"
  ) : void 0;
  const record2 = {
    id: evidenceIdWithHash(runId, spec.kind, locator, hashIdentity),
    runId,
    kind: spec.kind,
    locator,
    ...pageUrl ? { pageUrl } : {},
    ...spec.screenshotId ? { screenshotId: boundedTrim(spec.screenshotId, 200, "Evidence screenshotId") } : {},
    ...spec.viewport ? { viewport: spec.viewport } : {},
    observedAt: boundedTrim(spec.observedAt, 200, "Evidence observedAt"),
    payload: makePayload(spec.aliases, spec.fields)
  };
  return EvidenceRefSchema.parse(record2);
}
__name(buildRecord, "buildRecord");
function addEntry(entries, runId, spec, hashIdentity) {
  const record2 = buildRecord(runId, spec, hashIdentity);
  const existing = entries.get(record2.id);
  if (!existing) {
    entries.set(record2.id, {
      record: record2,
      aliases: new Set(uniqueStrings(spec.aliases)),
      identity: {
        runId: record2.runId,
        kind: record2.kind,
        locator: record2.locator
      },
      ...spec.observedFields ? { observedFields: { ...spec.observedFields } } : {}
    });
    return;
  }
  assertEvidenceIdCollisionFree(
    { id: existing.record.id, ...existing.identity },
    record2
  );
  if (spec.kind === "page" || spec.kind === "screenshot") {
    assertCompatibleObservation(
      record2.locator,
      existing.observedFields,
      spec.observedFields,
      spec.kind
    );
    if (!existing.observedFields && spec.observedFields) {
      existing.observedFields = { ...spec.observedFields };
    } else if (existing.observedFields && spec.observedFields) {
      for (const [key, value] of Object.entries(spec.observedFields)) {
        if (existing.observedFields[key] === void 0) existing.observedFields[key] = value;
      }
    }
  }
  for (const alias of spec.aliases) existing.aliases.add(alias.trim());
  addLegacyAliases(existing.record.payload, [...existing.aliases]);
  for (const [key, value] of Object.entries(spec.fields)) {
    if (existing.record.payload[key] !== void 0 || value === void 0) continue;
    const bounded3 = payloadValue(value);
    if (bounded3 !== void 0) existing.record.payload[key] = bounded3;
  }
  const existingFoundOn = existing.record.payload.foundOn;
  const newFoundOn = spec.fields.foundOn;
  if (typeof existingFoundOn === "string" && typeof newFoundOn === "string") {
    try {
      const left = JSON.parse(existingFoundOn);
      const right = JSON.parse(newFoundOn);
      if (Array.isArray(left) && Array.isArray(right)) {
        existing.record.payload.foundOn = jsonValue(
          [...left, ...right].filter((value) => typeof value === "string")
        );
      }
    } catch {
    }
  }
}
__name(addEntry, "addEntry");
function buildPageEntry(entries, runId, bundle, page, hashIdentity) {
  const aliases = pageAliases(page);
  const fields = {
    status: page.status,
    title: page.title,
    h1Count: page.h1s.length,
    headingCount: page.headings.length,
    textExcerpt: page.textExcerpt,
    wordCount: page.wordCount,
    formsCount: page.forms.length
  };
  if (page.metaDescription !== void 0) {
    fields.metaDescription = page.metaDescription;
  }
  if (page.structuredDataTypes !== void 0) {
    fields.structuredDataTypes = JSON.stringify(page.structuredDataTypes);
  }
  if (page.structuredDataPresent !== void 0) {
    fields.structuredDataPresent = page.structuredDataPresent;
  }
  if (page.images !== void 0) {
    fields.imageCount = page.images.length;
    fields.imagesWithoutAlt = page.images.filter((image) => image.alt === void 0).length;
  }
  addEntry(entries, runId, {
    kind: "page",
    locator: page.url,
    pageUrl: page.url,
    observedAt: bundle.capturedAt,
    aliases,
    fields,
    observedFields: pageObservationFields(page)
  }, hashIdentity);
}
__name(buildPageEntry, "buildPageEntry");
function buildLinkEntry(entries, runId, bundle, link, hashIdentity) {
  const href2 = boundedTrim(link.href, MAX_PAYLOAD_STRING_LENGTH, "link href");
  const pageUrl = firstPageUrl(link);
  const resolvedTarget = resolvedHttpTarget(href2, pageUrl, true);
  const variant = JSON.stringify({
    href: sanitizeEvidenceText(href2),
    label: sanitizeEvidenceText(link.label),
    ariaLabel: sanitizeEvidenceText(link.ariaLabel),
    title: sanitizeEvidenceText(link.title),
    scheme: sanitizeEvidenceText(link.scheme),
    inNav: link.inNav,
    inServiceNav: link.inServiceNav
  });
  const locator = boundedTrim(
    `${resolvedTarget ?? href2}|link-variant:${variant}`,
    MAX_LOCATOR_LENGTH,
    "link observation locator"
  );
  const aliases = [
    `target:${href2}`,
    `element:${href2}`,
    `link:${href2}`,
    ...resolvedTarget && resolvedTarget !== href2 ? [`target:${resolvedTarget}`, `element:${resolvedTarget}`, `link:${resolvedTarget}`] : []
  ];
  addEntry(entries, runId, {
    kind: "link",
    locator,
    pageUrl,
    observedAt: bundle.capturedAt,
    aliases,
    fields: {
      href: href2,
      label: link.label,
      ariaLabel: link.ariaLabel,
      title: link.title,
      scheme: link.scheme,
      inNav: link.inNav,
      inServiceNav: link.inServiceNav,
      foundOn: JSON.stringify(uniqueStrings(link.foundOn))
    }
  }, hashIdentity);
}
__name(buildLinkEntry, "buildLinkEntry");
function buildFormEntry(entries, runId, bundle, page, index, hashIdentity) {
  const action2 = page.forms[index]?.action ?? "";
  const resolvedTarget = resolvedHttpTarget(action2, page.url);
  const formRef = `form:${page.url}#${index}`;
  const aliases = [
    ...action2 ? [`element:${action2}`, `target:${action2}`] : [formRef],
    ...resolvedTarget && resolvedTarget !== action2.trim() ? [`element:${resolvedTarget}`, `target:${resolvedTarget}`] : [],
    formRef
  ];
  addEntry(entries, runId, {
    kind: "form",
    locator: formLocator(page.url, index, action2),
    pageUrl: page.url,
    observedAt: bundle.capturedAt,
    aliases,
    fields: {
      action: action2,
      method: page.forms[index]?.method ?? "GET",
      hasSubmit: page.forms[index]?.hasSubmit ?? false,
      submitLabel: page.forms[index]?.submitLabel ?? "",
      actionTargetState: page.forms[index]?.actionTargetState ?? "empty",
      formIndex: index
    }
  }, hashIdentity);
}
__name(buildFormEntry, "buildFormEntry");
function richLocator(pageUrl, family, key) {
  return `${family}|${normalizeLocator(pageUrl)}|${key.trim()}`;
}
__name(richLocator, "richLocator");
function richAliases(pageUrl, family, key) {
  const scoped = `${normalizeLocator(pageUrl)}#${key.trim()}`;
  return [`${family}:${scoped}`, `element:${scoped}`].sort(compareCodePoints);
}
__name(richAliases, "richAliases");
function buildRichPageEntries(entries, runId, bundle, page, hashIdentity) {
  for (const cta of page.ctas ?? []) {
    addEntry(entries, runId, {
      kind: "element",
      locator: richLocator(page.url, "cta", cta.elementKey),
      pageUrl: page.url,
      observedAt: bundle.capturedAt,
      aliases: richAliases(page.url, "cta", cta.elementKey),
      fields: {
        observationType: "cta",
        elementKey: cta.elementKey,
        href: cta.href,
        label: cta.label,
        accessibleName: cta.accessibleName,
        actionKind: cta.actionKind,
        sourceRegion: cta.sourceRegion,
        geometry: cta.geometry ? JSON.stringify(cta.geometry) : void 0
      }
    }, hashIdentity);
  }
  page.forms.forEach((form, formIndex) => {
    for (const field of form.fields ?? []) {
      addEntry(entries, runId, {
        kind: "element",
        locator: richLocator(page.url, `form-field:${formIndex}`, field.elementKey),
        pageUrl: page.url,
        observedAt: bundle.capturedAt,
        aliases: richAliases(page.url, "form-field", field.elementKey),
        fields: {
          observationType: "form-field",
          formIndex,
          elementKey: field.elementKey,
          controlType: field.controlType,
          name: field.name,
          required: field.required,
          autocomplete: field.autocomplete,
          label: field.label,
          accessibleName: field.accessibleName,
          labelSource: field.labelSource
        }
      }, hashIdentity);
    }
  });
  for (const landmark of page.landmarks ?? []) {
    addEntry(entries, runId, {
      kind: "element",
      locator: richLocator(page.url, "landmark", landmark.elementKey),
      pageUrl: page.url,
      observedAt: bundle.capturedAt,
      aliases: richAliases(page.url, "landmark", landmark.elementKey),
      fields: {
        observationType: "landmark",
        elementKey: landmark.elementKey,
        role: landmark.role,
        label: landmark.label
      }
    }, hashIdentity);
  }
  for (const section2 of page.sections ?? []) {
    addEntry(entries, runId, {
      kind: "element",
      locator: richLocator(page.url, "section", section2.elementKey),
      pageUrl: page.url,
      observedAt: bundle.capturedAt,
      aliases: richAliases(page.url, "section", section2.elementKey),
      fields: {
        observationType: "section",
        elementKey: section2.elementKey,
        sectionKind: section2.kind,
        heading: section2.heading,
        textExcerpt: section2.textExcerpt
      }
    }, hashIdentity);
  }
  for (const proof of page.proofSignals ?? []) {
    addEntry(entries, runId, {
      kind: "element",
      locator: richLocator(page.url, "proof", proof.sourceKey),
      pageUrl: page.url,
      observedAt: bundle.capturedAt,
      aliases: richAliases(page.url, "proof", proof.sourceKey),
      fields: {
        observationType: "proof",
        sourceKey: proof.sourceKey,
        proofKind: proof.kind,
        text: proof.text
      }
    }, hashIdentity);
  }
  for (const fact of page.contactFacts ?? []) {
    addEntry(entries, runId, {
      kind: "contact-fact",
      locator: richLocator(page.url, `contact:${fact.kind}`, fact.sourceKey),
      pageUrl: page.url,
      observedAt: bundle.capturedAt,
      aliases: [
        `contact-fact:${normalizeLocator(page.url)}#${fact.sourceKey}`,
        `contact:${fact.kind}:${normalizeLocator(page.url)}#${fact.sourceKey}:${fact.value}`
      ].sort(compareCodePoints),
      fields: {
        observationType: "contact-fact",
        sourceKey: fact.sourceKey,
        factKind: fact.kind,
        value: fact.value
      }
    }, hashIdentity);
  }
  for (const fact of page.datedFacts ?? []) {
    addEntry(entries, runId, {
      kind: "element",
      locator: richLocator(page.url, `date:${fact.kind}`, fact.sourceKey),
      pageUrl: page.url,
      observedAt: bundle.capturedAt,
      aliases: [
        `date-fact:${normalizeLocator(page.url)}#${fact.sourceKey}`,
        `date:${fact.kind}:${normalizeLocator(page.url)}#${fact.sourceKey}:${fact.value}`
      ].sort(compareCodePoints),
      fields: {
        observationType: "date-fact",
        sourceKey: fact.sourceKey,
        dateKind: fact.kind,
        value: fact.value
      }
    }, hashIdentity);
  }
  for (const observation of page.accessibility ?? []) {
    addEntry(entries, runId, {
      kind: "accessibility",
      locator: richLocator(page.url, `accessibility:${observation.issue}`, observation.elementKey),
      pageUrl: page.url,
      observedAt: bundle.capturedAt,
      aliases: [
        `a11y:${normalizeLocator(page.url)}#${observation.elementKey}:${observation.issue}`,
        `accessibility:${normalizeLocator(page.url)}#${observation.elementKey}:${observation.issue}`
      ].sort(compareCodePoints),
      fields: {
        observationType: "accessibility",
        elementKey: observation.elementKey,
        issue: observation.issue,
        source: observation.source,
        detail: observation.detail
      }
    }, hashIdentity);
  }
}
__name(buildRichPageEntries, "buildRichPageEntries");
function buildNavEntry(entries, runId, bundle, label, hashIdentity) {
  const value = label.trim();
  if (!value) return;
  addEntry(entries, runId, {
    kind: "link",
    locator: `nav:${value}`,
    observedAt: bundle.capturedAt,
    aliases: [`nav:${value}`, `link:nav:${value}`],
    fields: { label: value, inNav: true }
  }, hashIdentity);
}
__name(buildNavEntry, "buildNavEntry");
function buildScreenshotEntry(entries, runId, bundle, screenshot, hashIdentity) {
  const capturedAt2 = boundedTrim(screenshot.capturedAt, 200, "screenshot capturedAt");
  addEntry(entries, runId, {
    kind: "screenshot",
    locator: screenshot.id,
    pageUrl: screenshot.pageUrl,
    screenshotId: screenshot.id,
    viewport: screenshot.viewport,
    observedAt: capturedAt2,
    aliases: [`visual:${screenshot.id}`],
    fields: {
      label: screenshot.label,
      width: screenshot.width,
      height: screenshot.height
    },
    observedFields: {
      pageUrl: screenshot.pageUrl,
      viewport: screenshot.viewport,
      capturedAt: capturedAt2,
      label: screenshot.label,
      width: screenshot.width,
      height: screenshot.height
    }
  }, hashIdentity);
}
__name(buildScreenshotEntry, "buildScreenshotEntry");
function buildNetworkEntry(entries, runId, bundle, event, hashIdentity) {
  const url = boundedTrim(event.url, MAX_PAYLOAD_STRING_LENGTH, "network event URL");
  const normalizedUrl3 = normalizeLocator(url);
  const locator = JSON.stringify({
    url: normalizedUrl3,
    stage: event.stage ?? null,
    code: event.code ?? null,
    outcome: event.outcome,
    status: event.status ?? null,
    reason: event.reason,
    redirects: event.redirects ?? null
  });
  const aliases = [
    `target:${url}`,
    `probe:${url}`,
    ...event.status !== void 0 ? [`status:${event.status}`] : [],
    ...normalizedUrl3 !== url ? [`target:${normalizedUrl3}`, `probe:${normalizedUrl3}`] : []
  ];
  addEntry(entries, runId, {
    kind: "probe",
    locator,
    pageUrl: canonicalUrl(url) ? url : void 0,
    observedAt: bundle.capturedAt,
    aliases,
    fields: {
      url,
      outcome: event.outcome,
      reason: event.reason,
      code: event.code,
      stage: event.stage,
      status: event.status,
      redirects: event.redirects
    }
  }, hashIdentity);
}
__name(buildNetworkEntry, "buildNetworkEntry");
function compactAlias(prefix, locator) {
  return `${prefix}:${fnv1a642(locator)}`;
}
__name(compactAlias, "compactAlias");
function resourceFailureLocator(failure) {
  return JSON.stringify({
    pageUrl: normalizeLocator(sanitizeEvidenceUrl(failure.pageUrl)),
    url: normalizeLocator(sanitizeEvidenceUrl(failure.url), true),
    resourceType: sanitizeEvidenceText(failure.resourceType),
    status: failure.status ?? null,
    reason: sanitizeEvidenceText(failure.reason),
    source: sanitizeEvidenceText(failure.source)
  });
}
__name(resourceFailureLocator, "resourceFailureLocator");
function resourceFailureEvidenceAlias(failure) {
  return compactAlias("resource-failure", resourceFailureLocator(failure));
}
__name(resourceFailureEvidenceAlias, "resourceFailureEvidenceAlias");
function consoleErrorLocator(error3) {
  return JSON.stringify({
    pageUrl: normalizeLocator(sanitizeEvidenceUrl(error3.pageUrl)),
    level: sanitizeEvidenceText(error3.level),
    message: sanitizeEvidenceText(error3.message),
    sourceUrl: error3.sourceUrl ? normalizeLocator(sanitizeEvidenceUrl(error3.sourceUrl), true) : null,
    lineNumber: error3.lineNumber ?? null,
    columnNumber: error3.columnNumber ?? null
  });
}
__name(consoleErrorLocator, "consoleErrorLocator");
function consoleErrorEvidenceAlias(error3) {
  return compactAlias("console-error", consoleErrorLocator(error3));
}
__name(consoleErrorEvidenceAlias, "consoleErrorEvidenceAlias");
function performanceLocator(observation) {
  return JSON.stringify({
    pageUrl: normalizeLocator(observation.pageUrl),
    source: observation.source,
    status: observation.status ?? null,
    responseTimeMs: observation.responseTimeMs,
    transferSizeBytes: observation.transferSizeBytes
  });
}
__name(performanceLocator, "performanceLocator");
function performanceEvidenceAlias(observation) {
  return compactAlias("performance", performanceLocator(observation));
}
__name(performanceEvidenceAlias, "performanceEvidenceAlias");
function buildResourceFailureEntry(entries, runId, bundle, failure, hashIdentity) {
  const locator = resourceFailureLocator(failure);
  addEntry(entries, runId, {
    kind: "probe",
    locator,
    pageUrl: sanitizeEvidenceUrl(failure.pageUrl),
    observedAt: failure.observedAt ?? bundle.capturedAt,
    aliases: [resourceFailureEvidenceAlias(failure)],
    fields: {
      observationType: "resource-failure",
      url: sanitizeEvidenceUrl(failure.url),
      resourceType: sanitizeEvidenceText(failure.resourceType),
      status: failure.status,
      reason: sanitizeEvidenceText(failure.reason),
      source: sanitizeEvidenceText(failure.source)
    }
  }, hashIdentity);
}
__name(buildResourceFailureEntry, "buildResourceFailureEntry");
function buildConsoleErrorEntry(entries, runId, bundle, error3, hashIdentity) {
  const locator = consoleErrorLocator(error3);
  addEntry(entries, runId, {
    kind: "probe",
    locator,
    pageUrl: sanitizeEvidenceUrl(error3.pageUrl),
    observedAt: error3.observedAt ?? bundle.capturedAt,
    aliases: [consoleErrorEvidenceAlias(error3)],
    fields: {
      observationType: "console-error",
      level: sanitizeEvidenceText(error3.level),
      message: sanitizeEvidenceText(error3.message),
      source: sanitizeEvidenceText(error3.source),
      sourceUrl: error3.sourceUrl ? sanitizeEvidenceUrl(error3.sourceUrl) : void 0,
      lineNumber: error3.lineNumber,
      columnNumber: error3.columnNumber
    }
  }, hashIdentity);
}
__name(buildConsoleErrorEntry, "buildConsoleErrorEntry");
function buildPerformanceEntry(entries, runId, bundle, observation, hashIdentity) {
  const locator = performanceLocator(observation);
  addEntry(entries, runId, {
    kind: "performance",
    locator,
    pageUrl: observation.pageUrl,
    observedAt: observation.observedAt ?? bundle.capturedAt,
    aliases: [performanceEvidenceAlias(observation)],
    fields: {
      observationType: "performance",
      source: observation.source,
      status: observation.status,
      responseTimeMs: observation.responseTimeMs,
      transferSizeBytes: observation.transferSizeBytes
    }
  }, hashIdentity);
}
__name(buildPerformanceEntry, "buildPerformanceEntry");
function buildRenderedEntries(entries, runId, page, hashIdentity) {
  if (page.runId !== runId) {
    throw new Error(
      `Rendered evidence runId ${page.runId} does not match analysis run ${runId}.`
    );
  }
  const pageLocator = `rendered-page|${page.screenshotId}`;
  addEntry(entries, runId, {
    kind: "element",
    locator: pageLocator,
    pageUrl: page.pageUrl,
    screenshotId: page.screenshotId,
    viewport: page.viewport,
    observedAt: page.capturedAt,
    aliases: [`rendered-page:${page.screenshotId}`],
    fields: {
      observationType: "rendered-page",
      source: page.source,
      width: page.width,
      height: page.height,
      elementCount: page.elements.length
    }
  }, hashIdentity);
  for (const element of page.elements) {
    const locator = `rendered-element|${page.screenshotId}|${element.elementKey}`;
    addEntry(entries, runId, {
      kind: "element",
      locator,
      pageUrl: element.pageUrl,
      screenshotId: element.screenshotId,
      viewport: element.viewport,
      observedAt: page.capturedAt,
      aliases: [`rendered-element:${page.screenshotId}#${element.elementKey}`],
      fields: {
        observationType: "rendered-element",
        elementKey: element.elementKey,
        elementKind: element.kind,
        geometry: JSON.stringify(element.geometry),
        label: element.label,
        accessibleName: element.accessibleName,
        labelState: element.labelState,
        source: element.source,
        viewportWidth: element.viewportWidth,
        viewportHeight: element.viewportHeight
      }
    }, hashIdentity);
    if (element.labelState === "missing" || element.labelState === "empty") {
      const accessibilityLocator = `rendered-accessibility|${page.screenshotId}|${element.elementKey}|${element.labelState}`;
      addEntry(entries, runId, {
        kind: "accessibility",
        locator: accessibilityLocator,
        pageUrl: element.pageUrl,
        screenshotId: element.screenshotId,
        viewport: element.viewport,
        observedAt: page.capturedAt,
        aliases: [compactAlias("rendered-accessibility", accessibilityLocator)],
        fields: {
          observationType: "rendered-accessibility",
          elementKey: element.elementKey,
          elementKind: element.kind,
          labelState: element.labelState,
          source: element.source
        }
      }, hashIdentity);
    }
  }
}
__name(buildRenderedEntries, "buildRenderedEntries");
function buildEvidenceLedgerInternal({
  runId: rawRunId,
  bundle
}, hashIdentity) {
  const runId = boundedTrim(rawRunId, 200, "runId");
  boundedTrim(bundle.capturedAt, 200, "capturedAt");
  const entries = /* @__PURE__ */ new Map();
  for (const page of bundle.site.pages) {
    buildPageEntry(entries, runId, bundle, page, hashIdentity);
    page.forms.forEach(
      (_form, index) => buildFormEntry(entries, runId, bundle, page, index, hashIdentity)
    );
    buildRichPageEntries(entries, runId, bundle, page, hashIdentity);
  }
  for (const link of bundle.site.links) {
    buildLinkEntry(entries, runId, bundle, link, hashIdentity);
  }
  for (const label of bundle.site.nav) {
    buildNavEntry(entries, runId, bundle, label, hashIdentity);
  }
  for (const screenshot of bundle.visualReview?.screenshots ?? []) {
    buildScreenshotEntry(entries, runId, bundle, screenshot, hashIdentity);
  }
  for (const event of bundle.networkEvents) {
    buildNetworkEntry(entries, runId, bundle, event, hashIdentity);
  }
  for (const failure of bundle.resourceFailures ?? []) {
    buildResourceFailureEntry(entries, runId, bundle, failure, hashIdentity);
  }
  for (const error3 of bundle.consoleErrors ?? []) {
    buildConsoleErrorEntry(entries, runId, bundle, error3, hashIdentity);
  }
  for (const observation of bundle.performanceObservations ?? []) {
    buildPerformanceEntry(entries, runId, bundle, observation, hashIdentity);
  }
  for (const renderedPage of bundle.renderedPages ?? []) {
    buildRenderedEntries(entries, runId, renderedPage, hashIdentity);
  }
  if (entries.size > MAX_LEDGER_ENTRIES) {
    throw new Error(`Evidence ledger exceeds the maximum of ${MAX_LEDGER_ENTRIES} entries.`);
  }
  return [...entries.values()].sort(
    (left, right) => kindOrder(left.record.kind) - kindOrder(right.record.kind) || compareCodePoints(left.record.locator, right.record.locator) || compareCodePoints(left.record.id, right.record.id)
  ).map(({ record: record2 }) => EvidenceRefSchema.parse(record2));
}
__name(buildEvidenceLedgerInternal, "buildEvidenceLedgerInternal");
function buildEvidenceLedger(input) {
  return buildEvidenceLedgerInternal(input, fnv1a642);
}
__name(buildEvidenceLedger, "buildEvidenceLedger");
var EVIDENCE_ALIAS_CACHE = /* @__PURE__ */ new WeakMap();
function aliasesFor(record2) {
  const cached3 = EVIDENCE_ALIAS_CACHE.get(record2);
  if (cached3) return cached3;
  const aliases = [record2.payload.legacyRef];
  const additional = record2.payload.legacyRefs;
  if (typeof additional === "string") {
    try {
      const parsed = JSON.parse(additional);
      if (Array.isArray(parsed)) {
        aliases.push(...parsed.filter((value) => typeof value === "string"));
      }
    } catch {
    }
  }
  const resolved = uniqueStrings(
    aliases.filter((value) => typeof value === "string")
  );
  EVIDENCE_ALIAS_CACHE.set(record2, resolved);
  return resolved;
}
__name(aliasesFor, "aliasesFor");
function matchingKindOrder(kind) {
  switch (kind) {
    case "target":
      return ["probe", "form", "link"];
    case "element":
      return ["form", "link"];
    case "status":
      return ["probe"];
    case "verified":
    case "considered":
    case "page":
      return ["page"];
    case "visual":
      return ["screenshot"];
    case "nav":
      return ["link"];
    case "link":
      return ["link"];
    case "form":
      return ["form"];
    case "probe":
      return ["probe"];
    default:
      return [];
  }
}
__name(matchingKindOrder, "matchingKindOrder");
function semanticMatches(record2, parsed) {
  const value = parsed.value.trim();
  if (!value) return false;
  const preserveFragment = parsed.kind === "link" || parsed.kind === "element" || parsed.kind === "target";
  const normalized3 = normalizeLocator(value, preserveFragment);
  const locatorMatches = record2.locator === normalized3;
  switch (parsed.kind) {
    case "page":
    case "verified":
    case "considered":
      return record2.kind === "page" && locatorMatches;
    case "visual":
      return record2.kind === "screenshot" && (record2.screenshotId === value || record2.locator === value);
    case "status":
      return record2.kind === "probe" && String(record2.payload.status ?? "") === value;
    case "nav":
      return record2.kind === "link" && record2.payload.inNav === true && record2.payload.label === value;
    case "target":
    case "element":
    case "link":
    case "form":
    case "probe":
      return matchingKindOrder(parsed.kind).includes(record2.kind) && (locatorMatches || aliasesFor(record2).includes(parsed.kind + ":" + value));
    default:
      return aliasesFor(record2).includes(`${parsed.kind}:${value}`);
  }
}
__name(semanticMatches, "semanticMatches");
function preferredMatches(records, parsed) {
  const kinds = matchingKindOrder(parsed.kind);
  if (kinds.length === 0) return [];
  for (const kind of kinds) {
    const matching = records.filter((record2) => record2.kind === kind && semanticMatches(record2, parsed));
    if (matching.length > 0) return matching;
  }
  return [];
}
__name(preferredMatches, "preferredMatches");
function resolveLegacyEvidenceRefs(ledger, legacyRefs) {
  const records = ledger.map((record2) => EvidenceRefSchema.parse(record2));
  const ids = [];
  const unresolved = [];
  const seenIds = /* @__PURE__ */ new Set();
  const seenUnresolved = /* @__PURE__ */ new Set();
  for (const raw of legacyRefs) {
    const ref = raw.trim();
    if (!ref) {
      if (!seenUnresolved.has(ref)) {
        seenUnresolved.add(ref);
        unresolved.push(ref);
      }
      continue;
    }
    const exact = records.filter(
      (record3) => record3.id === ref || aliasesFor(record3).includes(ref)
    );
    const parsed = parseEvidenceRef(ref);
    const matching = preferredMatches(records, parsed);
    const candidates = matching.length > 0 ? matching : exact;
    if (candidates.length !== 1) {
      if (!seenUnresolved.has(ref)) {
        seenUnresolved.add(ref);
        unresolved.push(ref);
      }
      continue;
    }
    const record2 = candidates[0];
    if (!record2 || seenIds.has(record2.id)) continue;
    seenIds.add(record2.id);
    ids.push(record2.id);
  }
  return { ids, unresolved };
}
__name(resolveLegacyEvidenceRefs, "resolveLegacyEvidenceRefs");
