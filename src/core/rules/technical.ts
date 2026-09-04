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

/**
 * One deliberately modest starter range per site-level technical repair. These
 * are defaults for new agency catalogs, not a price override for work an agency
 * has already priced for itself.
 */
export const TECHNICAL_STARTER_PRICE_BANDS = {
  "missing-title": { min: 150, max: 300 },
  "duplicate-title": { min: 200, max: 400 },
  "thin-service-page": { min: 400, max: 800 },
  "missing-h1": { min: 150, max: 300 },
  "broken-internal-link": { min: 200, max: 500 },
  "missing-meta-description": { min: 200, max: 500 },
  "missing-structured-data": { min: 300, max: 700 },
  "missing-image-alt": { min: 150, max: 400 },
} as const satisfies Record<TechnicalRuleId, { min: number; max: number }>;

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

/**
 * Turn directly observed page/target defects into one honest, sellable repair
 * per site and issue type. The individual rules deliberately stay literal and
 * narrow; centralising the grouping here stops the UI from inventing a project
 * price for every page where the same repair is needed.
 */
export function aggregateTechnicalCandidates(input: {
  client: { domain: string };
  candidates: Candidate[];
  /** Page refs carried from dismissed legacy findings, scoped to their rule. */
  suppressedEvidenceRefsByRule?: Partial<Record<TechnicalRuleId, readonly string[]>>;
}): Candidate[] {
  const grouped = new Map<TechnicalRuleId, Candidate[]>();
  for (const candidate of input.candidates) {
    if (!isTechnicalRuleId(candidate.ruleId)) continue;
    const group = grouped.get(candidate.ruleId) ?? [];
    group.push(candidate);
    grouped.set(candidate.ruleId, group);
  }

  const aggregateByRule = new Map<TechnicalRuleId, Candidate>();
  for (const ruleId of TECHNICAL_RULE_IDS) {
    const aggregate = aggregateTechnicalGroup({
      ruleId,
      candidates: grouped.get(ruleId) ?? [],
      domain: input.client.domain,
      suppressedEvidenceRefs: input.suppressedEvidenceRefsByRule?.[ruleId] ?? [],
    });
    if (aggregate) aggregateByRule.set(ruleId, aggregate);
  }

  // Keep non-technical candidates untouched and preserve rule ordering: the
  // aggregate occupies the first position where that technical rule appeared.
  const emitted = new Set<TechnicalRuleId>();
  const result: Candidate[] = [];
  for (const candidate of input.candidates) {
    if (!isTechnicalRuleId(candidate.ruleId)) {
      result.push(candidate);
      continue;
    }
    if (emitted.has(candidate.ruleId)) continue;
    emitted.add(candidate.ruleId);
    const aggregate = aggregateByRule.get(candidate.ruleId);
    if (aggregate) result.push(aggregate);
  }
  return result;
}

function aggregateTechnicalGroup(input: {
  ruleId: TechnicalRuleId;
  candidates: Candidate[];
  domain: string;
  suppressedEvidenceRefs: readonly string[];
}): Candidate | null {
  const contributing: Candidate[] = [];
  const suppressedPages = new Set(
    input.suppressedEvidenceRefs.filter((ref) => ref.startsWith("page:")),
  );

  for (const candidate of input.candidates) {
    const pageRefs = candidate.evidenceRefs.filter((ref) => ref.startsWith("page:"));
    const keptPageRefs = pageRefs.filter((ref) => !suppressedPages.has(ref));

    // Page-scoped candidates are fully dismissed when their only page is
    // suppressed. A duplicate title needs two remaining pages to still be a
    // duplicate; a broken target may remain if a different source page still
    // links to it.
    if (pageRefs.length > 0 && keptPageRefs.length === 0) continue;
    if (input.ruleId === "duplicate-title" && keptPageRefs.length < 2) continue;

    const evidenceRefs = candidate.evidenceRefs.filter(
      (ref) => !ref.startsWith("page:") || !suppressedPages.has(ref),
    );
    contributing.push({ ...candidate, evidenceRefs });
  }

  if (contributing.length === 0) return null;

  const evidenceRefs = unique(
    contributing.flatMap((candidate) => candidate.evidenceRefs),
  );
  const pageCount = evidenceRefs.filter((ref) => ref.startsWith("page:")).length;
  const targetCount = evidenceRefs.filter((ref) => ref.startsWith("target:")).length;
  const imageCount = contributing.reduce(
    (total, candidate) =>
      total +
      candidate.evidenceRefs.reduce((sum, ref) => sum + missingImageCount(ref), 0),
    0,
  );
  const first = contributing[0]!;

  return {
    ruleId: input.ruleId,
    subject: input.domain,
    detected: aggregateDetected({
      ruleId: input.ruleId,
      pageCount,
      targetCount,
      imageCount,
    }),
    evidenceRefs,
    // Keep every historic suppression, even when the page happens not to be
    // defective in this crawl. Otherwise a later regression could quietly turn
    // an old dismissal back into a new opportunity.
    suppressedEvidenceRefs: unique(input.suppressedEvidenceRefs),
    rawConfidence: Math.min(...contributing.map((candidate) => candidate.rawConfidence)),
    suggestedServiceId: first.suggestedServiceId,
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function missingImageCount(ref: string): number {
  const match = /^images-without-alt:(\d+)$/.exec(ref);
  return match ? Number(match[1]) : 0;
}

function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function aggregateDetected(input: {
  ruleId: TechnicalRuleId;
  pageCount: number;
  targetCount: number;
  imageCount: number;
}): string {
  const pages = count(input.pageCount, "affected page");
  switch (input.ruleId) {
    case "missing-title":
      return `${pages} ${input.pageCount === 1 ? "is" : "are"} missing a non-empty HTML title.`;
    case "duplicate-title":
      return `Duplicate HTML titles affect ${pages}.`;
    case "thin-service-page":
      return `${pages} ${input.pageCount === 1 ? "is" : "are"} below the technical content threshold.`;
    case "missing-h1":
      return `${pages} ${input.pageCount === 1 ? "has" : "have"} no non-empty H1 heading.`;
    case "broken-internal-link":
      return `${count(input.targetCount, "verified broken internal-link target")} ${
        input.targetCount === 1 ? "is" : "are"
      } linked from ${pages}.`;
    case "missing-meta-description":
      return `${pages} ${input.pageCount === 1 ? "is" : "are"} missing a non-empty meta description.`;
    case "missing-structured-data":
      return `${pages} ${input.pageCount === 1 ? "has" : "have"} no observed LocalBusiness or Service structured-data type.`;
    case "missing-image-alt":
      return `${count(input.imageCount, "image")} across ${pages} ${
        input.imageCount === 1 ? "is" : "are"
      } missing an alt attribute; decorative alt="" images are excluded.`;
  }
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

  // Site-level aggregates carry every affected page in their evidence. This is
  // deliberately checked before the old page-subject fallback: the aggregate's
  // subject is a domain, not a fetchable URL, and every old affected page must
  // have been read again before a partial repair can be called complete.
  const referencedPages = input.evidenceRefs
    .filter((ref) => ref.startsWith("page:"))
    .map((ref) => normalizedPageUrl(ref.slice("page:".length)))
    .filter((url): url is string => url !== null);

  if (input.ruleId === "duplicate-title") {
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

  if (referencedPages.length > 0) {
    return referencedPages.every((url) => pageUrls.has(url));
  }

  const subject = normalizedPageUrl(input.subject);
  return subject !== null && pageUrls.has(subject);
}
