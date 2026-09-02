/**
 * Analyzability benchmark.
 *
 *   pnpm analyzability                 replay the cache; fetch anything new
 *   pnpm analyzability --offline       replay only; fail loudly on a cache miss
 *   pnpm analyzability --only=id,id    a subset of the corpus
 *   pnpm analyzability --json=path     also write the full machine report
 *
 * It answers one question: on real small-business websites, what percentage can
 * Client Growth analyze TRUTHFULLY — reach the part of the site where services
 * are described — and when it cannot, whose fault is that?
 *
 * It runs the real HttpEvidenceProvider and the real coverage assessment, so
 * the numbers are the product's numbers, not a simulation. It does NOT call the
 * evaluator: no AI, no spend, no opportunity is ever created, and no production
 * client data is touched.
 *
 * Failure classification (assigned deterministically from the crawl, then
 * checked against the human reviewer's judgment recorded in corpus.ts):
 *
 *   A CLIENT_SETUP     the site was read fine; the client profile is too thin
 *   B CRAWLER_DISCOVERY  service pages demonstrably exist and were not reached
 *   C SITE_TOO_THIN    the site genuinely has no service content
 *   D BLOCKED          bot protection, network failure, non-HTML responses
 *   E OTHER            none of the above fits
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { assessServiceCoverage } from "@/core/absenceVerification";
import { measureEvidenceReach } from "@/core/analysisOutcome";
import { ClientSchema, type EvidenceBundle } from "@/core/schema";
import { suggestOfferings } from "@/core/offeringSuggestions";
import { looksLikeServiceUrl, pathSegments } from "@/core/siteStructure";

import { createCachingFetch, type CacheStats } from "./cache";
import { CORPUS, type CorpusSite } from "./corpus";

const CACHE_DIR = join(process.cwd(), ".analyzability-cache");

export const FAILURE_CATEGORIES = [
  "CLIENT_SETUP",
  "CRAWLER_DISCOVERY",
  "SITE_TOO_THIN",
  "BLOCKED",
  "OTHER",
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export interface SiteReport {
  id: string;
  domain: string;
  vertical: string;
  analyzable: boolean;
  reason: string;
  pagesFetched: number;
  pagesReadable: number;
  sitemapAvailable: boolean;
  sitemapUrls: number;
  linksDiscovered: number;
  serviceLikePages: number;
  serviceLikeSitemapUrls: number;
  /**
   * The strict version of the question: pages BELOW the homepage that were
   * actually fetched, actually read, and whose own URL says they describe a
   * service. "Analyzable" can be satisfied by reading a homepage navigation;
   * this cannot, so the gap between the two is where over-claiming would hide.
   */
  serviceContentPagesRead: number;
  representedOfferings: number;
  offerings: number;
  blockedEvents: number;
  inconclusiveEvents: number;
  /** Live + replayed HTTP requests the provider issued for this site. */
  requests: number;
  reviewerSaysServicePagesExist: boolean | "unknown";
  /** True when the reviewer says service pages exist and the crawl missed them. */
  crawlerMissedObviousPages: boolean;
  /**
   * Claimed analyzable on a site the reviewer says has no service pages at all.
   * This is the number that must never rise: it is the product telling an
   * agency it checked something it did not.
   */
  falseAnalyzable: boolean;
  failure: FailureCategory | null;
  failureNote: string;
  /** Offerings the site's own evidence suggests, for the setup-assistance path. */
  suggestions: Array<{ label: string; confidence: string; evidence: string[] }>;
  errored: string | null;
}

/** Requests the provider issued, inferred from the cache counters it moved. */
function requestDelta(before: CacheStats, after: CacheStats): number {
  return after.hits - before.hits + (after.misses - before.misses) + (after.errors - before.errors);
}

function classify(input: {
  site: CorpusSite;
  evidence: EvidenceBundle;
  analyzable: boolean;
  readablePages: number;
  serviceLikePages: number;
  serviceLikeSitemapUrls: number;
  representedOfferings: number;
  suggestions: number;
}): { failure: FailureCategory | null; note: string; missedObvious: boolean } {
  if (input.analyzable) return { failure: null, note: "", missedObvious: false };

  if (input.readablePages === 0) {
    const blocked = input.evidence.networkEvents.filter((e) => e.outcome === "blocked").length;
    return {
      failure: "BLOCKED",
      note: blocked > 0
        ? "The URL policy refused every request to this domain."
        : "No page returned readable HTML — bot protection, a JavaScript-only shell, or a transport failure.",
      missedObvious: input.site.reviewerSaysServicePagesExist === true,
    };
  }

  // The site was read. Whose gap is it? The reviewer's judgment decides between
  // "the crawler missed pages that plainly exist" and "there is nothing there".
  if (input.site.reviewerSaysServicePagesExist === false) {
    return {
      failure: "SITE_TOO_THIN",
      note: "The site genuinely has no service content to reach.",
      missedObvious: false,
    };
  }

  if (input.site.reviewerSaysServicePagesExist === true) {
    // Service structure was reached, but the client's own profile is too small
    // to be matched against it — that is a setup problem, not a crawl problem.
    const structureReached = input.serviceLikePages >= 1 || input.serviceLikeSitemapUrls >= 1;
    if (structureReached && input.site.offerings.length < 2) {
      return {
        failure: "CLIENT_SETUP",
        note: `The crawl reached service structure but the client profile has ${input.site.offerings.length} offering(s)${
          input.suggestions > 0 ? `; ${input.suggestions} could be suggested from the site itself` : ""
        }.`,
        missedObvious: false,
      };
    }
    return {
      failure: "CRAWLER_DISCOVERY",
      note: `The reviewer says service pages exist; the crawl reached ${input.serviceLikePages} service-like page(s) and ${input.serviceLikeSitemapUrls} service-like sitemap URL(s).`,
      missedObvious: true,
    };
  }

  return {
    failure: "OTHER",
    note: "No reviewer judgment is recorded for this site, so the failure cannot be attributed.",
    missedObvious: false,
  };
}

async function measure(
  site: CorpusSite,
  fetchImpl: typeof fetch,
  stats: CacheStats,
): Promise<SiteReport> {
  const before = { ...stats };
  const provider = new HttpEvidenceProvider({ fetchImpl, maxPages: 10 });
  const client = ClientSchema.parse({
    id: `bench-${site.id}`,
    name: site.id,
    domain: site.domain,
    offerings: site.offerings,
    notes: "",
  });

  let evidence: EvidenceBundle;
  try {
    evidence = await provider.getEvidence(client);
  } catch (err) {
    return {
      id: site.id,
      domain: site.domain,
      vertical: site.vertical,
      analyzable: false,
      reason: "the crawl threw",
      pagesFetched: 0,
      pagesReadable: 0,
      sitemapAvailable: false,
      sitemapUrls: 0,
      linksDiscovered: 0,
      serviceLikePages: 0,
      serviceLikeSitemapUrls: 0,
      serviceContentPagesRead: 0,
      representedOfferings: 0,
      offerings: site.offerings.length,
      blockedEvents: 0,
      inconclusiveEvents: 0,
      requests: requestDelta(before, stats),
      reviewerSaysServicePagesExist: site.reviewerSaysServicePagesExist,
      crawlerMissedObviousPages: false,
      falseAnalyzable: false,
      failure: "OTHER",
      failureNote: (err as Error).message,
      suggestions: [],
      errored: (err as Error).message,
    };
  }

  const coverage = assessServiceCoverage({ client, evidence });
  const reach = measureEvidenceReach(evidence);
  const serviceContentPagesRead = evidence.site.pages.filter(
    (page) =>
      page.status >= 200 &&
      page.status < 300 &&
      page.wordCount > 0 &&
      pathSegments(page.url).length > 0 &&
      looksLikeServiceUrl(page.url),
  ).length;
  const suggested = suggestOfferings({ evidence, existingOfferings: site.offerings });
  const classified = classify({
    site,
    evidence,
    analyzable: coverage.analyzable,
    readablePages: reach.readablePages,
    serviceLikePages: coverage.serviceLikePages,
    serviceLikeSitemapUrls: coverage.serviceLikeSitemapUrls,
    representedOfferings: coverage.representedOfferings,
    suggestions: suggested.length,
  });

  return {
    id: site.id,
    domain: site.domain,
    vertical: site.vertical,
    analyzable: coverage.analyzable,
    reason: coverage.reason,
    pagesFetched: reach.fetchedPages,
    pagesReadable: reach.readablePages,
    sitemapAvailable: evidence.site.sitemapUrls.length > 0,
    sitemapUrls: evidence.site.sitemapUrls.length,
    linksDiscovered: evidence.site.links.length,
    serviceLikePages: coverage.serviceLikePages,
    serviceLikeSitemapUrls: coverage.serviceLikeSitemapUrls,
    serviceContentPagesRead,
    representedOfferings: coverage.representedOfferings,
    offerings: site.offerings.length,
    blockedEvents: reach.blockedEvents,
    inconclusiveEvents: reach.inconclusiveEvents,
    requests: requestDelta(before, stats),
    reviewerSaysServicePagesExist: site.reviewerSaysServicePagesExist,
    crawlerMissedObviousPages: classified.missedObvious,
    falseAnalyzable: coverage.analyzable && site.reviewerSaysServicePagesExist === false,
    failure: classified.failure,
    failureNote: classified.note,
    suggestions: suggested.map((s) => ({
      label: s.label,
      confidence: s.confidence,
      evidence: s.evidence.map((e) => e.detail),
    })),
    errored: null,
  };
}

function pct(n: number, total: number): string {
  return total === 0 ? "—" : `${Math.round((n / total) * 100)}%`;
}

function print(reports: SiteReport[], cache: CacheStats): void {
  const pad = 22;
  console.log("");
  console.log(
    "site".padEnd(pad) +
      "verdict".padEnd(15) +
      "pg".padEnd(4) +
      "rd".padEnd(4) +
      "sm".padEnd(5) +
      "lnk".padEnd(6) +
      "svcPg".padEnd(7) +
      "svcSm".padEnd(7) +
      "read".padEnd(6) +
      "rep".padEnd(5) +
      "req".padEnd(5) +
      "failure",
  );
  console.log("-".repeat(118));
  for (const r of reports) {
    console.log(
      r.id.slice(0, pad - 1).padEnd(pad) +
        (r.analyzable ? "ANALYZABLE" : "inconclusive").padEnd(15) +
        String(r.pagesFetched).padEnd(4) +
        String(r.pagesReadable).padEnd(4) +
        String(r.sitemapUrls).padEnd(5) +
        String(r.linksDiscovered).padEnd(6) +
        String(r.serviceLikePages).padEnd(7) +
        String(r.serviceLikeSitemapUrls).padEnd(7) +
        String(r.serviceContentPagesRead).padEnd(6) +
        `${r.representedOfferings}/${r.offerings}`.padEnd(5) +
        String(r.requests).padEnd(5) +
        (r.failure ?? ""),
    );
    if (r.failure) console.log("".padEnd(pad) + "↳ " + r.failureNote);
  }

  const total = reports.length;
  const analyzable = reports.filter((r) => r.analyzable).length;
  console.log("-".repeat(118));
  const readService = reports.filter((r) => r.serviceContentPagesRead > 0).length;
  const falseAnalyzable = reports.filter((r) => r.falseAnalyzable);
  console.log(`ANALYZABLE ${analyzable}/${total} (${pct(analyzable, total)})`);
  console.log(
    `read actual service content on ${readService}/${total} (${pct(readService, total)})`,
  );
  console.log(
    falseAnalyzable.length === 0
      ? "false analyzable: none"
      : `FALSE ANALYZABLE ${falseAnalyzable.length}: ${falseAnalyzable.map((r) => r.id).join(", ")}`,
  );

  const counts = new Map<string, number>();
  for (const r of reports) {
    if (r.failure) counts.set(r.failure, (counts.get(r.failure) ?? 0) + 1);
  }
  const byCategory = FAILURE_CATEGORIES.map((c) => `${c} ${counts.get(c) ?? 0}`).join("   ");
  console.log(byCategory);

  const requests = reports.map((r) => r.requests);
  const sum = requests.reduce((a, b) => a + b, 0);
  console.log(
    `requests: total ${sum}, avg ${(sum / Math.max(1, total)).toFixed(1)}, max ${Math.max(0, ...requests)}`,
  );
  console.log(
    `crawler missed obvious service pages on ${reports.filter((r) => r.crawlerMissedObviousPages).length} site(s)`,
  );
  console.log(
    `cache: ${cache.hits} replayed, ${cache.misses} fetched, ${cache.errors} errored, ${cache.refused} refused`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const offline = args.includes("--offline");
  const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length);
  const jsonPath = args.find((a) => a.startsWith("--json="))?.slice("--json=".length);
  const wanted = only ? new Set(only.split(",").map((s) => s.trim())) : null;
  const sites = CORPUS.filter((s) => !wanted || wanted.has(s.id));

  const { fetchImpl, stats } = createCachingFetch({
    dir: CACHE_DIR,
    allowNetwork: !offline,
    maxLiveRequests: 1_200,
  });

  const reports: SiteReport[] = [];
  for (const site of sites) {
    reports.push(await measure(site, fetchImpl, stats));
  }

  print(reports, stats);

  if (jsonPath) {
    const path = join(process.cwd(), jsonPath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2),
      "utf8",
    );
    console.log(`\nwrote ${jsonPath}`);
  }
}

void main();
