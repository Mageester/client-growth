import { crawlKey } from "@/adapters/evidence/urlPolicy";
import { CloudflareVisualCapture, type BrowserQuickAction, type VisualCaptureOptions, type VisualCaptureResult } from "@/adapters/evidence/CloudflareVisualCapture";
import { DeepSeekVisualReviewer } from "@/adapters/evaluator/DeepSeekVisualReviewer";
import { saveVisualScreenshots } from "@/db/visualScreenshots";
import type { TenantScope } from "@/db/tenant";
import type { Client, EvidenceBundle, Service } from "@/core/schema";
import type { VisualReview } from "@/core/visualSchema";

export interface VisualReviewEnvironment {
  AI_PROVIDER?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_VISION_MODEL?: string;
  BROWSER?: BrowserQuickAction;
}

export function visualReviewAvailable(env: VisualReviewEnvironment): boolean {
  return env.AI_PROVIDER === "deepseek" && typeof env.DEEPSEEK_API_KEY === "string" && Boolean(env.DEEPSEEK_API_KEY.trim()) && Boolean(env.BROWSER);
}

export function visualServices(catalog: readonly Service[]): Service[] {
  return catalog.filter((service) => service.active && (service.tags.includes("visual-review") || service.tags.some((tag) => ["landing-page", "service-pages-build", "conversion-fix", "competitor-gap"].includes(tag)) || /web(?:site)? design|redesign|conversion|ux|user experience/i.test(service.name)));
}

type VisualEvidenceBundle = EvidenceBundle & {
  visualReview?: VisualReview;
  renderedPages?: unknown[];
  evidenceAvailability?: unknown[];
  site: EvidenceBundle["site"] & { coverage?: { renderedUrls?: number; screenshotsCaptured?: number } };
};

export async function reviewClientVisually(
  t: TenantScope,
  env: VisualReviewEnvironment,
  client: Client,
  catalog: readonly Service[],
  evidenceInput: EvidenceBundle,
  captureOptions: VisualCaptureOptions,
  signal?: AbortSignal,
  onAnalysisStart?: () => void | Promise<void>,
  fetchImpl?: typeof fetch,
): Promise<VisualReview> {
  if (!env.BROWSER) throw new Error("Visual review requires a browser binding");
  const evidence = evidenceInput as VisualEvidenceBundle;
  const captured = await new CloudflareVisualCapture(env.BROWSER).capture(client, evidenceInput, { ...captureOptions, signal }) as VisualCaptureResult;
  evidence.evidenceAvailability = [...(evidence.evidenceAvailability ?? []), ...captured.availability].slice(0, 20);
  if (!captured.screenshots.length) {
    return {
      status: "unavailable",
      model: "",
      providerCalls: 0,
      summary: "The website could not be reviewed visually.",
      strengths: [],
      findings: [],
      screenshots: [],
      limitations: captured.limitations,
      accounting: { state: "unavailable", suggestions: 0, accepted: 0, rejected: 0, truncated: 0, capped: false, limitations: captured.limitations.slice(0, 100) },
    };
  }
  await onAnalysisStart?.();
  const reviewer = new DeepSeekVisualReviewer({ apiKey: String(env.DEEPSEEK_API_KEY), model: env.DEEPSEEK_VISION_MODEL, baseUrl: env.DEEPSEEK_BASE_URL, fetchImpl });
  const mappedServices = visualServices(catalog);
  const review = await reviewer.review({ client, catalog: mappedServices, screenshots: captured.screenshots, renderedPages: captured.renderedPages, contextPages: evidenceInput.site.pages, signal, mode: mappedServices.length > 0 ? "legacy" : "shadow" });
  if (signal?.aborted) throw signal.reason ?? new Error("Visual review aborted");
  const accepted = captured.screenshots.filter((screenshot) => review.screenshots.some((metadata) => metadata.id === screenshot.id));
  const acceptedScreenshotIds = new Set(accepted.map((screenshot) => screenshot.id));
  evidence.renderedPages = captured.renderedPages.filter((page) => acceptedScreenshotIds.has(page.screenshotId));
  await saveVisualScreenshots(t, client.id, accepted);
  if (evidence.site.coverage) {
    evidence.site.coverage.renderedUrls = new Set(accepted.map((screenshot) => screenshot.pageUrl)).size;
    evidence.site.coverage.screenshotsCaptured = accepted.length;
  }
  for (const screenshot of accepted) {
    const existing = evidence.site.pages.find((page) => crawlKey(page.url) === crawlKey(screenshot.pageUrl));
    if (!existing || existing.wordCount === 0) {
      evidence.site.pages = evidence.site.pages.filter((page) => crawlKey(page.url) !== crawlKey(screenshot.pageUrl));
      evidence.site.pages.push(screenshot.page);
      evidence.site.crawlExhaustive = false;
    }
  }
  const limitations = [...captured.limitations, ...review.limitations].slice(0, 12);
  return { ...review, status: captured.limitations.length ? "partial" : review.status, limitations, accounting: review.accounting ? { ...review.accounting, state: captured.limitations.length > 0 ? "partial" : review.accounting.state, limitations: [...captured.limitations, ...review.accounting.limitations].slice(0, 100) } : review.accounting };
}
