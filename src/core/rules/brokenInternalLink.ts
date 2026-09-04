import type { Candidate, EvidenceLink } from "@/core/schema";
import type { ProbeResult } from "@/ports/EvidenceProvider";
import type { RuleContext } from "@/core/rules/context";
import { serviceForRule } from "@/core/rules/registry";
import { isSameSite, normalizeAndValidateUrl } from "@/adapters/evidence/urlPolicy";
import { pageCandidate } from "@/core/rules/technical";

const TAG = "broken-internal-link";

function normalizedUrl(value: string, base: string): string | null {
  const parsed = normalizeAndValidateUrl(value, base);
  return parsed.ok ? parsed.url.toString() : null;
}

function elementLabel(link: EvidenceLink): string {
  return link.label || link.ariaLabel || link.title || "(unlabelled)";
}

function definiteMissing(result: ProbeResult): boolean {
  return (
    (result.outcome === undefined || result.outcome === "complete") &&
    (result.status === 404 || result.status === 410)
  );
}

interface BrokenTarget {
  target: string;
  status: 404 | 410;
  foundOn: string[];
  label: string;
}

/**
 * Reports same-site links only when their target has a definite HTTP 404/410.
 * Timeouts, blocked probes, 5xx responses and all other statuses are unknown.
 */
export async function brokenInternalLinkRule(ctx: RuleContext): Promise<Candidate[]> {
  const service = serviceForRule(ctx.catalog, TAG);
  if (!service) return [];

  const firstPage = ctx.evidence.site.pages[0]?.url;
  if (!firstPage) return [];
  const base = new URL(firstPage);
  base.pathname = "/";
  base.search = "";
  base.hash = "";
  const pageByUrl = new Map<string, { status: number }>();
  for (const page of ctx.evidence.site.pages) {
    const url = normalizedUrl(page.url, base.toString());
    if (url) pageByUrl.set(url, page);
  }

  const budget = ctx.probeBudget ?? { remaining: 8 };
  const targets = new Map<string, BrokenTarget>();
  for (const link of ctx.evidence.site.links) {
    if (link.scheme !== "http") continue;
    let target: string | null;
    try {
      target = normalizedUrl(link.href, base.toString());
    } catch {
      target = null;
    }
    if (!target) continue;
    const parsedTarget = new URL(target);
    if (!isSameSite(parsedTarget, base)) continue;

    const crawled = pageByUrl.get(target);
    let status: 404 | 410 | undefined;
    if (crawled?.status === 404 || crawled?.status === 410) {
      status = crawled.status;
    } else if (!crawled && ctx.probe && budget.remaining > 0) {
      budget.remaining--;
      const result = await ctx.probe(target);
      if (definiteMissing(result)) status = result.status === 404 ? 404 : 410;
    }
    if (status === undefined) continue;

    const existing = targets.get(target);
    if (existing) {
      existing.foundOn = [...new Set([...existing.foundOn, ...link.foundOn])];
      if (existing.label === "(unlabelled)") existing.label = elementLabel(link);
      continue;
    }
    targets.set(target, {
      target,
      status,
      foundOn: [...link.foundOn],
      label: elementLabel(link),
    });
  }

  return [...targets.values()].map((broken) =>
    pageCandidate({
      ruleId: "broken-internal-link",
      subject: broken.target,
      detected:
        `The internal link "${broken.label}" on ${broken.foundOn[0] ?? base.origin} ` +
        `points to ${broken.target}, which returned HTTP ${broken.status}.`,
      evidenceRefs: [
        ...broken.foundOn.map((url) => `page:${url}`),
        `target:${broken.target}`,
        `status:${broken.status}`,
      ],
      suggestedServiceId: service.id,
      rawConfidence: 0.95,
    }),
  );
}
