import type { Candidate, EvidenceBundle, EvidencePage, RuleId } from "@/core/schema";
import { normalizeAndValidateUrl, isSameSite } from "@/adapters/evidence/urlPolicy";
import {
  isArchivePath,
  isEditorialPath,
  looksLikeServiceUrl,
} from "@/core/siteStructure";

/** The directly observed technical defects added with the expanded rule set. */
export const TECHNICAL_RULE_IDS = [
  "missing-title",
  "duplicate-title",
  "thin-service-page",
  "missing-h1",
  "broken-internal-link",
  "missing-meta-description",
  "missing-structured-data",
  "missing-image-alt",
] as const satisfies readonly RuleId[];

export type TechnicalRuleId = (typeof TECHNICAL_RULE_IDS)[number];

export function isTechnicalRuleId(ruleId: RuleId): ruleId is TechnicalRuleId {
  return (TECHNICAL_RULE_IDS as readonly string[]).includes(ruleId);
}

export function isReadablePage(page: EvidencePage): boolean {
  return page.status >= 200 && page.status < 300 && page.wordCount > 0;
}

export function normalizedTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Service shaped pages exclude editorial and archive paths. */
export function isServiceShapedPage(url: string): boolean {
  return looksLikeServiceUrl(url) && !isEditorialPath(url) && !isArchivePath(url);
}

/** Structured data is checked on the homepage and service shaped pages. */
export function isStructuredDataRelevantPage(page: EvidencePage): boolean {
  try {
    const parsed = new URL(page.url);
    return parsed.pathname === "/" || parsed.pathname === "" || isServiceShapedPage(page.url);
  } catch {
    return false;
  }
}

export function pageCandidate(input: {
  ruleId: TechnicalRuleId;
  subject: string;
  detected: string;
  evidenceRefs: string[];
  suggestedServiceId: string;
  rawConfidence?: number;
}): Candidate {
  return {
    ruleId: input.ruleId,
    subject: input.subject,
    detected: input.detected,
    evidenceRefs: input.evidenceRefs,
    rawConfidence: input.rawConfidence ?? 0.9,
    suggestedServiceId: input.suggestedServiceId,
  };
}

function normalizedPageUrl(url: string): string | null {
  const parsed = normalizeAndValidateUrl(url);
  return parsed.ok ? parsed.url.toString() : null;
}

function knownPageUrls(evidence: EvidenceBundle): Set<string> {
  return new Set(
    evidence.site.pages
      .map((page) => normalizedPageUrl(page.url))
      .filter((url): url is string => url !== null),
  );
}

function readablePageUrls(evidence: EvidenceBundle): Set<string> {
  return new Set(
    evidence.site.pages
      .filter(isReadablePage)
      .map((page) => normalizedPageUrl(page.url))
      .filter((url): url is string => url !== null),
  );
}

/**
 * A technical rule may close an older finding only after the relevant evidence
 * was complete on this run. An absent optional parser field is deliberately
 * treated as unknown, even when the crawl itself was exhaustive.
 */
export function canReconcileTechnicalRule(
  ruleId: RuleId,
  evidence: EvidenceBundle,
): boolean {
  if (!isTechnicalRuleId(ruleId)) return false;
  if (!evidence.site.crawlExhaustive || evidence.networkEvents.length > 0) return false;

  const readablePages = evidence.site.pages.filter(isReadablePage);
  if (readablePages.length === 0) return false;
  // A successful response with no readable body is not a page we can vouch
  // for. It may be an empty shell or a partial fetch, so do not close a prior
  // finding merely because other pages in the crawl were readable.
  if (
    evidence.site.pages.some(
      (page) => page.status >= 200 && page.status < 300 && page.wordCount === 0,
    )
  ) {
    return false;
  }

  if (ruleId === "missing-meta-description") {
    return readablePages.every((page) => page.metaDescription !== undefined);
  }
  if (ruleId === "missing-structured-data") {
    const relevantPages = readablePages.filter(isStructuredDataRelevantPage);
    return (
      relevantPages.length > 0 &&
      relevantPages.every(
        (page) =>
          page.structuredDataTypes !== undefined &&
          (page.structuredDataPresent !== undefined ||
            page.structuredDataTypes.length === 0),
      )
    );
  }
  if (ruleId === "missing-image-alt") {
    return readablePages.every((page) => page.images !== undefined);
  }

  if (ruleId === "broken-internal-link") {
    const originPage = readablePages[0]?.url;
    if (!originPage) return false;
    const base = new URL(originPage);
    base.pathname = "/";
    base.search = "";
    base.hash = "";
    const pageUrls = knownPageUrls(evidence);
    // An exhaustive crawl should have a status for every same-site target. If
    // one is missing, the current bundle cannot prove a prior broken link was
    // repaired, so leave it open for a later run.
    return evidence.site.links
      .filter((link) => link.scheme === "http")
      .every((link) => {
        let target: string | null;
        try {
          target = normalizedPageUrl(new URL(link.href, base).toString());
        } catch {
          return false;
        }
        if (!target) return false;
        const parsedTarget = new URL(target);
        return !isSameSite(parsedTarget, base) || pageUrls.has(target);
      });
  }

  // title, duplicate-title, thin-service-page and missing-h1 use fields that
  // were already present in legacy bundles, so an exhaustive readable crawl
  // is sufficient for their closure decision.
  return true;
}

/**
 * A complete crawl still cannot close a page finding when that particular page
 * was absent or unreadable in the bundle. This keeps a not-revisited, failed,
 * or unlinked page from being mistaken for a repaired one.
 */
export function technicalSubjectWasRevisited(input: {
  ruleId: RuleId;
  subject: string;
  evidenceRefs: string[];
  evidence: EvidenceBundle;
}): boolean {
  if (!isTechnicalRuleId(input.ruleId)) return false;
  const pageUrls = readablePageUrls(input.evidence);

  if (input.ruleId === "duplicate-title") {
    const referencedPages = input.evidenceRefs
      .filter((ref) => ref.startsWith("page:"))
      .map((ref) => normalizedPageUrl(ref.slice("page:".length)))
      .filter((url): url is string => url !== null);
    return referencedPages.length > 0 && referencedPages.every((url) => pageUrls.has(url));
  }

  if (input.ruleId === "broken-internal-link") {
    // A broken-link finding names both the page that contained the link and
    // its target. Requiring both to be present keeps an exhaustive crawl from
    // resolving an old finding when either side was skipped or never fetched.
    const referencedUrls = input.evidenceRefs
      .filter((ref) => ref.startsWith("page:") || ref.startsWith("target:"))
      .map((ref) => normalizedPageUrl(ref.slice(ref.indexOf(":") + 1)))
      .filter((url): url is string => url !== null);
    return referencedUrls.length > 0 && referencedUrls.every((url) => pageUrls.has(url));
  }

  const subject = normalizedPageUrl(input.subject);
  return subject !== null && pageUrls.has(subject);
}
