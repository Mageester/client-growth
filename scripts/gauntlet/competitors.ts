/**
 * COMPETITOR GAP GAUNTLET.
 *
 * For 8 real client sets with genuine, public competitors this runs the SAME
 * core logic the product route runs (findCompetitorGaps + the per-gap
 * evaluator gate with the real provider), crawls through the polite cache.
 *
 *   set -a; source .dev.vars; set +a
 *   pnpm tsx scripts/gauntlet/competitors.ts
 *
 * Captures per set: readable/unreadable competitors, raw gaps, evaluator
 * verdicts, and the surviving gaps for human grading. Bounded AI budget.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { DeepSeekEvaluator } from "@/adapters/evaluator/DeepSeekEvaluator";
import { findCompetitorGaps } from "@/core/competitorGaps";
import { serviceForRule } from "@/core/rules/registry";
import { resolveBillability } from "@/core/billability";
import { CandidateSchema } from "@/core/schema";
import type { EvidenceBundle } from "@/core/schema";
import { createCachingFetch } from "../analyzability/cache";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "competitors.json");

const MAX_AI_CALLS = Number(process.env.GAUNTLET_MAX_AI_CALLS ?? "40");

/** Real client + genuine competitor sets (public businesses, same trade). */
const SETS: { client: string; domain: string; offerings: string[]; competitors: string[] }[] = [
  {
    client: "davey",
    domain: "www.davey.com",
    offerings: ["tree removal", "tree pruning", "stump grinding", "tree health inspections", "emergency tree service", "tree planting"],
    competitors: ["www.bartlett.com", "www.savatree.com"],
  },
  {
    client: "cambridgeheating",
    domain: "cambridgeheating.ca",
    offerings: ["Furnace repair", "Air conditioning installation", "Water heater replacement", "Duct cleaning"],
    competitors: ["www.reliancehomecomfort.com", "www.enercare.ca"],
  },
  {
    client: "bellbrothers",
    domain: "www.bellbrothers.com",
    offerings: ["air conditioning repair", "furnace replacement", "heat pump installation", "water heater installation", "sewer line replacement", "duct sealing"],
    competitors: ["www.bonney.com", "www.foxandsons.com"],
  },
  {
    client: "russelllandscape",
    domain: "www.russelllandscape.com",
    offerings: ["commercial landscape maintenance", "landscape installation", "irrigation management", "erosion control", "seasonal color", "athletic field maintenance"],
    competitors: ["www.brightview.com", "www.ruppertlandscape.com"],
  },
  {
    client: "hupy",
    domain: "www.hupy.com",
    offerings: ["car accident lawyer", "motorcycle accident lawyer", "truck accident lawyer", "workers compensation", "dog bite injury", "nursing home abuse"],
    competitors: ["www.gruberlawoffices.com", "www.murphyprachthauser.com"],
  },
  {
    client: "interstateroofing",
    domain: "www.interstateroofing.com",
    offerings: ["roof replacement", "storm damage repair", "hail damage restoration", "gutter replacement", "siding installation", "commercial roofing"],
    competitors: ["www.longhome.com", "www.eriehome.com"],
  },
  {
    client: "activegreenross",
    domain: "www.activegreenross.com",
    offerings: ["tire replacement", "oil changes", "brake service", "wheel alignment", "battery replacement", "exhaust repair"],
    competitors: ["www.tirecraft.com", "www.kaltire.com"],
  },
  {
    client: "fixitright",
    domain: "www.fixitright.ca",
    offerings: ["appliance repair", "refrigerator repair", "washer repair", "dryer repair", "oven repair", "dishwasher repair"],
    competitors: ["www.affordableappliance.ca", "www.appliance-repair.ca"],
  },
];

/** A minimal agency catalog selling landing pages (the competitor-gap sale). */
const LANDING_PAGE_SERVICE = {
  id: "svc-landing-page",
  name: "Service Landing Page",
  description: "Dedicated conversion-focused landing page for one service line.",
  priceMin: 900,
  priceMax: 1800,
  tags: ["landing-page", "competitor-gap"],
  active: true,
};

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey?.trim()) {
    console.error("DEEPSEEK_API_KEY missing");
    process.exit(1);
  }
  const evaluator = new DeepSeekEvaluator({ apiKey });

  let aiCalls = 0;
  const metered = {
    async evaluate(req: Parameters<DeepSeekEvaluator["evaluate"]>[0]) {
      if (aiCalls >= MAX_AI_CALLS) {
        const err = new Error("competitor gauntlet AI budget exhausted");
        (err as Error & { name: string }).name = "BudgetExceededError";
        throw err;
      }
      aiCalls += 1;
      return evaluator.evaluate(req);
    },
  };

  const cachingFetch = createCachingFetch({
    dir: join(HERE, "..", "..", ".analyzability-cache"),
    allowNetwork: true,
    maxLiveRequests: 700,
    perHostDelayMs: 1200,
    timeoutMs: 15_000,
  });
  const provider = new HttpEvidenceProvider({ fetchImpl: cachingFetch.fetchImpl });

  const results: unknown[] = [];
  if (existsSync(OUT)) {
    // resume support: keep prior sets
    const prior = JSON.parse(readFileSync(OUT, "utf8")) as { client: string; done: boolean }[];
    results.push(...prior.filter((p) => p.done));
  }
  const doneClients = new Set(results.map((r) => (r as { client: string }).client));

  for (const set of SETS) {
    if (doneClients.has(set.client)) {
      console.log(`-- ${set.client}: done, skipping`);
      continue;
    }
    console.log(`\n== ${set.client} (competitors: ${set.competitors.join(", ")})`);

    const clientClient = {
      id: `comp-${set.client}`,
      name: set.client,
      domain: set.domain,
      offerings: set.offerings,
      notes: "",
    } as const;

    const clientEvidence: EvidenceBundle | null = await provider
      .getEvidence({ ...clientClient, id: `comp-${set.client}` })
      .then((e) => e)
      .catch(() => null);
    console.log(`   client crawl: ${clientEvidence ? clientEvidence.site.pages.length + " pages, " + clientEvidence.site.sitemapUrls.length + " sitemap urls" : "FAILED"}`);

    const competitors: { domain: string; evidence: EvidenceBundle | null }[] = [];
    for (const domain of set.competitors) {
      const ev = await provider
        .getEvidence({
          id: `comp-${set.client}-c`,
          name: domain,
          domain,
          offerings: [],
          notes: "",
        })
        .catch(() => null);
      const readable = ev && ev.site.pages.filter((p) => p.status === 200 && p.wordCount > 50).length >= 2 ? ev : null;
      competitors.push({ domain, evidence: readable });
      console.log(`   competitor ${domain}: ${readable ? readable.site.pages.length + " pages" : "UNREADABLE"}`);
    }

    const gapResult = findCompetitorGaps({
      clientOfferings: [...set.offerings],
      clientEvidence,
      competitors,
    });
    console.log(`   raw gaps: ${gapResult.gaps.length}${gapResult.limitation ? " | LIMITATION: " + gapResult.limitation : ""}`);

    const service = serviceForRule([LANDING_PAGE_SERVICE], "competitor-gap");
    const gated: unknown[] = [];
    if (!service) throw new Error("catalog lost its competitor-gap service");
    for (const gap of gapResult.gaps) {
      const candidate = CandidateSchema.parse({
        ruleId: "competitor-service-gap",
        subject: gap.label,
        detected: `${gap.competitorDomains.length} competitors have a page for ${gap.label}; ${set.domain} does not.`,
        evidenceRefs: [
          ...gap.competitorDomains.map((d) => `competitor:${d}`),
          ...(gap.exampleUrl ? [`page:${gap.exampleUrl}`] : []),
        ],
        rawConfidence: gap.competitorDomains.length >= 3 ? 0.8 : 0.7,
        suggestedServiceId: service.id,
      });
      let verdict = "error";
      let rationale = "";
      let subjectType = "";
      try {
        const ev = await metered.evaluate({
          candidate,
          client: { ...clientClient, id: `comp-${set.client}` },
          evidence: clientEvidence!,
        });
        verdict = ev.verdict;
        rationale = ev.rationale;
        subjectType = ev.subjectType ?? "";
      } catch (err) {
        verdict = "error";
        rationale = err instanceof Error ? err.message : String(err);
      }
      console.log(`   gap [${gap.label}] -> ${verdict} (${subjectType}) ${rationale.slice(0, 90)}`);
      gated.push({
        label: gap.label,
        competitorDomains: gap.competitorDomains,
        exampleUrl: gap.exampleUrl ?? null,
        verdict,
        subjectType,
        rationale,
        billableStatus: resolveBillability(service.id, []),
      });
    }

    results.push({
      client: set.client,
      domain: set.domain,
      done: true,
      clientCrawlPages: clientEvidence?.site.pages.length ?? 0,
      competitors: set.competitors,
      readable: competitors.filter((c) => c.evidence).map((c) => c.domain),
      unreadable: competitors.filter((c) => !c.evidence).map((c) => c.domain),
      rawGaps: gapResult.gaps,
      limitation: gapResult.limitation ?? null,
      gated,
    });
    writeFileSync(OUT, JSON.stringify(results, null, 2));
  }

  const cs = cachingFetch.stats;
  console.log(`\ncompetitor gauntlet done: aiCalls=${aiCalls}/${MAX_AI_CALLS} | cache hits=${cs.hits} misses=${cs.misses}`);
  console.log(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
