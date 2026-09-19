import { normalizeAndValidateUrl, crawlKey } from "@/adapters/evidence/urlPolicy";
import { parseImageAltCountRef, parseWordCountRef } from "@/core/evidenceRef";
import { DiagnosticDraftSchema, type DiagnosticDraft } from "@/core/insightSchema";
import { definitionForProblemType, type InsightProblemType } from "@/core/insightTaxonomy";

export const TECHNICAL_RULE_IDS = ["missing-title", "duplicate-title", "thin-service-page", "missing-h1", "broken-internal-link", "missing-meta-description", "missing-structured-data", "missing-image-alt"] as const;
export type TechnicalRuleId = (typeof TECHNICAL_RULE_IDS)[number];
const TECHNICAL_RULE_SET = new Set<string>(TECHNICAL_RULE_IDS);

export function aggregateTechnicalDiagnostics(input: {
  diagnostics: readonly DiagnosticDraft[];
  client: { domain: string };
  suppressedEvidenceRefsByRule?: Partial<Record<TechnicalRuleId, readonly string[]>>;
}): DiagnosticDraft[] {
  const grouped = new Map<TechnicalRuleId, DiagnosticDraft[]>();
  for (const diagnostic of input.diagnostics) {
    if (diagnostic.details?.kind === "broad" || !isTechnicalRuleId(diagnostic.detectorId)) continue;
    const group = grouped.get(diagnostic.detectorId) ?? [];
    group.push(diagnostic);
    grouped.set(diagnostic.detectorId, group);
  }
  const result: DiagnosticDraft[] = [];
  for (const diagnostic of input.diagnostics) {
    if (diagnostic.details?.kind === "broad" || !isTechnicalRuleId(diagnostic.detectorId)) continue;
    if (result.some((existing) => existing.detectorId === diagnostic.detectorId)) continue;
    const aggregate = aggregateTechnicalGroup({ ruleId: diagnostic.detectorId, diagnostics: grouped.get(diagnostic.detectorId) ?? [], domain: input.client.domain, suppressedEvidenceRefs: input.suppressedEvidenceRefsByRule?.[diagnostic.detectorId] ?? [] });
    if (aggregate) result.push(aggregate);
  }
  return result;
}

export function isTechnicalRuleId(value: string): value is TechnicalRuleId { return TECHNICAL_RULE_SET.has(value); }

function aggregateTechnicalGroup(input: { ruleId: TechnicalRuleId; diagnostics: readonly DiagnosticDraft[]; domain: string; suppressedEvidenceRefs: readonly string[] }): DiagnosticDraft | null {
  const suppressedPages = new Set(input.suppressedEvidenceRefs.filter((ref) => ref.startsWith("page:")).map((ref) => normalizedPageUrl(ref.slice("page:".length)) ?? ref));
  const contributing: DiagnosticDraft[] = [];
  for (const diagnostic of input.diagnostics) {
    const pageRefs = diagnostic.legacyEvidenceRefs.filter((ref) => ref.startsWith("page:"));
    const keptPageRefs = pageRefs.filter((ref) => !suppressedPages.has(normalizedPageUrl(ref.slice("page:".length)) ?? ref));
    const keptPageKeys = new Set(keptPageRefs.map((ref) => normalizedPageUrl(ref.slice("page:".length)) ?? ref));
    if (pageRefs.length > 0 && keptPageKeys.size === 0) continue;
    if (input.ruleId === "duplicate-title" && keptPageKeys.size < 2) continue;
    const legacyEvidenceRefs = diagnostic.legacyEvidenceRefs.filter((ref) => !ref.startsWith("page:") || !suppressedPages.has(normalizedPageUrl(ref.slice("page:".length)) ?? ref));
    contributing.push({ ...diagnostic, legacyEvidenceRefs });
  }
  if (contributing.length === 0) return null;
  const evidenceRefs = unique(contributing.flatMap((diagnostic) => diagnostic.legacyEvidenceRefs));
  const pageUrls = evidenceRefs.filter((ref) => ref.startsWith("page:")).map((ref) => ref.slice("page:".length));
  const targetUrls = evidenceRefs.filter((ref) => ref.startsWith("target:")).map((ref) => ref.slice("target:".length));
  const imageCountByPage = new Map<string, number>();
  const addImageCount = (pageKey: string, count: number) => imageCountByPage.set(pageKey, Math.max(imageCountByPage.get(pageKey) ?? 0, count));
  for (const diagnostic of contributing) {
    let attributed = false;
    for (const ref of diagnostic.legacyEvidenceRefs) {
      const keyed = parseImageAltCountRef(ref);
      if (!keyed) continue;
      addImageCount(crawlKey(keyed.pageUrl), keyed.count);
      attributed = true;
    }
    const pageRefs = diagnostic.legacyEvidenceRefs.filter((ref) => ref.startsWith("page:"));
    const bare = diagnostic.legacyEvidenceRefs.reduce((total, ref) => total + bareMissingImageCount(ref), 0);
    if (!attributed && bare > 0 && pageRefs.length === 1) addImageCount(crawlKey(pageRefs[0]!.slice("page:".length)), bare);
  }
  const imageCount = [...imageCountByPage.values()].reduce((total, count) => total + count, 0);
  const wordCountsByPage = new Map<string, number>();
  for (const diagnostic of contributing) {
    for (const ref of diagnostic.legacyEvidenceRefs) {
      const parsed = parseWordCountRef(ref);
      if (parsed) wordCountsByPage.set(crawlKey(parsed.pageUrl), parsed.wordCount);
    }
    const pageRefs = diagnostic.legacyEvidenceRefs.filter((ref) => ref.startsWith("page:"));
    const bare = diagnostic.legacyEvidenceRefs.map((ref) => /^word-count:(\d+)$/.exec(ref)?.[1]).find((value) => value !== undefined);
    if (bare !== undefined && pageRefs.length === 1) wordCountsByPage.set(crawlKey(pageRefs[0]!.slice("page:".length)), Number.parseInt(bare, 10));
  }
  const first = contributing[0]!;
  const problemType = problemTypeFor(first);
  return DiagnosticDraftSchema.parse({ detectorId: input.ruleId, detectorVersion: first.detectorVersion, category: definitionForProblemType(problemType).category, problemType, subject: { kind: "site", key: input.domain }, observation: aggregateDetected({ ruleId: input.ruleId, pageCount: pageUrls.length, targetCount: targetUrls.length, imageCount, pageUrls, wordCountsByPage, targetUrls, titleValues: evidenceRefs.filter((ref) => ref.startsWith("title:")).map((ref) => ref.slice("title:".length)) }), legacyEvidenceRefs: evidenceRefs, rawConfidence: Math.min(...contributing.map((diagnostic) => diagnostic.rawConfidence)), state: first.state, details: { kind: "legacy", legacyRuleId: input.ruleId, suppressedEvidenceRefs: unique(input.suppressedEvidenceRefs) } });
}

function problemTypeFor(diagnostic: DiagnosticDraft): InsightProblemType {
  if (diagnostic.details?.kind === "legacy") {
    switch (diagnostic.details.legacyRuleId) {
      case "missing-title": return "missing_page_title";
      case "duplicate-title": return "duplicate_page_title";
      case "thin-service-page": return "thin_service_content";
      case "missing-h1": return "missing_primary_heading";
      case "broken-internal-link": return "broken_internal_link";
      case "missing-meta-description": return "missing_meta_description";
      case "missing-structured-data": return "missing_business_schema";
      case "missing-image-alt": return "missing_image_text_alternative";
      default: break;
    }
  }
  const direct = diagnostic.problemType;
  if (definitionForProblemType(direct).legacyRuleId === diagnostic.detectorId) return direct;
  throw new Error(`Unsupported technical diagnostic rule: ${diagnostic.detectorId}`);
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) { const key = evidenceRefKey(value); if (seen.has(key)) continue; seen.add(key); result.push(value); }
  return result;
}
function evidenceRefKey(ref: string): string {
  if (ref.startsWith("page:") || ref.startsWith("target:")) { const prefix = ref.slice(0, ref.indexOf(":") + 1); const url = normalizedPageUrl(ref.slice(prefix.length)); return `${prefix}${url ?? ref.slice(prefix.length)}`; }
  return ref;
}
function bareMissingImageCount(ref: string): number { const match = /^images-without-alt:(\d+)$/.exec(ref); return match ? Number(match[1]) : 0; }
function count(value: number, singular: string, plural = `${singular}s`): string { return `${value} ${value === 1 ? singular : plural}`; }

function aggregateDetected(input: { ruleId: TechnicalRuleId; pageCount: number; targetCount: number; imageCount: number; pageUrls: readonly string[]; wordCountsByPage: ReadonlyMap<string, number>; targetUrls: readonly string[]; titleValues: readonly string[] }): string {
  const pages = count(input.pageCount, "affected page");
  const pageList = input.pageUrls.length > 0 ? `${input.pageUrls.join(", ")}.` : "none.";
  switch (input.ruleId) {
    case "missing-title": return `${pages} ${input.pageCount === 1 ? "is" : "are"} missing a non-empty HTML title: ${pageList}`;
    case "duplicate-title": return input.titleValues.length > 0 ? `The title "${input.titleValues[0]}" is repeated on ${count(input.pageCount, "readable page")}: ${pageList}` : `Duplicate HTML titles affect ${pages}: ${pageList}`;
    case "thin-service-page": return `${pages} ${input.pageCount === 1 ? "is" : "are"} below the observed 120-word content threshold: ${input.pageUrls.map((url) => { const words = input.wordCountsByPage.get(crawlKey(url)); return words === undefined ? url : `${url} (${words} words)`; }).join(", ") || "none"}.`;
    case "missing-h1": return `${pages} ${input.pageCount === 1 ? "has" : "have"} no non-empty H1 heading: ${pageList}`;
    case "broken-internal-link": return `${count(input.targetCount, "verified broken internal-link target")} ${input.targetCount === 1 ? "is" : "are"} linked from ${pages}. Targets: ${input.targetUrls.join(", ") || "none"}. Sources: ${pageList}`;
    case "missing-meta-description": return `${pages} ${input.pageCount === 1 ? "is" : "are"} missing a non-empty meta description: ${pageList}`;
    case "missing-structured-data": return `${pages} ${input.pageCount === 1 ? "has" : "have"} no observed LocalBusiness or Service structured-data type: ${pageList}`;
    case "missing-image-alt": return input.imageCount === 0 ? `Images on ${pages} have no observed alt attribute; decorative alt="" images are excluded. Pages: ${pageList}` : `${count(input.imageCount, "image")} across ${pages} ${input.imageCount === 1 ? "is" : "are"} missing an alt attribute; decorative alt="" images are excluded. Pages: ${pageList}`;
  }
}

function normalizedPageUrl(url: string): string | null {
  const parsed = normalizeAndValidateUrl(url);
  return parsed.ok ? crawlKey(parsed.url) : null;
}
