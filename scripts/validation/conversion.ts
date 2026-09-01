/**
 * Small real-site validation for broken-conversion-path.
 *
 *   tsx scripts/validation/conversion.ts
 *
 * Crawls a handful of real sites, runs the rule with the real HTTP probe (no
 * AI), and reports every surfaced defect with its exact evidence. Runs one
 * DeepSeek evaluation ONLY if a defect is found and DEEPSEEK_API_KEY is set.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HttpEvidenceProvider } from "../../src/adapters/evidence/HttpEvidenceProvider";
import { brokenConversionPathRule } from "../../src/core/rules/brokenConversionPath";
import { DeepSeekEvaluator } from "../../src/adapters/evaluator/DeepSeekEvaluator";
import { ClientSchema, ServiceSchema } from "../../src/core/schema";

const HERE = dirname(fileURLToPath(import.meta.url));

const CONVERSION_FIX = ServiceSchema.parse({
  id: "svc-conversion-fix",
  name: "Conversion Path Fix",
  description:
    "Diagnose and repair a broken conversion element (dead CTA, broken form, unusable phone link).",
  priceMin: 300,
  priceMax: 900,
  tags: ["conversion-fix"],
  active: true,
});

const SITES = [
  "www.bellbrothers.com",
  "www.gilmoreair.com",
  "www.lentheplumber.com",
  "www.russelllandscape.com",
  "www.castlekeepers.com",
  "www.perfectteeth.com",
  "www.hupy.com",
  "www.bakerroofing.com",
];

interface SiteReport {
  domain: string;
  crawlPages: number;
  telLinks: number;
  forms: number;
  conversionLinks: number;
  probes: number;
  defects: Array<{
    kind: string;
    pageUrl: string;
    element: string;
    target?: string;
    status?: number;
    confidence: number;
    detected: string;
  }>;
}

async function main() {
  const reports: SiteReport[] = [];
  let totalProbes = 0;

  for (const domain of SITES) {
    process.stdout.write(`\n▶ ${domain} ... `);
    const provider = new HttpEvidenceProvider({ maxPages: 8 });
    const client = ClientSchema.parse({ id: domain, name: domain, domain, offerings: [] });

    let evidence;
    try {
      evidence = await provider.getEvidence(client);
    } catch (err) {
      process.stdout.write(`crawl failed (${(err as Error).message})`);
      continue;
    }

    let probes = 0;
    const countingProbe = async (url: string) => {
      probes++;
      totalProbes++;
      return provider.probe(url);
    };

    const candidates = await brokenConversionPathRule({
      client,
      catalog: [CONVERSION_FIX],
      evidence,
      probe: countingProbe,
      probeBudget: { remaining: 12 },
    });

    const report: SiteReport = {
      domain,
      crawlPages: evidence.site.pages.filter((p) => p.status === 200).length,
      telLinks: evidence.site.links.filter((l) => l.scheme === "tel").length,
      forms: evidence.site.pages.reduce((n, p) => n + p.forms.length, 0),
      conversionLinks: 0,
      probes,
      defects: candidates.map((c) => {
        const d = c.conversionDefect!;
        return {
          kind: d.kind,
          pageUrl: d.pageUrl,
          element: d.elementText,
          target: d.target,
          status: d.observedStatus,
          confidence: c.rawConfidence,
          detected: c.detected,
        };
      }),
    };
    reports.push(report);
    process.stdout.write(
      `${report.crawlPages} pages, ${report.telLinks} tel, ${report.forms} forms, ${probes} probes | defects: ${report.defects.length}`,
    );
    for (const d of report.defects) process.stdout.write(`\n    - [${d.kind}] ${d.detected}`);
  }

  const allDefects = reports.flatMap((r) => r.defects);
  console.log("\n\n==================== SUMMARY ====================");
  console.log(
    JSON.stringify(
      {
        sites: SITES.length,
        crawled: reports.length,
        totalProbes,
        totalDefects: allDefects.length,
        byKind: allDefects.reduce<Record<string, number>>((acc, d) => {
          acc[d.kind] = (acc[d.kind] ?? 0) + 1;
          return acc;
        }, {}),
      },
      null,
      2,
    ),
  );

  // One live DeepSeek eval, only if we actually found a defect.
  if (allDefects.length > 0 && process.env.DEEPSEEK_API_KEY) {
    const first = reports.find((r) => r.defects.length > 0)!;
    const d = first.defects[0]!;
    console.log(`\n--- live DeepSeek on: ${d.detected}`);
    const evaluator = new DeepSeekEvaluator({ apiKey: process.env.DEEPSEEK_API_KEY });
    const evaluation = await evaluator.evaluate({
      candidate: {
        ruleId: "broken-conversion-path",
        subject: `${d.kind}:${d.target ?? ""}`,
        detected: d.detected,
        evidenceRefs: [`page:${d.pageUrl}`, ...(d.target ? [`target:${d.target}`] : [])],
        rawConfidence: d.confidence,
        suggestedServiceId: "svc-conversion-fix",
        conversionDefect: {
          kind: d.kind as never,
          pageUrl: d.pageUrl,
          elementText: d.element,
          elementHref: d.target ?? "",
          target: d.target,
          observedStatus: d.status,
          seenOn: [d.pageUrl],
          note: d.detected,
        },
      },
      client: ClientSchema.parse({ id: first.domain, name: first.domain, domain: first.domain, offerings: [] }),
      evidence: {
        clientId: first.domain,
        source: "http",
        capturedAt: new Date().toISOString(),
        site: { pages: [], nav: [], links: [], sitemapUrls: [] },
        networkEvents: [],
      },
    });
    console.log(JSON.stringify(evaluation, null, 2));
    console.log(`[cost] tokens=${JSON.stringify(evaluator.lastUsage)}`);
  } else {
    console.log("\n(no defects found on the sample, or no API key — DeepSeek not called)");
  }

  writeFileSync(join(HERE, "conversion.results.json"), JSON.stringify({ reports }, null, 2));
  console.log("\nWrote scripts/validation/conversion.results.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
