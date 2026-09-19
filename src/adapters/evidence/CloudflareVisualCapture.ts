import { crawlKey, isSameSite, normalizeAndValidateUrl } from "@/adapters/evidence/urlPolicy";
import { parseHtml } from "@/adapters/evidence/parseHtml";
import { looksLikeServiceUrl } from "@/core/siteStructure";
import { RenderedPageObservationSchema, type RenderedPageObservation } from "@/core/visualSchema";
import { EvidencePageSchema, type Client, type EvidenceBundle, type EvidenceLink, type EvidencePage } from "@/core/schema";

const ASSET_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "static.wixstatic.com",
  "images.squarespace-cdn.com",
  "cdn.prod.website-files.com",
  "assets-global.website-files.com",
];

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function awaitWithAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) throw signal.reason ?? new Error("Operation aborted");
  let onAbort: (() => void) | undefined;
  const abort = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("Operation aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([operation, abort]); }
  finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
}

export const ANNOTATE_RENDERED_ELEMENTS = `(() => {
  const round = (value) => Math.round(Math.max(0, value) * 100) / 100;
  const selectors = 'a[href],button,input,select,textarea,label,header,nav,main,aside,footer,[role]';
  const counts = new Map();
  for (const element of document.querySelectorAll(selectors)) {
    const tag = element.tagName.toLowerCase();
    const index = counts.get(tag) || 0;
    counts.set(tag, index + 1);
    const rect = element.getBoundingClientRect();
    const horizontalClipped = rect.left < -1 || rect.right > window.innerWidth + 1;
    const verticalClipped = rect.top < -1 || rect.bottom > window.innerHeight + 1;
    const kind = tag === 'a' ? 'anchor' : tag === 'button' ? 'button' :
      ['input', 'select', 'textarea'].includes(tag) ? 'form-control' :
      tag === 'label' ? 'label' : 'landmark';
    element.setAttribute('data-orbit-element-key', tag + ':' + index);
    element.setAttribute('data-orbit-element-kind', kind);
    element.setAttribute('data-orbit-rect', [round(rect.left), round(rect.top), round(rect.width), round(rect.height), window.innerWidth, window.innerHeight].join(','));
    element.setAttribute('data-orbit-horizontal-clipped', String(horizontalClipped));
    element.setAttribute('data-orbit-vertical-clipped', String(verticalClipped));
  }
})();`;

export interface BrowserQuickAction {
  quickAction(action: "snapshot", options: Record<string, unknown>): Promise<Response>;
}

export interface VisualCaptureBudget { reserve(label: string, count: number): boolean; }
export interface VisualCaptureOptions { runId: string; budget: VisualCaptureBudget; signal?: AbortSignal; }
export interface VisualCaptureResult {
  screenshots: PersistedVisualScreenshot[];
  renderedPages: RenderedPageObservation[];
  limitations: string[];
  availability: Array<{ kind: "screenshot"; state: "available" | "partial" | "unavailable"; observedCount: number; reason?: string }>;
  providerCalls: number;
}
export interface LegacyVisualCaptureResult { screenshots: PersistedVisualScreenshot[]; limitations: string[]; }

export interface PersistedVisualScreenshot {
  id: string;
  pageUrl: string;
  viewport: "desktop" | "mobile";
  width: number;
  height: number;
  capturedAt: string;
  label: string;
  dataUrl: string;
  text: string;
  links: EvidenceLink[];
  page: EvidencePage;
}

function isVisualCaptureOptions(value: unknown): value is VisualCaptureOptions {
  return typeof value === "object" && value !== null && typeof (value as { runId?: unknown }).runId === "string" && "budget" in value;
}

function abortSignal(value: unknown): AbortSignal | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<AbortSignal>;
  return typeof candidate.aborted === "boolean" && typeof candidate.addEventListener === "function" ? value as AbortSignal : undefined;
}

function reserveRenderSlot(budget: VisualCaptureBudget | undefined, label: string): boolean { return budget ? budget.reserve(label, 1) : true; }

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto is unavailable for screenshot identity");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function screenshotIdentity(runId: string, pageUrl: string, viewport: "desktop" | "mobile"): Promise<string> {
  return `shot_${await sha256Hex(`${runId}|${crawlKey(pageUrl)}|${viewport}`)}`;
}

function availability(state: "available" | "partial" | "unavailable", observedCount: number, reason?: string) {
  return { kind: "screenshot" as const, state, observedCount, ...(reason ? { reason } : {}) };
}

function htmlAttribute(openTag: string, name: string): string {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, "i").exec(openTag);
  return match?.[1] ?? match?.[2] ?? "";
}

function boundedVisibleText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&(?:amp|#38);/gi, "&").replace(/&(?:lt|#60);/gi, "<").replace(/&(?:gt|#62);/gi, ">").replace(/\s+/g, " ").trim().slice(0, 500);
}

function renderedElementsFromHtml(html: string) {
  const labels = new Map<string, string>();
  const labelPattern = /<label\b([^>]*)>([\s\S]*?)<\/label>/gi;
  let labelMatch: RegExpExecArray | null;
  while ((labelMatch = labelPattern.exec(html)) !== null) {
    const target = htmlAttribute(labelMatch[1] ?? "", "for").trim();
    if (target) labels.set(target, boundedVisibleText(labelMatch[2] ?? ""));
  }
  const elements: Array<Record<string, unknown>> = [];
  const elementPattern = /<(a|button|input|select|textarea|label|header|nav|main|aside|footer|[a-z][a-z0-9-]*)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = elementPattern.exec(html)) !== null && elements.length < 250) {
    const openTag = match[2] ?? "";
    const elementKey = htmlAttribute(openTag, "data-orbit-element-key").trim();
    const kind = htmlAttribute(openTag, "data-orbit-element-kind").trim();
    if (!elementKey || !["anchor", "button", "form-control", "label", "landmark"].includes(kind)) continue;
    const rectValues = htmlAttribute(openTag, "data-orbit-rect").split(",").map(Number);
    if (rectValues.length !== 6 || rectValues.some((value) => !Number.isFinite(value)) || rectValues[4]! <= 0 || rectValues[5]! <= 0) continue;
    const tag = (match[1] ?? "").toLowerCase();
    const id = htmlAttribute(openTag, "id").trim();
    const ariaLabel = htmlAttribute(openTag, "aria-label").trim().slice(0, 500);
    const title = htmlAttribute(openTag, "title").trim().slice(0, 500);
    const placeholder = htmlAttribute(openTag, "placeholder").trim().slice(0, 500);
    const name = htmlAttribute(openTag, "name").trim().slice(0, 500);
    const associatedLabel = id ? labels.get(id) ?? "" : "";
    const bodyStart = (match.index ?? 0) + match[0].length;
    const close = new RegExp(`</${tag}\\s*>`, "i").exec(html.slice(bodyStart));
    const innerText = close ? boundedVisibleText(html.slice(bodyStart, bodyStart + close.index)) : "";
    const label = tag === "label" ? innerText : associatedLabel;
    const accessibleName = ariaLabel || label || innerText || title || placeholder || name;
    const labelState = kind === "landmark" ? accessibleName ? "present" : "not-applicable" : kind === "label" ? innerText ? "present" : "empty" : accessibleName ? "present" : "missing";
    elements.push({
      runId: "", screenshotId: "", pageUrl: "", viewport: "desktop", viewportWidth: Math.trunc(rectValues[4]!), viewportHeight: Math.trunc(rectValues[5]!), elementKey, kind,
      geometry: { left: Math.max(0, rectValues[0]!), top: Math.max(0, rectValues[1]!), width: rectValues[2], height: rectValues[3], horizontallyClipped: htmlAttribute(openTag, "data-orbit-horizontal-clipped") === "true", verticallyClipped: htmlAttribute(openTag, "data-orbit-vertical-clipped") === "true" },
      label, accessibleName, labelState, source: "rendered",
    });
  }
  return elements;
}

function renderedPageObservation(runId: string, screenshot: PersistedVisualScreenshot, html: string): RenderedPageObservation {
  const elements = renderedElementsFromHtml(html).map((element) => ({ ...element, runId, screenshotId: screenshot.id, pageUrl: screenshot.pageUrl, viewport: screenshot.viewport, viewportWidth: screenshot.width, viewportHeight: screenshot.height }));
  return RenderedPageObservationSchema.parse({ runId, screenshotId: screenshot.id, pageUrl: screenshot.pageUrl, viewport: screenshot.viewport, width: screenshot.width, height: screenshot.height, capturedAt: screenshot.capturedAt, elements, source: "rendered" });
}

export function snapshotRequest(url: string, viewport: "desktop" | "mobile", assetUrls: readonly string[] = []): Record<string, unknown> {
  const checked = normalizeAndValidateUrl(url);
  if (!checked.ok || (checked.url.port && !["80", "443"].includes(checked.url.port))) throw new Error("Unsafe screenshot destination");
  const host = checked.url.hostname.replace(/^www\./, "");
  const hosts = new Set([host, `www.${host}`, ...ASSET_HOSTS]);
  for (const raw of assetUrls.slice(0, 40)) {
    const asset = normalizeAndValidateUrl(raw, checked.url);
    if (asset.ok && !asset.url.port && isSameSite(asset.url, checked.url)) hosts.add(asset.url.hostname);
  }
  const mobile = viewport === "mobile";
  return {
    url: checked.url.href,
    allowRequestPattern: [...hosts].map((item) => `^https?://${escapeRegex(item)}/`),
    rejectResourceTypes: ["media", "websocket", "eventsource", "ping"],
    viewport: { width: mobile ? 390 : 1_440, height: mobile ? 844 : 1_000, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile },
    addScriptTag: [{ content: ANNOTATE_RENDERED_ELEMENTS }],
    screenshotOptions: { type: "jpeg", quality: 65, fullPage: false },
    gotoOptions: { waitUntil: "networkidle2", timeout: 12_000 },
    actionTimeout: 4_000,
    bestAttempt: false,
  };
}

export class CloudflareVisualCapture {
  constructor(private readonly browser: BrowserQuickAction) {}

  async capture(client: Client, evidence: EvidenceBundle, optionsOrSignal?: VisualCaptureOptions | AbortSignal): Promise<VisualCaptureResult | LegacyVisualCaptureResult> {
    const modern = isVisualCaptureOptions(optionsOrSignal);
    const signal = modern ? optionsOrSignal.signal : abortSignal(optionsOrSignal);
    const budget = modern ? optionsOrSignal.budget : undefined;
    const runId = modern ? optionsOrSignal.runId : "legacy-capture";
    const unavailable = (limitations: string[]): VisualCaptureResult | LegacyVisualCaptureResult => modern ? { screenshots: [], renderedPages: [], limitations, availability: [availability("unavailable", 0, limitations[0])], providerCalls: 0 } : { screenshots: [], limitations };
    const root = normalizeAndValidateUrl(client.domain.includes("://") ? client.domain : `https://${client.domain}/`);
    if (!root.ok) return unavailable(["The website address was not safe to capture."]);
    if (evidence.networkEvents.some((event) => event.code === "robots" || event.code === "policy")) return unavailable(["The website's access policy prevented visual capture."]);
    const homepage = evidence.site.pages.find((page) => isSameSite(page.url, root.url) && new URL(page.url).pathname === "/")?.url ?? root.url.href;
    const detailUrl = evidence.site.pages.find((page) => page.status >= 200 && page.status < 300 && isSameSite(page.url, root.url) && crawlKey(page.url) !== crawlKey(homepage) && looksLikeServiceUrl(page.url))?.url
      ?? evidence.site.sitemapUrls.flatMap((url) => { const checked = normalizeAndValidateUrl(url, root.url); return checked.ok ? [checked.url] : []; }).find((url) => isSameSite(url, root.url) && crawlKey(url.href) !== crawlKey(homepage) && looksLikeServiceUrl(url.href))?.href
      ?? evidence.site.pages.find((page) => isSameSite(page.url, root.url) && /contact|book|appointment|quote/i.test(new URL(page.url).pathname) && page.status === 200)?.url;
    const targets = [{ url: homepage, viewport: "desktop" as const, label: "Homepage · Desktop" }, { url: homepage, viewport: "mobile" as const, label: "Homepage · Mobile" }, ...(detailUrl ? [{ url: detailUrl, viewport: "mobile" as const, label: "Service / enquiry page · Mobile" }] : [])];
    const assets = evidence.site.pages.flatMap((page) => (page.images ?? []).map((image) => image.src));
    const screenshots: PersistedVisualScreenshot[] = [];
    const renderedPages: RenderedPageObservation[] = [];
    const limitations: string[] = [];
    let providerCalls = 0;
    const captures = await Promise.allSettled(targets.map(async (target) => {
      if (signal?.aborted) throw signal.reason ?? new Error("Operation aborted");
      if (!reserveRenderSlot(budget, `visual:${crawlKey(target.url)}:${target.viewport}`)) throw new Error("render budget exhausted");
      providerCalls += 1;
      const options = snapshotRequest(target.url, target.viewport, assets);
      const response = await awaitWithAbort(this.browser.quickAction("snapshot", options), signal);
      if (signal?.aborted) throw signal.reason ?? new Error("Operation aborted");
      if (!response.ok) throw new Error("capture failed");
      const text = await awaitWithAbort(response.text(), signal);
      if (text.length > 2_000_000) throw new Error("capture too large");
      const body = JSON.parse(text) as { result?: Record<string, unknown>; meta?: Record<string, unknown> };
      const result = (body.result ?? body) as Record<string, unknown>;
      const meta = body.meta ?? (result.meta as Record<string, unknown> | undefined) ?? {};
      const finalUrl = typeof meta.finalUrl === "string" ? meta.finalUrl : target.url;
      const final = normalizeAndValidateUrl(finalUrl);
      if (!final.ok || !isSameSite(final.url, root.url)) throw new Error("capture redirected away");
      if (meta.status !== undefined && (typeof meta.status !== "number" || meta.status < 200 || meta.status >= 300)) throw new Error("not a successful page");
      const html = result.content;
      const image = result.screenshot;
      if (typeof html !== "string" || typeof image !== "string" || image.length > 350_000 || !image.startsWith("/9j/")) throw new Error("invalid capture");
      const parsed = parseHtml(html, final.url.href);
      const pageHeading = `${parsed.page.title} ${parsed.page.headings.slice(0, 3).join(" ")}`;
      if (parsed.page.wordCount < 25 || /(?:^|\s)(?:404|page not found|page doesn't exist|service unavailable|sign in to continue|log in to continue)(?:\s|[.!|—-]|$)/i.test(pageHeading) || /\/(?:login|sign-in|signin|auth)(?:\/|$)/i.test(final.url.pathname) || /just a moment|access denied|attention required|verify you are human|checking your browser/i.test(`${parsed.page.title} ${parsed.page.textExcerpt.slice(0, 250)}`)) throw new Error("unusable page");
      const screenshot: PersistedVisualScreenshot = { id: await screenshotIdentity(runId, final.url.href, target.viewport), pageUrl: final.url.href, viewport: target.viewport, width: (options.viewport as { width: number }).width, height: (options.viewport as { height: number }).height, capturedAt: new Date().toISOString(), label: target.label, dataUrl: `data:image/jpeg;base64,${image}`, text: parsed.page.textExcerpt, links: parsed.links.slice(0, 60).map((link) => ({ ...link, foundOn: [final.url.href] })), page: EvidencePageSchema.parse({ ...parsed.page, status: typeof meta.status === "number" ? meta.status : 200 }) };
      return { screenshot, renderedPage: renderedPageObservation(runId, screenshot, html) };
    }));
    captures.forEach((result, index) => { if (result.status === "fulfilled") { screenshots.push(result.value.screenshot); renderedPages.push(result.value.renderedPage); } else limitations.push(`${targets[index]!.label} could not be captured reliably.`); });
    if (!modern) return { screenshots, limitations };
    const captureState = screenshots.length === targets.length ? "available" : screenshots.length > 0 ? "partial" : "unavailable";
    return { screenshots, renderedPages, limitations, availability: [availability(captureState, screenshots.length, limitations.length > 0 ? "One or more requested renders were unavailable." : undefined)], providerCalls };
  }
}
