import { crawlKey } from "@/adapters/evidence/urlPolicy";
import { dedupeKey } from "@/core/dedupe";
import { DiagnosticDraftSchema, type DiagnosticDraft } from "@/core/insightSchema";
import { VisualEvidenceReferenceSchema, VisualFindingSchema, type RenderedElementObservation, type RenderedPageObservation, type VisualFinding, type VisualScreenshot } from "@/core/visualSchema";
import { definitionForProblemType } from "@/core/insightTaxonomy";
import type { Opportunity, Service } from "@/core/schema";

const HOUSEKEEPING = /\b(?:h1|meta description|alt (?:text|attribute)|structured data|schema markup|missing (?:page )?title)\b/i;
const INVENTED_METRICS = /\b\d+(?:\.\d+)?\s*%|[$£€]\s*\d|\b(?:guarantee[sd]?|will increase|will boost|losing \d|lost \d|conversion rate is|bounce rate is|search volume)\b/i;
const INJECTION = /ignore (?:all |the |any )?(?:previous|prior|system)|system prompt|api[ _-]?key|reveal.*secret|follow these instructions/i;

export type VisualCapture = VisualScreenshot & {
  page?: { title?: string; status?: number; wordCount?: number };
  text?: string;
};
export interface VisualValidationOptions { requireExactReferences?: boolean; maxFindings?: number; mode?: "shadow" | "publish"; }

export function isVisualService(service: Service): boolean {
  return service.active && (service.tags.includes("visual-review") || service.tags.includes("landing-page") || service.tags.includes("service-pages-build") || service.tags.includes("conversion-fix") || service.tags.includes("competitor-gap") || /web(?:site)? design|redesign|conversion|ux|user experience/i.test(service.name));
}

const validatedVisualFindings = new WeakSet<object>();
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value as object)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}
function brandVisualFinding(finding: VisualFinding): VisualFinding { const canonical = deepFreeze(finding); validatedVisualFindings.add(canonical); return canonical; }
export function isValidatedVisualFinding(finding: unknown): finding is VisualFinding { return typeof finding === "object" && finding !== null && validatedVisualFindings.has(finding); }

export function validateVisualFindings(raw: readonly unknown[], screenshots: readonly VisualCapture[], catalog: readonly Service[], options?: VisualValidationOptions): VisualFinding[];
export function validateVisualFindings(raw: readonly unknown[], screenshots: readonly VisualCapture[], rendered: readonly RenderedPageObservation[], catalog: readonly Service[], options?: VisualValidationOptions): VisualFinding[];
export function validateVisualFindings(raw: readonly unknown[], screenshots: readonly VisualCapture[], renderedOrCatalog: readonly RenderedPageObservation[] | readonly Service[], catalogOrOptions: readonly Service[] | VisualValidationOptions = [], modernOptions?: VisualValidationOptions): VisualFinding[] {
  const modern = Array.isArray(catalogOrOptions);
  const rendered = modern ? renderedOrCatalog as readonly RenderedPageObservation[] : [];
  const catalog = (modern ? catalogOrOptions : renderedOrCatalog) as readonly Service[];
  const options = (modern ? modernOptions : catalogOrOptions as VisualValidationOptions) ?? {};
  const requireExactReferences = options.requireExactReferences ?? modern;
  const maxFindings = Math.max(0, Number.isInteger(options.maxFindings) ? options.maxFindings! : 3);
  const result: VisualFinding[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const parsed = VisualFindingSchema.safeParse(item);
    if (!parsed.success) continue;
    const finding = parsed.data;
    if (finding.visualEvidence && finding.evidence && JSON.stringify(finding.visualEvidence) !== JSON.stringify(finding.evidence)) continue;
    const references = finding.visualEvidence ?? finding.evidence;
    if (requireExactReferences && !references?.length) continue;
    const allText = [finding.title, finding.observation, finding.impact, finding.recommendation, finding.counterEvidence ?? "", ...finding.scope, ...finding.acceptanceCriteria].join(" ");
    if (HOUSEKEEPING.test(allText) || INVENTED_METRICS.test(allText) || INJECTION.test(allText)) continue;
    if (requireExactReferences && !screenshots.some(isUsableVisualCapture)) continue;
    if (options.mode !== "shadow" && (!finding.serviceId || !catalog.some((service) => service.id === finding.serviceId && isVisualService(service)))) continue;
    const normalized = references ? exactVisualEvidence(finding, references, screenshots, rendered, requireExactReferences) : finding.screenshotIds.every((id) => screenshots.some((screenshot) => screenshot.id === id && samePage(screenshot.pageUrl, finding.pageUrl))) ? finding : undefined;
    if (!normalized) continue;
    const key = visualSubject(finding);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(brandVisualFinding(normalized));
  }
  return result.sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high")).slice(0, maxFindings);
}

export function isUsableVisualCapture(screenshot: VisualCapture): boolean {
  const combined = `${screenshot.page?.title ?? ""} ${screenshot.text ?? ""}`;
  if (/just a moment|access denied|attention required|verify you are human|checking your browser|page not found|service unavailable|sign in to continue|log in to continue/i.test(combined)) return false;
  if (typeof screenshot.page?.status === "number" && (screenshot.page.status < 200 || screenshot.page.status >= 300)) return false;
  if (screenshot.page && typeof screenshot.page.wordCount === "number" && screenshot.page.wordCount < 25 && (screenshot.text ?? "").trim().length < 120) return false;
  return true;
}
function samePage(a: string, b: string): boolean { return crawlKey(a) === crawlKey(b); }
function matchingRenderedElement(rendered: readonly RenderedPageObservation[], reference: { renderedObservationId?: string; screenshotId: string; pageUrl: string; viewport: "desktop" | "mobile"; width: number; height: number }): RenderedElementObservation | undefined {
  if (!reference.renderedObservationId) return undefined;
  const ids = new Set([reference.renderedObservationId, `${reference.screenshotId}:${reference.renderedObservationId}`, `rendered:${reference.screenshotId}:${reference.renderedObservationId}`]);
  return rendered.filter((page) => page.source === "rendered" && page.screenshotId === reference.screenshotId && samePage(page.pageUrl, reference.pageUrl) && page.viewport === reference.viewport && page.width === reference.width && page.height === reference.height).flatMap((page) => page.elements).find((element) => element.source === "rendered" && ids.has(element.elementKey));
}
function geometryIntersects(a: { left: number; top: number; width: number; height: number }, b: { left: number; top: number; width: number; height: number }): boolean { return Math.max(a.left, b.left) < Math.min(a.left + a.width, b.left + b.width) && Math.max(a.top, b.top) < Math.min(a.top + a.height, b.top + b.height); }
function exactVisualEvidence(finding: VisualFinding, rawReferences: NonNullable<VisualFinding["visualEvidence"]>, screenshots: readonly VisualCapture[], rendered: readonly RenderedPageObservation[], requireExactReferences: boolean): VisualFinding | undefined {
  const references = rawReferences.map((reference) => VisualEvidenceReferenceSchema.safeParse(reference));
  if (references.some((reference) => !reference.success)) return undefined;
  const parsed = references.map((reference) => reference.data!);
  const screenshotIds = [...new Set(finding.screenshotIds)];
  if (finding.screenshotIds.length !== screenshotIds.length || parsed.length < screenshotIds.length || parsed.some((reference) => !screenshotIds.includes(reference.screenshotId)) || screenshotIds.some((id) => !parsed.some((reference) => reference.screenshotId === id))) return undefined;
  const matchedElements: RenderedElementObservation[] = [];
  for (const reference of parsed) {
    const screenshot = screenshots.find((candidate) => candidate.id === reference.screenshotId);
    if (!screenshot || (requireExactReferences && !isUsableVisualCapture(screenshot))) return undefined;
    if (!samePage(reference.pageUrl, screenshot.pageUrl) || !samePage(finding.pageUrl, screenshot.pageUrl) || reference.viewport !== screenshot.viewport || reference.width !== screenshot.width || reference.height !== screenshot.height) return undefined;
    const right = reference.visibleRegion.left + reference.visibleRegion.width;
    const bottom = reference.visibleRegion.top + reference.visibleRegion.height;
    if (right > reference.width || bottom > reference.height) return undefined;
    const element = matchingRenderedElement(rendered, reference);
    if (reference.renderedObservationId && !element) return undefined;
    if (element && !geometryIntersects(element.geometry, reference.visibleRegion)) return undefined;
    if (element) matchedElements.push(element);
  }
  const geometryClaim = new Set(["overlap", "clipped", "obscured-action", "small-target", "target-size"]).has(finding.problem ?? "");
  if (requireExactReferences && geometryClaim && matchedElements.length === 0) return undefined;
  if (requireExactReferences && (finding.problem === "clipped" || finding.problem === "small-target" || finding.problem === "target-size")) {
    if (finding.problem === "clipped" && !matchedElements.some((element) => element.geometry.horizontallyClipped || element.geometry.verticallyClipped)) return undefined;
    if ((finding.problem === "small-target" || finding.problem === "target-size") && !matchedElements.some((element) => element.geometry.width < 44 || element.geometry.height < 44)) return undefined;
  }
  if (requireExactReferences && (finding.problem === "overlap" || finding.problem === "obscured-action")) {
    const observationIds = new Set(parsed.map((reference) => reference.renderedObservationId).filter((id): id is string => Boolean(id)));
    if (matchedElements.length < 2 || observationIds.size < 2) return undefined;
    const overlaps = matchedElements.some((left, index) => matchedElements.slice(index + 1).some((right) => geometryIntersects(left.geometry, right.geometry)));
    if (!overlaps) return undefined;
  }
  if (!requireExactReferences) return finding;
  const canonicalPageUrl = screenshots.find((candidate) => candidate.id === parsed[0]?.screenshotId)?.pageUrl ?? finding.pageUrl;
  return { ...finding, pageUrl: canonicalPageUrl, visualEvidence: parsed.map((reference) => ({ ...reference, pageUrl: screenshots.find((candidate) => candidate.id === reference.screenshotId)?.pageUrl ?? reference.pageUrl })) };
}

export function visualSubject(finding: VisualFinding): string { return `${finding.region && finding.problem ? `${finding.region}:${finding.problem}` : finding.category}:${crawlKey(finding.pageUrl)}`; }
export function diagnosticFromVisualFinding(finding: VisualFinding): DiagnosticDraft {
  if (!isValidatedVisualFinding(finding)) throw new TypeError("Visual finding must be validated before adaptation");
  const base = { detectorId: "visual-conversion-opportunity", detectorVersion: "1", category: definitionForProblemType("visual_conversion_obstacle").category, problemType: "visual_conversion_obstacle" as const, subject: { kind: "element" as const, key: visualSubject(finding) }, observation: finding.observation, legacyEvidenceRefs: [finding.pageUrl, ...finding.screenshotIds.map((id) => `visual:${id}`)], rawConfidence: 0.7, state: "observed" as const, details: { kind: "legacy" as const, legacyRuleId: "visual-conversion-opportunity" as const } };
  return DiagnosticDraftSchema.parse({ ...base, ...(finding.counterEvidence ? { counterEvidence: [finding.counterEvidence], counterEvidenceState: "present" } : { counterEvidenceState: "not_checked" }) });
}

export function matchingVisualPrior(finding: VisualFinding, clientId: string, existing: readonly Opportunity[]): Opportunity | undefined {
  const key = dedupeKey(clientId, "visual-conversion-opportunity", visualSubject(finding));
  const exact = existing.find((opportunity) => opportunity.clientId === clientId && opportunity.dedupeKey === key);
  if (exact) return exact;
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const legacy = existing.filter((opportunity) => opportunity.clientId === clientId && (opportunity.ruleId as string) === "visual-conversion-opportunity" && opportunity.suggestedServiceId === finding.serviceId && opportunity.evidenceRefs.some((ref) => /^https?:/.test(ref) && crawlKey(ref) === crawlKey(finding.pageUrl)) && (normalize(opportunity.title) === normalize(finding.title) || normalize(opportunity.detected) === normalize(finding.observation)));
  return legacy.length === 1 ? legacy[0] : undefined;
}

export interface VisualCandidate { ruleId: "visual-conversion-opportunity"; subject: string; visualTitle: string; detected: string; evidenceRefs: string[]; rawConfidence: number; suggestedServiceId: string; }
export function visualCandidate(finding: VisualFinding): VisualCandidate {
  if (!finding.serviceId) throw new TypeError("A visual candidate requires an active catalog service");
  return { ruleId: "visual-conversion-opportunity", subject: visualSubject(finding), visualTitle: finding.title, detected: finding.observation, evidenceRefs: [finding.pageUrl, ...finding.screenshotIds.map((id) => `visual:${id}`)], rawConfidence: 0.7, suggestedServiceId: finding.serviceId };
}
export function visualEvaluation(finding: VisualFinding): { verdict: "surface"; confidence: number; commerciallyActionable: true; rationale: string; suggestedScope: string[] } {
  return { verdict: "surface", confidence: 0.7, commerciallyActionable: true, rationale: finding.impact, suggestedScope: [finding.recommendation, ...finding.scope, ...finding.acceptanceCriteria.map((criterion) => `Acceptance check: ${criterion}`)] };
}
