import {
  ClientSchema,
  EvidenceBundleSchema,
  type Client,
  type EvidenceBundle,
  type EvidenceForm,
  type EvidenceLink,
  type EvidenceNetworkEvent,
  type EvidencePage,
} from "@/core/schema";
import type {
  EvidenceProvider,
  PageFetchResult,
  ProbeResult,
} from "@/ports/EvidenceProvider";

/**
 * A whole simulated website, not just the crawled slice of one.
 *
 * The engine's honesty depends on the difference between "the crawl did not see
 * a page" and "the page does not exist", so a benchmark fixture has to model
 * both: `pages` is everything the site really has, `crawled` is the subset the
 * bounded crawl returned. Targeted absence verification and status probes read
 * the full map, exactly as they would hit the real network.
 */

export interface SitePage {
  path: string;
  status?: number;
  title?: string;
  h1s?: string[];
  headings?: string[];
  words?: number;
  forms?: EvidenceForm[];
  /** Not returned by the bounded crawl, but reachable by a targeted fetch. */
  crawled?: boolean;
}

export interface SiteLink {
  href: string;
  label?: string;
  scheme?: "http" | "tel" | "mailto";
  inNav?: boolean;
  foundOn?: string[];
}

export interface SiteSpec {
  origin: string;
  pages: SitePage[];
  nav?: string[];
  links?: SiteLink[];
  sitemapPaths?: string[];
  networkEvents?: EvidenceNetworkEvent[];
  /** URLs the crawler was refused, e.g. by the SSRF policy. */
  blockedPaths?: string[];
  /** Targeted verification fetches fail this way (blocked/inconclusive). */
  fetchFailure?: { outcome: "blocked" | "inconclusive"; reason: string };
  /** Probes return no trustworthy status (403 / timeout / bot challenge). */
  probeInconclusive?: boolean;
}

function abs(origin: string, pathOrUrl: string): string {
  if (/^[a-z]+:/i.test(pathOrUrl)) return pathOrUrl;
  return new URL(pathOrUrl, origin).toString();
}

function toEvidencePage(origin: string, page: SitePage): EvidencePage {
  return {
    url: abs(origin, page.path),
    status: page.status ?? 200,
    title: page.title ?? "",
    h1s: page.h1s ?? [],
    headings: page.headings ?? [],
    textExcerpt: "",
    wordCount: page.words ?? ((page.status ?? 200) < 400 ? 220 : 0),
    forms: page.forms ?? [],
  };
}

function toEvidenceLink(origin: string, link: SiteLink): EvidenceLink {
  const scheme = link.scheme ?? "http";
  return {
    href: scheme === "http" ? abs(origin, link.href) : link.href,
    label: link.label ?? "",
    scheme,
    ariaLabel: "",
    title: "",
    inNav: link.inNav ?? false,
    inServiceNav: false,
    foundOn: (link.foundOn ?? ["/"]).map((p) => abs(origin, p)),
  };
}

/** The bounded crawl's view of the site. */
export function evidenceFor(clientId: string, spec: SiteSpec): EvidenceBundle {
  const crawled = spec.pages.filter((p) => p.crawled !== false);
  return EvidenceBundleSchema.parse({
    clientId,
    source: "http",
    capturedAt: "2026-09-01T12:00:00.000Z",
    site: {
      pages: crawled.map((p) => toEvidencePage(spec.origin, p)),
      nav: spec.nav ?? [],
      links: (spec.links ?? []).map((l) => toEvidenceLink(spec.origin, l)),
      sitemapUrls: (spec.sitemapPaths ?? []).map((p) => abs(spec.origin, p)),
    },
    networkEvents: [
      ...(spec.networkEvents ?? []),
      ...(spec.blockedPaths ?? []).map((p) => ({
        url: abs(spec.origin, p),
        outcome: "blocked" as const,
        reason: "URL policy refused this address.",
      })),
    ],
  });
}

/**
 * Evidence provider backed by a SiteSpec. `fetchPage` and `probe` answer from
 * the full page map — including pages the crawl never returned — so absence
 * verification and conversion probes behave as they would against the network.
 * Every call is counted, because an unbounded fixture would hide a real budget
 * regression.
 */
export class BenchEvidenceProvider implements EvidenceProvider {
  readonly fetches: string[] = [];
  readonly probes: string[] = [];
  private readonly byUrl: Map<string, SitePage>;

  constructor(
    private readonly clientId: string,
    private readonly spec: SiteSpec,
  ) {
    this.byUrl = new Map(
      spec.pages.map((p) => [abs(spec.origin, p.path), p]),
    );
  }

  getEvidence(): Promise<EvidenceBundle> {
    return Promise.resolve(evidenceFor(this.clientId, this.spec));
  }

  fetchPage(url: string): Promise<PageFetchResult> {
    this.fetches.push(url);
    if (this.spec.fetchFailure) {
      return Promise.resolve({
        kind: "network-failure" as const,
        requestedUrl: url,
        outcome: this.spec.fetchFailure.outcome,
        reason: this.spec.fetchFailure.reason,
      });
    }
    const page = this.byUrl.get(url);
    if (!page) return Promise.resolve(null);
    return Promise.resolve(toEvidencePage(this.spec.origin, page));
  }

  probe(url: string): Promise<ProbeResult> {
    this.probes.push(url);
    if (this.spec.probeInconclusive) {
      return Promise.resolve({
        requestedUrl: url,
        status: 0,
        finalUrl: url,
        ok: false,
        outcome: "inconclusive",
        reason: "No trustworthy status was obtained.",
      });
    }
    const page = this.byUrl.get(url);
    const status = page?.status ?? 404;
    return Promise.resolve({
      requestedUrl: url,
      status,
      finalUrl: url,
      ok: status >= 200 && status < 400,
      outcome: "complete",
    });
  }
}

export function clientFor(input: {
  id: string;
  name: string;
  origin: string;
  offerings: string[];
  notes?: string;
}): Client {
  return ClientSchema.parse({
    id: input.id,
    name: input.name,
    domain: new URL(input.origin).host,
    offerings: input.offerings,
    notes: input.notes ?? "",
  });
}
