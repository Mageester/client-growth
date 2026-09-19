import {
  EvidenceRefSchema,
  type EvidenceRef,
} from "@/core/insightSchema";
import type {
  EvidenceBundle,
  EvidenceLink,
  EvidencePage,
} from "@/core/schema";
import { parseEvidenceRef } from "@/core/evidenceRef";
import { crawlKey } from "@/adapters/evidence/urlPolicy";
import { isCredentialQueryKey } from "@/core/visualSchema";

export const MAX_LOCATOR_LENGTH = 5_000;
export const MAX_PAGE_URL_LENGTH = 2_000;
export const MAX_PAYLOAD_STRING_LENGTH = 4_000;
export const MAX_LEDGER_ENTRIES = 10_000;

export function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function boundedTrim(value: string, maxLength: number, label: string): string {
  if (value.length > maxLength) throw new Error(`${label} cannot be represented losslessly within ${maxLength} characters.`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required and cannot be whitespace-only.`);
  return trimmed;
}

export function canonicalUrl(value: string, preserveFragment = false): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const key = crawlKey(url);
    return preserveFragment && url.hash ? `${key}${url.hash}` : key;
  } catch { return null; }
}
export function normalizeLocator(value: string, preserveFragment = false): string { const trimmed = value.trim(); return canonicalUrl(trimmed, preserveFragment) ?? trimmed; }

const CREDENTIAL_LABEL = /\b(authorization|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|pass|api[-_]?key|auth|credential|bearer|basic|key|signature|sig)\b/i;
const MAX_REDACTION_DECODE_PASSES = 6;
const MAX_NESTED_URL_DEPTH = 5;
function boundedDecode(value: string, passes = MAX_REDACTION_DECODE_PASSES): string { let decoded = value; for (let index = 0; index < passes; index += 1) { const next = decoded.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))); if (next === decoded) break; decoded = next; } return decoded; }
function sanitizeCredentialPathSegments(value: string): string { return value.replace(new RegExp(`(^|[/#])(${CREDENTIAL_LABEL.source})(?:/|%[0-9a-f]{0,2}/)([^/?#&\\s]+)`, "gi"), (_match, prefix, label) => `${prefix}${label}/[redacted]`); }
function sanitizeCredentialText(value: string): string {
  return value.replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{3,}/gi, (scheme) => `${scheme.split(/\s+/)[0]} [redacted]`).replace(new RegExp(`${CREDENTIAL_LABEL.source}(?:\\s*[:=]\\s*|\\s+)[^\\s,;]+`, "gi"), (match) => { const key = CREDENTIAL_LABEL.exec(match)?.[1] ?? match; CREDENTIAL_LABEL.lastIndex = 0; return `${key}=[redacted]`; }).replace(/([?&\s])([^?&=\s]+)=([^&\s]+)/gi, (match, prefix, key) => isCredentialQueryKey(key) ? `${prefix}${key}=[redacted]` : match);
}
function sanitizedUrlComponent(value: string): string { const raw = sanitizeCredentialPathSegments(sanitizeCredentialText(value)); const decoded = boundedDecode(value); const redactedDecoded = sanitizeCredentialPathSegments(sanitizeCredentialText(decoded)); return redactedDecoded !== decoded ? redactedDecoded : raw; }
function urlComponentHasCredential(value: string): boolean { return sanitizedUrlComponent(value) !== value; }
function urlHasCredential(value: string, depth: number): boolean {
  if (urlComponentHasCredential(value)) return true;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return true;
    for (const key of parsed.searchParams.keys()) if (isCredentialQueryKey(key)) return true;
    for (const queryValue of parsed.searchParams.values()) { const decoded = boundedDecode(queryValue); if (urlComponentHasCredential(decoded)) return true; if (depth < MAX_NESTED_URL_DEPTH && /^https?:\/\//i.test(decoded.trim()) && urlHasCredential(decoded, depth + 1)) return true; }
  } catch { return false; }
  return false;
}
function nestedQueryValue(value: string, depth: number): string { const decoded = boundedDecode(value); if (depth < MAX_NESTED_URL_DEPTH && /^https?:\/\//i.test(decoded.trim()) && urlHasCredential(decoded, depth + 1)) return sanitizeEvidenceUrlInternal(decoded, depth + 1); return sanitizeCredentialText(value); }
function sanitizeEvidenceUrlInternal(value: string, depth: number): string {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.username = "";
    parsed.password = "";
    const pathname = sanitizedUrlComponent(parsed.pathname); if (pathname !== parsed.pathname) parsed.pathname = pathname;
    const hash = sanitizedUrlComponent(parsed.hash); if (hash !== parsed.hash) parsed.hash = hash;
    for (const key of [...parsed.searchParams.keys()]) {
      if (isCredentialQueryKey(key)) { parsed.searchParams.set(key, "[redacted]"); continue; }
      const current = parsed.searchParams.get(key) ?? "";
      const sanitized = nestedQueryValue(current, depth);
      if (sanitized !== current) parsed.searchParams.set(key, sanitized);
    }
    return parsed.toString().replace(/%5Bredacted%5D/gi, "[redacted]");
  } catch { return sanitizeCredentialText(trimmed); }
}
export function sanitizeEvidenceUrl(value: string): string { return sanitizeEvidenceUrlInternal(value, 0); }
export function sanitizeEvidenceText(value: string): string { const redacted = sanitizeCredentialText(value); return redacted.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeEvidenceUrl(url)); }
function uniqueStrings(values: readonly string[]): string[] { const seen = new Set<string>(); const result: string[] = []; for (const value of values) { const trimmed = sanitizeEvidenceText(value).trim(); if (!trimmed || seen.has(trimmed)) continue; seen.add(trimmed); result.push(trimmed); } return result; }
function jsonValue(value: readonly string[]): string { const json = JSON.stringify(uniqueStrings(value)); if (json.length > MAX_PAYLOAD_STRING_LENGTH) throw new Error(`Evidence legacyRefs cannot be represented losslessly within ${MAX_PAYLOAD_STRING_LENGTH} characters.`); return json; }
function payloadValue(value: unknown, label = "Evidence payload value"): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") { const sanitized = sanitizeEvidenceText(value); if (sanitized.length > MAX_PAYLOAD_STRING_LENGTH) throw new Error(`${label} cannot be represented losslessly within ${MAX_PAYLOAD_STRING_LENGTH} characters.`); return sanitized; }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  return undefined;
}
function makePayload(aliases: readonly string[], fields: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const refs = uniqueStrings(aliases); if (refs.length === 0) throw new Error("Evidence ledger entry requires an observed legacy reference.");
  const payload: Record<string, string | number | boolean | null> = { legacyRef: payloadValue(refs[0], "Evidence legacyRef") as string };
  if (refs.length > 1) payload.legacyRefs = jsonValue(refs);
  for (const [key, value] of Object.entries(fields)) { if (key === "legacyRef" || key === "legacyRefs" || value === undefined) continue; const bounded = payloadValue(value, `Evidence payload field "${key}"`); if (bounded !== undefined) payload[key] = bounded; }
  return payload;
}
function resolvedHttpTarget(raw: string, pageUrl?: string, preserveFragment = false): string | null { try { const url = pageUrl ? new URL(raw, pageUrl) : new URL(raw); if (url.protocol !== "http:" && url.protocol !== "https:") return null; return canonicalUrl(url.toString(), preserveFragment); } catch { return null; } }
function firstPageUrl(link: EvidenceLink): string | undefined { const first = link.foundOn.find((url) => url.trim().length > 0); return first ? boundedTrim(first, MAX_PAGE_URL_LENGTH, "link foundOn URL") : undefined; }
function formLocator(pageUrl: string, index: number, action: string): string { const page = normalizeLocator(pageUrl); const target = resolvedHttpTarget(action, pageUrl, true) ?? action.trim(); return `form|${page}|${index}|${target}`; }
function pageAliases(page: EvidencePage): string[] { const aliases = [`page:${page.url}`, page.url]; if (page.title.trim() === "") aliases.push("title:missing"); if (page.h1s.length === 0) aliases.push("h1:missing"); if (page.metaDescription !== undefined && page.metaDescription.trim() === "") aliases.push("meta-description:missing"); if (page.structuredDataTypes !== undefined && (page.structuredDataPresent ?? page.structuredDataTypes.length > 0) === false) aliases.push("structured-data:localbusiness-or-service-missing"); if (page.images !== undefined) { const missingAlt = page.images.filter((image) => image.alt === undefined).length; if (missingAlt > 0) { aliases.push(`images-without-alt:${missingAlt}`); aliases.push(`images-without-alt:${missingAlt}`); } } aliases.push(`word-count:${page.wordCount}`); return aliases; }

type Payload = Record<string, string | number | boolean | null>;
interface EntrySpec { kind: EvidenceRef["kind"]; locator: string; pageUrl?: string; screenshotId?: string; viewport?: "desktop" | "mobile"; observedAt: string; aliases: string[]; fields: Record<string, unknown>; observedFields?: Record<string, unknown>; }
interface EntryState { record: EvidenceRef; aliases: Set<string>; observedFields?: Record<string, unknown>; }
function compareCodePoints(left: string, right: string): number { const lp = Array.from(left, (c) => c.codePointAt(0) ?? 0); const rp = Array.from(right, (c) => c.codePointAt(0) ?? 0); for (let i = 0; i < Math.min(lp.length, rp.length); i += 1) { if (lp[i]! < rp[i]!) return -1; if (lp[i]! > rp[i]!) return 1; } return lp.length - rp.length; }
function evidenceIdWithHash(runId: string, kind: string, locator: string, hashIdentity: (value: string) => string): string { const normalizedRunId = boundedTrim(runId, 200, "runId"); const normalizedKind = kind.trim().toLowerCase(); const normalizedLocator = boundedTrim(normalizeLocator(locator, normalizedKind === "link" || normalizedKind === "element"), MAX_LOCATOR_LENGTH, "locator"); return `ev_${hashIdentity(`${normalizedRunId}|${normalizedKind}|${normalizedLocator}`)}`; }
function buildRecord(runId: string, spec: EntrySpec, hashIdentity: (value: string) => string): EvidenceRef { const preserveFragment = spec.kind === "link"; const locator = boundedTrim(sanitizeEvidenceText(normalizeLocator(spec.locator, preserveFragment)), MAX_LOCATOR_LENGTH, "Evidence locator"); const pageUrl = spec.pageUrl ? boundedTrim(sanitizeEvidenceUrl(boundedTrim(spec.pageUrl, MAX_PAGE_URL_LENGTH, "Evidence pageUrl")), MAX_PAGE_URL_LENGTH, "Evidence pageUrl") : undefined; return EvidenceRefSchema.parse({ id: evidenceIdWithHash(runId, spec.kind, locator, hashIdentity), runId, kind: spec.kind, locator, ...(pageUrl ? { pageUrl } : {}), ...(spec.screenshotId ? { screenshotId: boundedTrim(spec.screenshotId, 200, "Evidence screenshotId") } : {}), ...(spec.viewport ? { viewport: spec.viewport } : {}), observedAt: boundedTrim(spec.observedAt, 200, "Evidence observedAt"), payload: makePayload(spec.aliases, spec.fields) }); }
function addEntry(entries: Map<string, EntryState>, runId: string, spec: EntrySpec, hashIdentity: (value: string) => string): void { const record = buildRecord(runId, spec, hashIdentity); const existing = entries.get(record.id); if (!existing) { entries.set(record.id, { record, aliases: new Set(uniqueStrings(spec.aliases)), ...(spec.observedFields ? { observedFields: { ...spec.observedFields } } : {}) }); return; } if (existing.record.runId !== record.runId || existing.record.kind !== record.kind || existing.record.locator !== record.locator) throw new Error(`Evidence ID collision for ${record.id}.`); for (const alias of spec.aliases) existing.aliases.add(alias.trim()); const payload = existing.record.payload as Payload; payload.legacyRefs = jsonValue([...existing.aliases]); for (const [key, value] of Object.entries(spec.fields)) { if (payload[key] !== undefined || value === undefined) continue; const bounded = payloadValue(value); if (bounded !== undefined) payload[key] = bounded; } }
function pageObservationFields(page: EvidencePage): Record<string, unknown> { return { status: page.status, title: page.title, h1s: page.h1s, headings: page.headings, textExcerpt: page.textExcerpt, wordCount: page.wordCount, forms: page.forms, ...(page.metaDescription !== undefined ? { metaDescription: page.metaDescription } : {}), ...(page.structuredDataTypes !== undefined ? { structuredDataTypes: page.structuredDataTypes } : {}), ...(page.structuredDataPresent !== undefined ? { structuredDataPresent: page.structuredDataPresent } : {}), ...(page.images !== undefined ? { images: page.images } : {}) }; }

function buildPageEntry(entries: Map<string, EntryState>, runId: string, bundle: EvidenceBundle, page: EvidencePage, hashIdentity: (value: string) => string): void { addEntry(entries, runId, { kind: "page", locator: page.url, pageUrl: page.url, observedAt: bundle.capturedAt, aliases: pageAliases(page), fields: { status: page.status, title: page.title, h1Count: page.h1s.length, headingCount: page.headings.length, textExcerpt: page.textExcerpt, wordCount: page.wordCount, formsCount: page.forms.length, ...(page.metaDescription !== undefined ? { metaDescription: page.metaDescription } : {}), ...(page.structuredDataTypes !== undefined ? { structuredDataTypes: JSON.stringify(page.structuredDataTypes) } : {}), ...(page.structuredDataPresent !== undefined ? { structuredDataPresent: page.structuredDataPresent } : {}), ...(page.images !== undefined ? { imageCount: page.images.length, imagesWithoutAlt: page.images.filter((image) => image.alt === undefined).length } : {}) }, observedFields: pageObservationFields(page) }, hashIdentity); }
function buildLinkEntry(entries: Map<string, EntryState>, runId: string, bundle: EvidenceBundle, link: EvidenceLink, hashIdentity: (value: string) => string): void { const href = boundedTrim(link.href, MAX_PAYLOAD_STRING_LENGTH, "link href"); const pageUrl = firstPageUrl(link); const target = resolvedHttpTarget(href, pageUrl, true); const variant = JSON.stringify({ href, label: link.label, ariaLabel: link.ariaLabel, title: link.title, scheme: link.scheme, inNav: link.inNav, inServiceNav: link.inServiceNav }); addEntry(entries, runId, { kind: "link", locator: `${target ?? href}|link-variant:${variant}`, pageUrl, observedAt: bundle.capturedAt, aliases: [`target:${href}`, `element:${href}`, `link:${href}`, ...(target && target !== href ? [`target:${target}`, `element:${target}`, `link:${target}`] : [])], fields: { href, label: link.label, ariaLabel: link.ariaLabel, title: link.title, scheme: link.scheme, inNav: link.inNav, inServiceNav: link.inServiceNav, foundOn: JSON.stringify(uniqueStrings(link.foundOn)) } }, hashIdentity); }
function buildFormEntry(entries: Map<string, EntryState>, runId: string, bundle: EvidenceBundle, page: EvidencePage, index: number, hashIdentity: (value: string) => string): void { const form = page.forms[index]; if (!form) return; const action = form.action ?? ""; const target = resolvedHttpTarget(action, page.url); const formRef = `form:${page.url}#${index}`; addEntry(entries, runId, { kind: "form", locator: formLocator(page.url, index, action), pageUrl: page.url, observedAt: bundle.capturedAt, aliases: [...(action ? [`element:${action}`, `target:${action}`] : [formRef]), ...(target && target !== action.trim() ? [`element:${target}`, `target:${target}`] : []), formRef], fields: { action, method: form.method ?? "GET", hasSubmit: form.hasSubmit ?? false, formIndex: index } }, hashIdentity); }
function compactAlias(prefix: string, locator: string): string { return `${prefix}:${fnv1a64(locator)}`; }
function richLocator(pageUrl: string, family: string, key: string): string { return `${family}|${normalizeLocator(pageUrl)}|${key.trim()}`; }
function richAliases(pageUrl: string, family: string, key: string): string[] { const scoped = `${normalizeLocator(pageUrl)}#${key.trim()}`; return [`${family}:${scoped}`, `element:${scoped}`]; }
function pageRecords(page: EvidencePage, key: string): Array<Record<string, unknown>> { const value = (page as unknown as Record<string, unknown>)[key]; return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : []; }
function stringField(record: Record<string, unknown>, key: string, fallback = ""): string { return typeof record[key] === "string" ? record[key] as string : fallback; }
function jsonField(value: unknown): string | undefined { return value && typeof value === "object" ? JSON.stringify(value) : undefined; }
function buildRichPageEntries(entries: Map<string, EntryState>, runId: string, bundle: EvidenceBundle, page: EvidencePage, hashIdentity: (value: string) => string): void {
  for (const cta of pageRecords(page, "ctas")) {
    const elementKey = stringField(cta, "elementKey", "unknown");
    addEntry(entries, runId, { kind: "element", locator: richLocator(page.url, "cta", elementKey), pageUrl: page.url, observedAt: bundle.capturedAt, aliases: richAliases(page.url, "cta", elementKey), fields: { observationType: "cta", elementKey, href: cta.href, label: cta.label, accessibleName: cta.accessibleName, actionKind: cta.actionKind, sourceRegion: cta.sourceRegion, geometry: jsonField(cta.geometry) } }, hashIdentity);
  }
  page.forms.forEach((form, formIndex) => {
    for (const field of pageRecords(form as unknown as EvidencePage, "fields")) {
      const elementKey = stringField(field, "elementKey", "unknown");
      addEntry(entries, runId, { kind: "element", locator: richLocator(page.url, `form-field:${formIndex}`, elementKey), pageUrl: page.url, observedAt: bundle.capturedAt, aliases: richAliases(page.url, "form-field", elementKey), fields: { observationType: "form-field", formIndex, elementKey, controlType: field.controlType, name: field.name, required: field.required, autocomplete: field.autocomplete, label: field.label, accessibleName: field.accessibleName, labelSource: field.labelSource } }, hashIdentity);
    }
  });
  for (const landmark of pageRecords(page, "landmarks")) {
    const elementKey = stringField(landmark, "elementKey", "unknown");
    addEntry(entries, runId, { kind: "element", locator: richLocator(page.url, "landmark", elementKey), pageUrl: page.url, observedAt: bundle.capturedAt, aliases: richAliases(page.url, "landmark", elementKey), fields: { observationType: "landmark", elementKey, role: landmark.role, label: landmark.label } }, hashIdentity);
  }
  for (const section of pageRecords(page, "sections")) {
    const elementKey = stringField(section, "elementKey", "unknown");
    addEntry(entries, runId, { kind: "element", locator: richLocator(page.url, "section", elementKey), pageUrl: page.url, observedAt: bundle.capturedAt, aliases: richAliases(page.url, "section", elementKey), fields: { observationType: "section", elementKey, sectionKind: section.kind, heading: section.heading, textExcerpt: section.textExcerpt } }, hashIdentity);
  }
  for (const proof of pageRecords(page, "proofSignals")) {
    const sourceKey = stringField(proof, "sourceKey", "unknown");
    addEntry(entries, runId, { kind: "element", locator: richLocator(page.url, "proof", sourceKey), pageUrl: page.url, observedAt: bundle.capturedAt, aliases: richAliases(page.url, "proof", sourceKey), fields: { observationType: "proof", sourceKey, proofKind: proof.kind, text: proof.text } }, hashIdentity);
  }
  for (const fact of pageRecords(page, "contactFacts")) {
    const sourceKey = stringField(fact, "sourceKey", "unknown");
    const kind = stringField(fact, "kind", "unknown");
    const scoped = `${normalizeLocator(page.url)}#${sourceKey}`;
    addEntry(entries, runId, { kind: "contact-fact", locator: richLocator(page.url, `contact:${kind}`, sourceKey), pageUrl: page.url, observedAt: bundle.capturedAt, aliases: [`contact-fact:${scoped}`, `contact:${kind}:${scoped}:${stringField(fact, "value")}`], fields: { observationType: "contact-fact", sourceKey, factKind: kind, value: fact.value } }, hashIdentity);
  }
  for (const fact of pageRecords(page, "datedFacts")) {
    const sourceKey = stringField(fact, "sourceKey", "unknown");
    const kind = stringField(fact, "kind", "unknown");
    const scoped = `${normalizeLocator(page.url)}#${sourceKey}`;
    addEntry(entries, runId, { kind: "element", locator: richLocator(page.url, `date:${kind}`, sourceKey), pageUrl: page.url, observedAt: bundle.capturedAt, aliases: [`date-fact:${scoped}`, `date:${kind}:${scoped}:${stringField(fact, "value")}`], fields: { observationType: "date-fact", sourceKey, dateKind: kind, value: fact.value } }, hashIdentity);
  }
  for (const observation of pageRecords(page, "accessibility")) {
    const elementKey = stringField(observation, "elementKey", "unknown");
    const issue = stringField(observation, "issue", "unknown");
    const scoped = `${normalizeLocator(page.url)}#${elementKey}:${issue}`;
    addEntry(entries, runId, { kind: "accessibility", locator: richLocator(page.url, `accessibility:${issue}`, elementKey), pageUrl: page.url, observedAt: bundle.capturedAt, aliases: [`a11y:${scoped}`, `accessibility:${scoped}`], fields: { observationType: "accessibility", elementKey, issue, source: observation.source, detail: observation.detail } }, hashIdentity);
  }
}
function buildScreenshotEntry(entries: Map<string, EntryState>, runId: string, bundle: ExtendedEvidenceBundle, screenshot: ExtendedScreenshot, hashIdentity: (value: string) => string): void { addEntry(entries, runId, { kind: "screenshot", locator: screenshot.id, pageUrl: screenshot.pageUrl, screenshotId: screenshot.id, viewport: screenshot.viewport, observedAt: screenshot.capturedAt, aliases: [`visual:${screenshot.id}`], fields: { label: screenshot.label, width: screenshot.width, height: screenshot.height }, observedFields: { pageUrl: screenshot.pageUrl, viewport: screenshot.viewport, capturedAt: screenshot.capturedAt, label: screenshot.label, width: screenshot.width, height: screenshot.height } }, hashIdentity); }
function buildNetworkEntry(entries: Map<string, EntryState>, runId: string, bundle: EvidenceBundle, event: EvidenceBundle["networkEvents"][number], hashIdentity: (value: string) => string): void { const url = boundedTrim(event.url, MAX_PAYLOAD_STRING_LENGTH, "network event URL"); const normalized = normalizeLocator(url); const locator = JSON.stringify({ url: normalized, stage: event.stage ?? null, code: event.code ?? null, outcome: event.outcome, status: event.status ?? null, reason: event.reason, redirects: event.redirects ?? null }); addEntry(entries, runId, { kind: "probe", locator, pageUrl: canonicalUrl(url) ? url : undefined, observedAt: bundle.capturedAt, aliases: [`target:${url}`, `probe:${url}`, ...(event.status !== undefined ? [`status:${event.status}`] : []), ...(normalized !== url ? [`target:${normalized}`, `probe:${normalized}`] : [])], fields: { url, outcome: event.outcome, reason: event.reason, code: event.code, stage: event.stage, status: event.status, redirects: event.redirects } }, hashIdentity); }
type ResourceFailure = NonNullable<EvidenceBundle["resourceFailures"]>[number];
type ConsoleError = NonNullable<EvidenceBundle["consoleErrors"]>[number];
type PerformanceObservation = NonNullable<EvidenceBundle["performanceObservations"]>[number];
function resourceFailureLocator(failure: ResourceFailure): string { return JSON.stringify({ pageUrl: normalizeLocator(sanitizeEvidenceUrl(failure.pageUrl)), url: normalizeLocator(sanitizeEvidenceUrl(failure.url), true), resourceType: sanitizeEvidenceText(failure.resourceType), status: failure.status ?? null, reason: sanitizeEvidenceText(failure.reason), source: sanitizeEvidenceText(failure.source) }); }
function consoleErrorLocator(error: ConsoleError): string { return JSON.stringify({ pageUrl: normalizeLocator(sanitizeEvidenceUrl(error.pageUrl)), level: sanitizeEvidenceText(error.level), message: sanitizeEvidenceText(error.message), sourceUrl: error.sourceUrl ? normalizeLocator(sanitizeEvidenceUrl(error.sourceUrl), true) : null, lineNumber: error.lineNumber ?? null, columnNumber: error.columnNumber ?? null }); }
function performanceLocator(observation: PerformanceObservation): string { return JSON.stringify({ pageUrl: normalizeLocator(observation.pageUrl), source: observation.source, status: observation.status ?? null, responseTimeMs: observation.responseTimeMs, transferSizeBytes: observation.transferSizeBytes }); }
function buildResourceFailureEntry(entries: Map<string, EntryState>, runId: string, bundle: EvidenceBundle, failure: ResourceFailure, hashIdentity: (value: string) => string): void { const locator = resourceFailureLocator(failure); addEntry(entries, runId, { kind: "probe", locator, pageUrl: sanitizeEvidenceUrl(failure.pageUrl), observedAt: failure.observedAt ?? bundle.capturedAt, aliases: [compactAlias("resource-failure", locator)], fields: { observationType: "resource-failure", url: sanitizeEvidenceUrl(failure.url), resourceType: sanitizeEvidenceText(failure.resourceType), status: failure.status, reason: sanitizeEvidenceText(failure.reason), source: sanitizeEvidenceText(failure.source) } }, hashIdentity); }
function buildConsoleErrorEntry(entries: Map<string, EntryState>, runId: string, bundle: EvidenceBundle, error: ConsoleError, hashIdentity: (value: string) => string): void { const locator = consoleErrorLocator(error); addEntry(entries, runId, { kind: "probe", locator, pageUrl: sanitizeEvidenceUrl(error.pageUrl), observedAt: error.observedAt ?? bundle.capturedAt, aliases: [compactAlias("console-error", locator)], fields: { observationType: "console-error", level: sanitizeEvidenceText(error.level), message: sanitizeEvidenceText(error.message), source: sanitizeEvidenceText(error.source), sourceUrl: error.sourceUrl ? sanitizeEvidenceUrl(error.sourceUrl) : undefined, lineNumber: error.lineNumber, columnNumber: error.columnNumber } }, hashIdentity); }
function buildPerformanceEntry(entries: Map<string, EntryState>, runId: string, bundle: EvidenceBundle, observation: PerformanceObservation, hashIdentity: (value: string) => string): void { const locator = performanceLocator(observation); addEntry(entries, runId, { kind: "performance", locator, pageUrl: observation.pageUrl, observedAt: observation.observedAt ?? bundle.capturedAt, aliases: [compactAlias("performance", locator)], fields: { observationType: "performance", source: observation.source, status: observation.status, responseTimeMs: observation.responseTimeMs, transferSizeBytes: observation.transferSizeBytes } }, hashIdentity); }
function buildRenderedEntries(entries: Map<string, EntryState>, runId: string, page: ExtendedRenderedPage, hashIdentity: (value: string) => string): void { if (page.runId !== runId) throw new Error(`Rendered evidence runId ${page.runId} does not match analysis run ${runId}.`); const pageLocator = `rendered-page|${page.screenshotId}`; addEntry(entries, runId, { kind: "element", locator: pageLocator, pageUrl: page.pageUrl, screenshotId: page.screenshotId, viewport: page.viewport, observedAt: page.capturedAt, aliases: [`rendered-page:${page.screenshotId}`], fields: { observationType: "rendered-page", source: page.source, width: page.width, height: page.height, elementCount: page.elements.length } }, hashIdentity); for (const element of page.elements) { const locator = `rendered-element|${page.screenshotId}|${element.elementKey}`; addEntry(entries, runId, { kind: "element", locator, pageUrl: element.pageUrl, screenshotId: element.screenshotId, viewport: element.viewport, observedAt: page.capturedAt, aliases: [`rendered-element:${page.screenshotId}#${element.elementKey}`], fields: { observationType: "rendered-element", elementKey: element.elementKey, elementKind: element.kind, geometry: JSON.stringify(element.geometry), label: element.label, accessibleName: element.accessibleName, labelState: element.labelState, source: element.source, viewportWidth: element.viewportWidth, viewportHeight: element.viewportHeight } }, hashIdentity); if (element.labelState === "missing" || element.labelState === "empty") { const accessibilityLocator = `rendered-accessibility|${page.screenshotId}|${element.elementKey}|${element.labelState}`; addEntry(entries, runId, { kind: "accessibility", locator: accessibilityLocator, pageUrl: element.pageUrl, screenshotId: element.screenshotId, viewport: element.viewport, observedAt: page.capturedAt, aliases: [compactAlias("rendered-accessibility", accessibilityLocator)], fields: { observationType: "rendered-accessibility", elementKey: element.elementKey, elementKind: element.kind, labelState: element.labelState, source: element.source } }, hashIdentity); } } }

interface ExtendedScreenshot { id: string; pageUrl: string; viewport: "desktop" | "mobile"; width: number; height: number; capturedAt: string; label: string; }
interface ExtendedRenderedPage { runId: string; screenshotId: string; pageUrl: string; viewport: "desktop" | "mobile"; width: number; height: number; capturedAt: string; source: "parsed" | "rendered"; elements: Array<{ runId: string; screenshotId: string; pageUrl: string; viewport: "desktop" | "mobile"; viewportWidth: number; viewportHeight: number; elementKey: string; kind: string; geometry: unknown; label: string; accessibleName: string; labelState: string; source: string }>; }
interface ExtendedEvidenceBundle extends EvidenceBundle { site: EvidenceBundle["site"] & { nav: string[] }; }

export function buildEvidenceLedger(input: { runId: string; bundle: EvidenceBundle }): EvidenceRef[] {
  const bundle = input.bundle as ExtendedEvidenceBundle;
  const runId = boundedTrim(input.runId, 200, "runId");
  boundedTrim(bundle.capturedAt, 200, "capturedAt");
  const entries = new Map<string, EntryState>();
  for (const page of bundle.site.pages) { buildPageEntry(entries, runId, bundle, page, fnv1a64); page.forms.forEach((_form, index) => buildFormEntry(entries, runId, bundle, page, index, fnv1a64)); buildRichPageEntries(entries, runId, bundle, page, fnv1a64); }
  for (const link of bundle.site.links) buildLinkEntry(entries, runId, bundle, link, fnv1a64);
  for (const label of bundle.site.nav ?? []) { if (label.trim()) addEntry(entries, runId, { kind: "link", locator: `nav:${label.trim()}`, observedAt: bundle.capturedAt, aliases: [`nav:${label.trim()}`, `link:nav:${label.trim()}`], fields: { label: label.trim(), inNav: true } }, fnv1a64); }
  for (const screenshot of bundle.visualReview?.screenshots ?? []) buildScreenshotEntry(entries, runId, bundle, screenshot, fnv1a64);
  for (const event of bundle.networkEvents) buildNetworkEntry(entries, runId, bundle, event, fnv1a64);
  for (const failure of bundle.resourceFailures ?? []) buildResourceFailureEntry(entries, runId, bundle, failure, fnv1a64);
  for (const error of bundle.consoleErrors ?? []) buildConsoleErrorEntry(entries, runId, bundle, error, fnv1a64);
  for (const observation of bundle.performanceObservations ?? []) buildPerformanceEntry(entries, runId, bundle, observation, fnv1a64);
  for (const renderedPage of bundle.renderedPages ?? []) buildRenderedEntries(entries, runId, renderedPage, fnv1a64);
  if (entries.size > MAX_LEDGER_ENTRIES) throw new Error(`Evidence ledger exceeds the maximum of ${MAX_LEDGER_ENTRIES} entries.`);
  return [...entries.values()].sort((left, right) => left.record.kind.localeCompare(right.record.kind) || compareCodePoints(left.record.locator, right.record.locator) || compareCodePoints(left.record.id, right.record.id)).map(({ record }) => EvidenceRefSchema.parse(record));
}

const EVIDENCE_ALIAS_CACHE = new WeakMap<object, string[]>();
export function aliasesFor(record: EvidenceRef): string[] { const cached = EVIDENCE_ALIAS_CACHE.get(record); if (cached) return cached; const aliases: string[] = []; if (typeof record.payload.legacyRef === "string") aliases.push(record.payload.legacyRef); if (typeof record.payload.legacyRefs === "string") { try { const parsed: unknown = JSON.parse(record.payload.legacyRefs); if (Array.isArray(parsed)) aliases.push(...parsed.filter((value): value is string => typeof value === "string")); } catch { /* preserve only the primary alias */ } } const resolved = uniqueStrings(aliases); EVIDENCE_ALIAS_CACHE.set(record, resolved); return resolved; }
function matchingKindOrder(kind: string): EvidenceRef["kind"][] { switch (kind) { case "target": return ["probe", "form", "link"]; case "element": return ["form", "link"]; case "status": return ["probe"]; case "verified": case "considered": case "page": return ["page"]; case "visual": return ["screenshot"]; case "nav": case "link": return ["link"]; case "form": return ["form"]; case "probe": return ["probe"]; default: return []; } }
function semanticMatches(record: EvidenceRef, parsed: { kind: string; value: string }): boolean { const value = parsed.value.trim(); if (!value) return false; const normalized = normalizeLocator(value, parsed.kind === "link" || parsed.kind === "element" || parsed.kind === "target"); const locatorMatches = record.locator === normalized; switch (parsed.kind) { case "page": case "verified": case "considered": return record.kind === "page" && locatorMatches; case "visual": return record.kind === "screenshot" && (record.screenshotId === value || record.locator === value); case "status": return record.kind === "probe" && String(record.payload.status ?? "") === value; case "nav": return record.kind === "link" && record.payload.inNav === true && record.payload.label === value; default: return matchingKindOrder(parsed.kind).includes(record.kind) && (locatorMatches || aliasesFor(record).includes(`${parsed.kind}:${value}`)); } }
function preferredMatches(records: EvidenceRef[], parsed: { kind: string; value: string }): EvidenceRef[] { for (const kind of matchingKindOrder(parsed.kind)) { const matching = records.filter((record) => record.kind === kind && semanticMatches(record, parsed)); if (matching.length > 0) return matching; } return []; }

export function resolveLegacyEvidenceRefs(ledger: readonly EvidenceRef[], legacyRefs: readonly string[]): { ids: string[]; unresolved: string[] } {
  const records = ledger.map((record) => EvidenceRefSchema.parse(record));
  const ids: string[] = []; const unresolved: string[] = []; const seenIds = new Set<string>(); const seenUnresolved = new Set<string>();
  for (const raw of legacyRefs) {
    const ref = raw.trim();
    if (!ref) { if (!seenUnresolved.has(ref)) { seenUnresolved.add(ref); unresolved.push(ref); } continue; }
    const exact = records.filter((record) => record.id === ref || aliasesFor(record).includes(ref));
    const parsed = parseEvidenceRef(ref);
    const matching = preferredMatches(records, parsed);
    const candidates = matching.length > 0 ? matching : exact;
    if (candidates.length !== 1) { if (!seenUnresolved.has(ref)) { seenUnresolved.add(ref); unresolved.push(ref); } continue; }
    const record = candidates[0]; if (!record || seenIds.has(record.id)) continue; seenIds.add(record.id); ids.push(record.id);
  }
  return { ids, unresolved };
}
