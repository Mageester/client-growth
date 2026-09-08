import { describe, expect, it } from "vitest";

import { FixtureEvidenceProvider } from "@/adapters/evidence/FixtureEvidenceProvider";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import { analyzeClient } from "@/pipeline/analyzeClient";
import { ClientSchema, EvidenceBundleSchema, ServiceSchema } from "@/core/schema";

const NOW = "2026-09-07T00:00:00.000Z";

const client = ClientSchema.parse({
  id: "velvet",
  name: "Velvet Nails and Beauty Lounge",
  domain: "velvetnailsandbeautylounge.ca",
  offerings: ["Gel manicures", "Nail extensions"],
  notes: "",
});

const catalog = [
  ServiceSchema.parse({
    id: "svc-landing-page",
    name: "Service Landing Page",
    description: "",
    priceMin: 900,
    priceMax: 1800,
    tags: ["landing-page"],
    active: true,
  }),
];

function blockedEvidence(
  id: string,
  kind: "robots" | "timeout" | "js-shell",
) {
  return EvidenceBundleSchema.parse({
    clientId: id,
    source: "http",
    capturedAt: NOW,
    site: {
      pages:
        kind === "js-shell"
          ? [
              {
                url: `https://${client.domain}/`,
                status: 200,
                title: "Velvet Nails",
                h1s: [],
                headings: [],
                textExcerpt: "",
                wordCount: 0,
                forms: [],
              },
            ]
          : [],
      nav: [],
      links: [],
      sitemapUrls: [],
      crawlExhaustive: false,
    },
    networkEvents: [
      {
        url: `https://${client.domain}/`,
        outcome: "inconclusive",
        reason:
          kind === "robots"
            ? "robots.txt disallowed the required path"
            : kind === "timeout"
              ? "request timeout"
              : "page rendered no usable text",
        code: kind,
        stage: kind === "robots" ? "robots" : "page",
      },
    ],
  });
}

function insufficientEvidence() {
  return EvidenceBundleSchema.parse({
    clientId: client.id,
    source: "http",
    capturedAt: NOW,
    site: {
      pages: [
        {
          url: `https://${client.domain}/`,
          status: 200,
          title: "Velvet Nails",
          h1s: ["Velvet Nails"],
          headings: [],
          textExcerpt: "A welcoming nail salon.",
          wordCount: 40,
          forms: [],
        },
        {
          url: `https://${client.domain}/about`,
          status: 200,
          title: "About Velvet Nails",
          h1s: ["About us"],
          headings: [],
          textExcerpt: "Meet the team.",
          wordCount: 35,
          forms: [],
        },
      ],
      nav: ["Home", "About", "Contact"],
      links: [],
      sitemapUrls: [],
      crawlExhaustive: false,
    },
    networkEvents: [],
  });
}

async function run(evidence: ReturnType<typeof EvidenceBundleSchema.parse>) {
  return analyzeClient({
    client,
    catalog,
    coverage: [],
    evidenceProvider: new FixtureEvidenceProvider([evidence]),
    evaluator: new MockEvaluator(),
    now: new Date(NOW),
  });
}

describe("pipeline: blocked website coverage stays fail-closed with manual offerings", () => {
  it.each([
    ["robots blocked", blockedEvidence("velvet", "robots")],
    ["timeout", blockedEvidence("velvet", "timeout")],
    ["JS shell", blockedEvidence("velvet", "js-shell")],
    ["insufficient readable coverage", insufficientEvidence()],
  ])("does not produce a missing-service finding for %s", async (_label, evidence) => {
    const result = await run(evidence);

    expect(result.coverage.analyzable).toBe(false);
    expect(result.coverage.limitation).toBe("coverage-limited");
    expect(result.opportunities.some((opportunity) => opportunity.ruleId === "missing-service-page")).toBe(false);
    expect(result.stats.aiCalls).toBe(0);
  });
});
