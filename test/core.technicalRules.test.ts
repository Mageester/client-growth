import { describe, expect, it } from "vitest";

import { runRules } from "@/core/rules";
import {
  aggregateTechnicalCandidates,
  pageCandidate,
  TECHNICAL_STARTER_PRICE_BANDS,
} from "@/core/rules/technical";
import {
  ClientSchema,
  EvidenceBundleSchema,
  ServiceSchema,
  type EvidenceBundle,
  type Candidate,
  type Service,
} from "@/core/schema";
import type { ProbeResult } from "@/ports/EvidenceProvider";

const ORIGIN = "https://technical.example";
const ROOT = `${ORIGIN}/`;
const client = ClientSchema.parse({
  id: "client-technical",
  name: "Technical Example",
  domain: "technical.example",
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
    priceMin: 100 + index,
    priceMax: 500 + index,
    tags: [tag],
    active: true,
  }),
);

function evidenceWithAllTechnicalFindings(): EvidenceBundle {
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
          textExcerpt: "Readable home page content.",
          wordCount: 220,
          forms: [],
          metaDescription: "",
          structuredDataTypes: [],
          images: [
            { src: "/hero.jpg" },
            { src: "/ornament.svg", alt: "" },
          ],
        },
        {
          url: `${ORIGIN}/services/heating`,
          status: 200,
          title: "Shared page",
          h1s: ["Heating"],
          headings: [],
          textExcerpt: "Short service page content.",
          wordCount: 80,
          forms: [],
          metaDescription: "Heating services",
          structuredDataTypes: ["Service"],
          images: [{ src: "/heating.jpg", alt: "Heating work" }],
        },
        {
          url: `${ORIGIN}/about`,
          status: 200,
          title: "Shared page",
          h1s: ["About"],
          headings: [],
          textExcerpt: "Readable about page content.",
          wordCount: 180,
          forms: [],
          metaDescription: "About this business",
          structuredDataTypes: ["LocalBusiness"],
          images: [{ src: "/about.jpg" }],
        },
        {
          url: `${ORIGIN}/contact`,
          status: 200,
          title: "Contact",
          h1s: ["Contact"],
          headings: [],
          textExcerpt: "Readable contact page content.",
          wordCount: 180,
          forms: [],
          metaDescription: "Contact this business",
          structuredDataTypes: ["Organization"],
          images: [],
        },
        {
          url: `${ORIGIN}/missing`,
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
          href: `${ORIGIN}/missing`,
          label: "Missing page",
          scheme: "http",
          ariaLabel: "",
          title: "",
          inNav: false,
          foundOn: [ROOT],
        },
        {
          href: `${ORIGIN}/probed-missing`,
          label: "Probed missing page",
          scheme: "http",
          ariaLabel: "",
          title: "",
          inNav: false,
          foundOn: [`${ORIGIN}/about`],
        },
        {
          href: `${ORIGIN}/server-error`,
          label: "Server error",
          scheme: "http",
          ariaLabel: "",
          title: "",
          inNav: false,
          foundOn: [ROOT],
        },
        {
          href: `${ORIGIN}/timed-out`,
          label: "Timed out",
          scheme: "http",
          ariaLabel: "",
          title: "",
          inNav: false,
          foundOn: [ROOT],
        },
        {
          href: `${ORIGIN}/about`,
          label: "Healthy page",
          scheme: "http",
          ariaLabel: "",
          title: "",
          inNav: false,
          foundOn: [ROOT],
        },
        {
          href: "https://outside.example/page",
          label: "External page",
          scheme: "http",
          ariaLabel: "",
          title: "",
          inNav: false,
          foundOn: [ROOT],
        },
      ],
      sitemapUrls: [],
      crawlExhaustive: false,
    },
    networkEvents: [],
  });
}

function probe(url: string): Promise<ProbeResult> {
  const status = url.endsWith("probed-missing")
    ? 410
    : url.endsWith("server-error")
      ? 500
      : 0;
  return Promise.resolve({
    requestedUrl: url,
    status,
    finalUrl: url,
    ok: status >= 200 && status < 400,
    outcome: status === 0 ? "inconclusive" : "complete",
    reason: status === 0 ? "request timed out" : undefined,
  });
}

describe("expanded deterministic rules", () => {
  it("aggregates technical observations without changing unrelated rule candidates", () => {
    const nonTechnical: Candidate = {
      ruleId: "missing-service-page",
      subject: "heat pump installation",
      detected: "A service page is absent.",
      evidenceRefs: ["offering:heat pump installation"],
      rawConfidence: 0.9,
      suggestedServiceId: "svc-landing",
    };
    const aggregated = aggregateTechnicalCandidates({
      client,
      candidates: [
        nonTechnical,
        pageCandidate({
          ruleId: "missing-title",
          subject: ROOT,
          detected: "root is missing a title",
          evidenceRefs: [`page:${ROOT}`, "title:missing"],
          suggestedServiceId: "svc-missing-title",
        }),
        pageCandidate({
          ruleId: "missing-title",
          subject: `${ORIGIN}/about`,
          detected: "about is missing a title",
          evidenceRefs: [`page:${ORIGIN}/about`, "title:missing"],
          suggestedServiceId: "svc-missing-title",
          rawConfidence: 0.8,
        }),
      ],
    });

    expect(aggregated).toHaveLength(2);
    expect(aggregated[0]).toEqual(nonTechnical);
    expect(aggregated[1]).toMatchObject({
      ruleId: "missing-title",
      subject: client.domain,
      rawConfidence: 0.8,
    });
  });

  it("keeps the technical starter catalog in low-hundreds site-level bands", () => {
    expect(TECHNICAL_STARTER_PRICE_BANDS).toEqual({
      "missing-title": { min: 150, max: 300 },
      "duplicate-title": { min: 200, max: 400 },
      "thin-service-page": { min: 400, max: 800 },
      "missing-h1": { min: 150, max: 300 },
      "broken-internal-link": { min: 200, max: 500 },
      "missing-meta-description": { min: 200, max: 500 },
      "missing-structured-data": { min: 300, max: 700 },
      "missing-image-alt": { min: 150, max: 400 },
    });
  });

  it("produces every requested technical finding from literal observations", async () => {
    const candidates = await runRules({
      client,
      catalog,
      evidence: evidenceWithAllTechnicalFindings(),
      probe,
      probeBudget: { remaining: 20 },
    });
    const ids = new Set(candidates.map((candidate) => candidate.ruleId));

    for (const ruleId of TAGS) expect(ids.has(ruleId), ruleId).toBe(true);

    // Technical observations are priced as one site-level repair, never as a
    // separate project for each URL that happened to expose the same defect.
    const technical = candidates.filter((candidate) => TAGS.includes(candidate.ruleId as (typeof TAGS)[number]));
    expect(technical).toHaveLength(TAGS.length);
    for (const ruleId of TAGS) {
      expect(technical.filter((candidate) => candidate.ruleId === ruleId), ruleId).toHaveLength(1);
    }
    expect(technical.every((candidate) => candidate.subject === client.domain)).toBe(true);

    const broken = technical.find((candidate) => candidate.ruleId === "broken-internal-link");
    expect(broken?.evidenceRefs).toEqual(
      expect.arrayContaining([
        `page:${ROOT}`,
        `page:${ORIGIN}/about`,
        `target:${ORIGIN}/missing`,
        `target:${ORIGIN}/probed-missing`,
      ]),
    );
    expect(candidates.some((candidate) => candidate.subject.endsWith("server-error"))).toBe(false);
    expect(candidates.some((candidate) => candidate.subject.endsWith("timed-out"))).toBe(false);

    const imageFinding = candidates.find((candidate) => candidate.ruleId === "missing-image-alt");
    expect(imageFinding?.detected).toContain("2 images");
    expect(imageFinding?.detected).toContain("2 affected pages");
    expect(imageFinding?.evidenceRefs).toEqual(
      expect.arrayContaining([`page:${ROOT}`, `page:${ORIGIN}/about`, "images-without-alt:1"]),
    );
    expect(imageFinding?.detected).toContain('decorative alt="" images are excluded');
  });

  it("does not re-raise page evidence the agency dismissed before site-level aggregation", async () => {
    const candidates = await runRules({
      client,
      catalog,
      evidence: evidenceWithAllTechnicalFindings(),
      probe,
      probeBudget: { remaining: 20 },
      technicalSuppressedEvidenceRefsByRule: Object.fromEntries(
        TAGS.map((ruleId) => [ruleId, [`page:${ROOT}`]]),
      ),
    });

    expect(candidates.some((candidate) => candidate.evidenceRefs.includes(`page:${ROOT}`))).toBe(false);
  });

  it("keeps dismissed evidence scoped to its own rule and retains it until reopen", () => {
    const result = aggregateTechnicalCandidates({
      client,
      candidates: [
        pageCandidate({
          ruleId: "missing-title",
          subject: ROOT,
          detected: "root title missing",
          evidenceRefs: [`page:${ROOT}`, "title:missing"],
          suggestedServiceId: "svc-missing-title",
        }),
        pageCandidate({
          ruleId: "missing-meta-description",
          subject: `${ORIGIN}/about`,
          detected: "about meta missing",
          evidenceRefs: [`page:${ORIGIN}/about`, "meta-description:missing"],
          suggestedServiceId: "svc-missing-meta-description",
        }),
      ],
      suppressedEvidenceRefsByRule: {
        "missing-title": [`page:${ROOT}`],
        // This page is not currently missing metadata, but its legacy dismissal
        // must stay attached to the canonical metadata row until it is reopened.
        "missing-meta-description": [`page:${ROOT}`],
      },
    });

    expect(result.find((candidate) => candidate.ruleId === "missing-title")).toBeUndefined();
    expect(result.find((candidate) => candidate.ruleId === "missing-meta-description")).toMatchObject({
      subject: client.domain,
      suppressedEvidenceRefs: [`page:${ROOT}`],
    });
  });

  it("does not turn legacy unknown fields into missing metadata or image findings", async () => {
    const legacy = EvidenceBundleSchema.parse({
      clientId: client.id,
      source: "fixture",
      capturedAt: "2026-09-04T00:00:00.000Z",
      site: {
        pages: [
          {
            url: ROOT,
            status: 200,
            title: "Example",
            h1s: ["Example"],
            headings: [],
            textExcerpt: "Readable content",
            wordCount: 100,
            forms: [],
          },
          {
            url: `${ORIGIN}/about`,
            status: 200,
            title: "About",
            h1s: ["About"],
            headings: [],
            textExcerpt: "Readable content",
            wordCount: 100,
            forms: [],
          },
          {
            url: `${ORIGIN}/contact`,
            status: 200,
            title: "Contact",
            h1s: ["Contact"],
            headings: [],
            textExcerpt: "Readable content",
            wordCount: 100,
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
    const candidates = await runRules({ client, catalog, evidence: legacy });
    expect(candidates).toHaveLength(0);
  });

  it("recognizes LocalBusiness subclasses and leaves unknown encodings alone", async () => {
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
            textExcerpt: "Readable home content",
            wordCount: 120,
            forms: [],
            metaDescription: "Home",
            structuredDataTypes: [],
            structuredDataPresent: false,
            images: [],
          },
          {
            url: `${ORIGIN}/services/dentistry`,
            status: 200,
            title: "Dentistry",
            h1s: ["Dentistry"],
            headings: [],
            textExcerpt: "Readable service content",
            wordCount: 120,
            forms: [],
            metaDescription: "Dentistry",
            structuredDataTypes: ["Dentist", "HVACBusiness", "Plumber", "MedicalBusiness"],
            structuredDataPresent: true,
            images: [],
          },
          {
            url: `${ORIGIN}/services/unknown`,
            status: 200,
            title: "Unknown service",
            h1s: ["Unknown service"],
            headings: [],
            textExcerpt: "Readable service content",
            wordCount: 120,
            forms: [],
            metaDescription: "Unknown service",
            structuredDataTypes: ["Thing"],
            structuredDataPresent: true,
            images: [],
          },
          {
            url: `${ORIGIN}/about`,
            status: 200,
            title: "About",
            h1s: ["About"],
            headings: [],
            textExcerpt: "Readable about content",
            wordCount: 120,
            forms: [],
            metaDescription: "About",
            structuredDataTypes: [],
            structuredDataPresent: false,
            images: [],
          },
        ],
        nav: [],
        links: [],
        sitemapUrls: [],
        crawlExhaustive: true,
      },
      networkEvents: [],
    });
    const schemaCatalog = [catalog.find((service) => service.tags.includes("missing-structured-data"))!];

    const candidates = await runRules({ client, catalog: schemaCatalog, evidence });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.subject).toBe(client.domain);
  });

  it("does not classify thin editorial or archive URLs as service pages", async () => {
    const evidence = EvidenceBundleSchema.parse({
      clientId: client.id,
      source: "fixture",
      capturedAt: "2026-09-04T00:00:00.000Z",
      site: {
        pages: [
          {
            url: `${ORIGIN}/services/repair`,
            status: 200,
            title: "Repair",
            h1s: ["Repair"],
            headings: [],
            textExcerpt: "Short service content",
            wordCount: 80,
            forms: [],
          },
          {
            url: `${ORIGIN}/blog/repair`,
            status: 200,
            title: "Repair tips",
            h1s: ["Repair tips"],
            headings: [],
            textExcerpt: "Short article content",
            wordCount: 80,
            forms: [],
          },
          {
            url: `${ORIGIN}/category/repair`,
            status: 200,
            title: "Repair archive",
            h1s: ["Repair archive"],
            headings: [],
            textExcerpt: "Short archive content",
            wordCount: 80,
            forms: [],
          },
        ],
        nav: [],
        links: [],
        sitemapUrls: [],
        crawlExhaustive: false,
      },
      networkEvents: [],
    });
    const thinCatalog = [catalog.find((service) => service.tags.includes("thin-service-page"))!];

    const candidates = await runRules({ client, catalog: thinCatalog, evidence });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.subject).toBe(client.domain);
  });
});
