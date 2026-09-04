import { describe, expect, it, vi } from "vitest";

import { analyzeClient } from "@/pipeline/analyzeClient";
import { dedupeKey } from "@/core/dedupe";
import {
  ClientSchema,
  EvidenceBundleSchema,
  OpportunitySchema,
  ServiceSchema,
  type EvidenceBundle,
  type Opportunity,
  type Service,
} from "@/core/schema";
import type { EvidenceProvider, ProbeResult } from "@/ports/EvidenceProvider";

const ORIGIN = "https://technical-pipeline.example";
const ROOT = `${ORIGIN}/`;
const client = ClientSchema.parse({
  id: "client-technical-pipeline",
  name: "Technical Pipeline",
  domain: "technical-pipeline.example",
  offerings: [],
  notes: "",
});

const TAGS = [
  "missing-title",
  "duplicate-title",
  "thin-service-page",
  "missing-h1",
  "broken-internal-link",
  "missing-meta-description",
  "missing-structured-data",
  "missing-image-alt",
] as const;

const catalog: Service[] = TAGS.map((tag, index) =>
  ServiceSchema.parse({
    id: `svc-${tag}`,
    name: tag,
    description: "",
    priceMin: 200 + index,
    priceMax: 700 + index,
    tags: [tag],
    active: true,
  }),
);

function fullEvidence(): EvidenceBundle {
  return EvidenceBundleSchema.parse({
    clientId: client.id,
    source: "fixture",
    capturedAt: "2026-09-04T00:00:00.000Z",
    site: {
      pages: [
        {
          url: ROOT,
          status: 200,
          title: "",
          h1s: [],
          headings: [],
          textExcerpt: "Readable home page.",
          wordCount: 220,
          forms: [],
          metaDescription: "",
          structuredDataTypes: [],
          images: [{ src: "/hero.jpg" }, { src: "/ornament.svg", alt: "" }],
        },
        {
          url: `${ORIGIN}/services/repair`,
          status: 200,
          title: "Shared title",
          h1s: ["Repair"],
          headings: [],
          textExcerpt: "Short service page.",
          wordCount: 80,
          forms: [],
          metaDescription: "Repair services",
          structuredDataTypes: ["Service"],
          images: [],
        },
        {
          url: `${ORIGIN}/about`,
          status: 200,
          title: "Shared title",
          h1s: ["About"],
          headings: [],
          textExcerpt: "Readable about page.",
          wordCount: 200,
          forms: [],
          metaDescription: "About us",
          structuredDataTypes: ["LocalBusiness"],
          images: [],
        },
        {
          url: `${ORIGIN}/contact`,
          status: 200,
          title: "Contact",
          h1s: ["Contact"],
          headings: [],
          textExcerpt: "Readable contact page.",
          wordCount: 200,
          forms: [],
          metaDescription: "Contact us",
          structuredDataTypes: ["Organization"],
          images: [],
        },
        {
          url: `${ORIGIN}/dead`,
          status: 404,
          title: "",
          h1s: [],
          headings: [],
          textExcerpt: "",
          wordCount: 0,
          forms: [],
        },
      ],
      nav: [],
      links: [
        {
          href: `${ORIGIN}/dead`,
          label: "Dead page",
          scheme: "http",
          ariaLabel: "",
          title: "",
          inNav: false,
          foundOn: [ROOT],
        },
        {
          href: `${ORIGIN}/probed-dead`,
          label: "Probed dead page",
          scheme: "http",
          ariaLabel: "",
          title: "",
          inNav: false,
          foundOn: [`${ORIGIN}/about`],
        },
      ],
      sitemapUrls: [],
      crawlExhaustive: true,
    },
    networkEvents: [],
  });
}

const provider = (evidence: EvidenceBundle): EvidenceProvider => ({
  getEvidence: () => Promise.resolve(evidence),
  probe: (url): Promise<ProbeResult> =>
    Promise.resolve({
      requestedUrl: url,
      status: url.endsWith("probed-dead") ? 410 : 200,
      finalUrl: url,
      ok: !url.endsWith("probed-dead"),
      outcome: "complete",
    }),
});

function priorMetaFinding(): Opportunity {
  return OpportunitySchema.parse({
    id: "opp-previous-meta",
    dedupeKey: dedupeKey(client.id, "missing-meta-description", ROOT),
    clientId: client.id,
    ruleId: "missing-meta-description",
    title: "Missing meta description",
    detected: `The page ${ROOT} has no non-empty meta description.`,
    evidenceRefs: [`page:${ROOT}`, "meta-description:missing"],
    rationale: "The page has no non-empty meta description.",
    suggestedServiceId: "svc-missing-meta-description",
    suggestedScope: ["Add a non-empty meta description."],
    priceMin: 205,
    priceMax: 705,
    confidence: 0.9,
    billableStatus: "billable",
    status: "new",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
}

function priorMissingTitleFinding(pageUrl: string): Opportunity {
  return OpportunitySchema.parse({
    id: "opp-previous-title",
    dedupeKey: dedupeKey(client.id, "missing-title", pageUrl),
    clientId: client.id,
    ruleId: "missing-title",
    title: "Missing page title",
    detected: `The page ${pageUrl} has no non-empty title.`,
    evidenceRefs: [`page:${pageUrl}`, "title:missing"],
    rationale: "The page has no non-empty title.",
    suggestedServiceId: "svc-missing-title",
    suggestedScope: ["Add a descriptive page title."],
    priceMin: 200,
    priceMax: 700,
    confidence: 0.9,
    billableStatus: "billable",
    status: "new",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
}

function priorBrokenLinkFinding(sourceUrl: string, targetUrl: string): Opportunity {
  return OpportunitySchema.parse({
    id: "opp-previous-broken-link",
    dedupeKey: dedupeKey(client.id, "broken-internal-link", targetUrl),
    clientId: client.id,
    ruleId: "broken-internal-link",
    title: "Broken internal link",
    detected: `The internal link on ${sourceUrl} points to ${targetUrl}, which returned HTTP 404.`,
    evidenceRefs: [`page:${sourceUrl}`, `target:${targetUrl}`, "status:404"],
    rationale: "The internal link target returned HTTP 404.",
    suggestedServiceId: "svc-broken-internal-link",
    suggestedScope: ["Repair or remove the reported same-site link."],
    priceMin: 204,
    priceMax: 704,
    confidence: 0.95,
    billableStatus: "billable",
    status: "new",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
}

describe("pipeline expanded deterministic rules", () => {
  it("surfaces observed technical defects without spending an AI call", async () => {
    const evaluate = vi.fn(() => Promise.reject(new Error("technical rules are deterministic")));
    const result = await analyzeClient({
      client,
      catalog,
      coverage: [],
      evidenceProvider: provider(fullEvidence()),
      evaluator: { evaluate },
      maxAiCalls: 0,
    });

    expect(result.opportunities.length).toBeGreaterThanOrEqual(8);
    expect(new Set(result.opportunities.map((opp) => opp.ruleId))).toEqual(
      new Set(TAGS),
    );
    expect(evaluate).not.toHaveBeenCalled();
    expect(result.stats.aiCalls).toBe(0);
    expect(result.stats.evaluatorErrors).toBe(0);
    expect(result.opportunities.every((opp) => opp.status === "new")).toBe(true);
  });

  it("does not resolve a prior finding when a readable page was not revisited with the new field", async () => {
    const evidence = EvidenceBundleSchema.parse({
      clientId: client.id,
      source: "fixture",
      capturedAt: "2026-09-04T00:00:00.000Z",
      site: {
        pages: [
          {
            url: ROOT,
            status: 200,
            title: "Home",
            h1s: ["Home"],
            headings: [],
            textExcerpt: "Readable content.",
            wordCount: 120,
            forms: [],
          },
          {
            url: `${ORIGIN}/about`,
            status: 200,
            title: "About",
            h1s: ["About"],
            headings: [],
            textExcerpt: "Readable content.",
            wordCount: 120,
            forms: [],
            metaDescription: "Present",
          },
        ],
        nav: [],
        links: [],
        sitemapUrls: [],
        crawlExhaustive: true,
      },
      networkEvents: [],
    });
    const result = await analyzeClient({
      client,
      catalog: [catalog.find((service) => service.tags.includes("missing-meta-description"))!],
      coverage: [],
      existing: [priorMetaFinding()],
      evidenceProvider: provider(evidence),
      evaluator: { evaluate: vi.fn() },
    });

    expect(result.opportunities).toHaveLength(0);
    expect(result.resolved).toHaveLength(0);
  });

  it("resolves a prior finding only after every readable page has a known repaired field", async () => {
    const evidence = EvidenceBundleSchema.parse({
      clientId: client.id,
      source: "fixture",
      capturedAt: "2026-09-04T00:00:00.000Z",
      site: {
        pages: [
          {
            url: ROOT,
            status: 200,
            title: "Home",
            h1s: ["Home"],
            headings: [],
            textExcerpt: "Readable content.",
            wordCount: 120,
            forms: [],
            metaDescription: "Present",
          },
          {
            url: `${ORIGIN}/about`,
            status: 200,
            title: "About",
            h1s: ["About"],
            headings: [],
            textExcerpt: "Readable content.",
            wordCount: 120,
            forms: [],
            metaDescription: "Present",
          },
        ],
        nav: [],
        links: [],
        sitemapUrls: [],
        crawlExhaustive: true,
      },
      networkEvents: [],
    });
    const result = await analyzeClient({
      client,
      catalog: [catalog.find((service) => service.tags.includes("missing-meta-description"))!],
      coverage: [],
      existing: [priorMetaFinding()],
      evidenceProvider: provider(evidence),
      evaluator: { evaluate: vi.fn() },
    });

    expect(result.opportunities).toHaveLength(0);
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]?.status).toBe("resolved");
  });

  it("does not resolve a page finding when its subject page was not revisited", async () => {
    const evidence = EvidenceBundleSchema.parse({
      clientId: client.id,
      source: "fixture",
      capturedAt: "2026-09-04T00:00:00.000Z",
      site: {
        pages: [
          {
            url: `${ORIGIN}/about`,
            status: 200,
            title: "About",
            h1s: ["About"],
            headings: [],
            textExcerpt: "Readable content.",
            wordCount: 120,
            forms: [],
            metaDescription: "Present",
          },
        ],
        nav: [],
        links: [],
        sitemapUrls: [],
        crawlExhaustive: true,
      },
      networkEvents: [],
    });
    const result = await analyzeClient({
      client,
      catalog: [catalog.find((service) => service.tags.includes("missing-meta-description"))!],
      coverage: [],
      existing: [priorMetaFinding()],
      evidenceProvider: provider(evidence),
      evaluator: { evaluate: vi.fn() },
    });

    expect(result.resolved).toHaveLength(0);
  });

  it("keeps an old page finding open when an exhaustive crawl omits that page", async () => {
    const oldPage = `${ORIGIN}/old-page`;
    const evidence = EvidenceBundleSchema.parse({
      clientId: client.id,
      source: "fixture",
      capturedAt: "2026-09-04T00:00:00.000Z",
      site: {
        pages: [
          {
            url: ROOT,
            status: 200,
            title: "Home",
            h1s: ["Home"],
            headings: [],
            textExcerpt: "Readable content.",
            wordCount: 120,
            forms: [],
          },
        ],
        nav: [],
        links: [],
        sitemapUrls: [],
        crawlExhaustive: true,
      },
      networkEvents: [],
    });
    const result = await analyzeClient({
      client,
      catalog: [catalog.find((service) => service.tags.includes("missing-title"))!],
      coverage: [],
      existing: [priorMissingTitleFinding(oldPage)],
      evidenceProvider: provider(evidence),
      evaluator: { evaluate: vi.fn() },
    });

    expect(result.opportunities).toHaveLength(0);
    expect(result.resolved).toHaveLength(0);
  });

  it("resolves a broken-link finding only after both source and target are revisited", async () => {
    const sourcePage = `${ORIGIN}/services/repair`;
    const targetPage = `${ORIGIN}/old-page`;
    const repairedEvidence = EvidenceBundleSchema.parse({
      clientId: client.id,
      source: "fixture",
      capturedAt: "2026-09-04T00:00:00.000Z",
      site: {
        pages: [
          {
            url: ROOT,
            status: 200,
            title: "Home",
            h1s: ["Home"],
            headings: [],
            textExcerpt: "Readable content.",
            wordCount: 120,
            forms: [],
          },
          {
            url: sourcePage,
            status: 200,
            title: "Repair",
            h1s: ["Repair"],
            headings: [],
            textExcerpt: "Readable service content.",
            wordCount: 120,
            forms: [],
          },
          {
            url: targetPage,
            status: 200,
            title: "Repaired page",
            h1s: ["Repaired page"],
            headings: [],
            textExcerpt: "Readable content.",
            wordCount: 120,
            forms: [],
          },
        ],
        nav: [],
        links: [],
        sitemapUrls: [],
        crawlExhaustive: true,
      },
      networkEvents: [],
    });
    const repaired = await analyzeClient({
      client,
      catalog: [catalog.find((service) => service.tags.includes("broken-internal-link"))!],
      coverage: [],
      existing: [priorBrokenLinkFinding(sourcePage, targetPage)],
      evidenceProvider: provider(repairedEvidence),
      evaluator: { evaluate: vi.fn() },
    });

    expect(repaired.resolved).toHaveLength(1);
    expect(repaired.resolved[0]?.status).toBe("resolved");

    const targetServerError = EvidenceBundleSchema.parse({
      ...repairedEvidence,
      site: {
        ...repairedEvidence.site,
        pages: repairedEvidence.site.pages.map((page) =>
          page.url === targetPage
            ? { ...page, status: 500, title: "", h1s: [], textExcerpt: "", wordCount: 0 }
            : page,
        ),
      },
    });
    const serverError = await analyzeClient({
      client,
      catalog: [catalog.find((service) => service.tags.includes("broken-internal-link"))!],
      coverage: [],
      existing: [priorBrokenLinkFinding(sourcePage, targetPage)],
      evidenceProvider: provider(targetServerError),
      evaluator: { evaluate: vi.fn() },
    });

    expect(serverError.resolved).toHaveLength(0);

    const targetUnvisited = EvidenceBundleSchema.parse({
      ...repairedEvidence,
      site: {
        ...repairedEvidence.site,
        pages: repairedEvidence.site.pages.filter((page) => page.url !== targetPage),
      },
    });
    const stillOpen = await analyzeClient({
      client,
      catalog: [catalog.find((service) => service.tags.includes("broken-internal-link"))!],
      coverage: [],
      existing: [priorBrokenLinkFinding(sourcePage, targetPage)],
      evidenceProvider: provider(targetUnvisited),
      evaluator: { evaluate: vi.fn() },
    });

    expect(stillOpen.resolved).toHaveLength(0);
  });
});
