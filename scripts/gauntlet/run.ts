/**
 * PRODUCTION-READINESS GAUNTLET — full pipeline over real public business sites
 * with the REAL configured AI provider.
 *
 *   set -a; source .dev.vars; set +a
 *   pnpm tsx scripts/gauntlet/run.ts                 (analyze every site)
 *   pnpm tsx scripts/gauntlet/run.ts --only=id1,id2  (re-run a subset)
 *   pnpm tsx scripts/gauntlet/run.ts --report        (summarize results.json)
 *
 * Safety:
 *  - The evidence layer is wrapped in the SAME on-disk polite cache the
 *    analyzability benchmark uses (polite per-host delay, run-wide request cap,
 *    1MB body cap, timeouts). Replays are free; live fetches are bounded.
 *  - The evaluator is the real DeepSeekEvaluator under a run-wide budget
 *    (GAUNTLET_MAX_AI_CALLS, default 60). Exceeding it fails closed via
 *    BudgetExceededError, which the pipeline already counts as evaluatorErrors.
 *  - Nothing here touches production data. API key only ever read from
 *    .dev.vars / env, never printed.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { DeepSeekEvaluator } from "@/adapters/evaluator/DeepSeekEvaluator";
import { analyzeClient } from "@/pipeline/analyzeClient";
import { classifyAnalysis } from "@/core/analysisOutcome";
import { tierForRule } from "@/core/rules/registry";
import { ClientSchema, type EvidenceBundle } from "@/core/schema";
import type { OpportunityEvaluator } from "@/ports/OpportunityEvaluator";
import type { EvidenceProvider } from "@/ports/EvidenceProvider";

import { createCachingFetch } from "../analyzability/cache";
import { CORPUS as A_CORPUS } from "../analyzability/corpus";
import { CASES as CASES_FRANCHISE } from "../validation/cases";
import { CASES as CASES_LOCAL } from "../validation/cases.local";
import { CATALOG } from "../validation/catalog";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT_FILE = join(ROOT, "scripts", "gauntlet", "results.json");
const CACHE_DIR = join(ROOT, ".analyzability-cache"); // shared, git-ignored

const MAX_AI_CALLS = Number(process.env.GAUNTLET_MAX_AI_CALLS ?? "60");
const MAX_LIVE_REQUESTS = Number(process.env.GAUNTLET_MAX_LIVE_REQUESTS ?? "900");

// ---------------------------------------------------------------------------
// Corpus: union of the analyzability corpus (24 sites) and both validation
// rounds (21 franchise + 20 local), deduped by domain.
// ---------------------------------------------------------------------------

interface Site {
  id: string;
  name: string;
  domain: string;
  vertical: string;
  offerings: string[];
}

const byDomain = new Map<string, Site>();
const add = (s: Site) => {
  const existing = byDomain.get(s.domain);
  if (!existing) byDomain.set(s.domain, s);
};

for (const s of A_CORPUS) add({ id: s.id, name: s.id, domain: s.domain, vertical: s.vertical, offerings: [...s.offerings] });
for (const c of CASES_FRANCHISE) add({ id: c.id, name: c.name, domain: c.domain, vertical: c.vertical, offerings: [...c.offerings] });
for (const c of CASES_LOCAL) add({ id: c.id, name: c.name, domain: c.domain, vertical: c.vertical, offerings: [...c.offerings] });

const ALL_SITES = [...byDomain.values()];

// ---------------------------------------------------------------------------
// Cached, polite evidence provider (shared cache with analyzability runs)
// ---------------------------------------------------------------------------

function makeCachedProvider(): { provider: EvidenceProvider; cacheStats: () => { hits: number; misses: number; errors: number; refused: number } } {
  const cachingFetch = createCachingFetch({
    dir: CACHE_DIR,
    allowNetwork: true,
    maxLiveRequests: MAX_LIVE_REQUESTS,
    perHostDelayMs: 1200,
    timeoutMs: 15_000,
  });
  const provider = new HttpEvidenceProvider({ fetchImpl: cachingFetch.fetchImpl });
  return {
    provider: provider as unknown as EvidenceProvider,
    cacheStats: () => cachingFetch.stats,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? (onlyArg.split("=")[1] ?? "").split(",") : null;
const REPORT_ONLY = process.argv.includes("--report");
const FORCE = process.argv.includes("--force");

interface Finding {
  ruleId: string;
  title: string;
  tier: string;
  serviceName: string | null;
  priceMin: number;
  priceMax: number;
  confidence: number;
  rationale: string;
  evidenceRefs: string[];
  suggestedScope: string[];
  dedupeKey: string;
}

interface SiteResult {
  id: string;
  name: string;
  domain: string;
  vertical: string;
  offerings: string[];
  error?: string;
  crawl?: {
    pagesFetched: number;
    pagesReadable: number;
    navCount: number;
    sitemapUrls: number;
    links: number;
    crawlExhaustive: boolean;
    blockedEvents: { url: string; reason: string }[];
  };
  coverage?: {
    analyzable: boolean;
    reason: string;
    limitation: string | null;
    representedOfferings: number;
    serviceLikePages: number;
  };
  outcome?: string;
  outcomeSummary?: string;
  limitation?: string | null;
  catalogReach?: { matched: number; total: number; unmatchedLabels: string[] };
  stats?: Record<string, number>;
  findings: Finding[];
}

function main() {
  if (REPORT_ONLY) return report();
  return analyze().catch((err) => {
    console.error("GAUNTLET FAILED:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

async function analyze() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    console.error("DEEPSEEK_API_KEY missing — set it in .dev.vars (never in source).");
    process.exit(1);
  }

  // Prove the real provider is configured: constructing without a key throws,
  // and every successful call below is the real chat endpoint.
  const evaluator = new DeepSeekEvaluator({ apiKey });

  // Budget accounting: wrap the real evaluator with a hard run-wide cap.
  let aiCalls = 0;
  const meteredEvaluator: OpportunityEvaluator = {
    async evaluate(req) {
      if (aiCalls >= MAX_AI_CALLS) {
        const err = new Error(`gauntlet AI budget exhausted (${MAX_AI_CALLS})`);
        (err as Error & { name: string }).name = "BudgetExceededError";
        throw err;
      }
      aiCalls += 1;
      return evaluator.evaluate(req);
    },
  };

  const { provider, cacheStats } = makeCachedProvider();

  const sites = ONLY ? ALL_SITES.filter((s) => ONLY.includes(s.id)) : ALL_SITES;
  console.log(
    `gauntlet: ${sites.length} site(s), corpus=${ALL_SITES.length}, aiBudget=${MAX_AI_CALLS}, liveReqCap=${MAX_LIVE_REQUESTS}${FORCE ? " (force)" : ""}`,
  );

  const prior = existsSync(OUT_FILE)
    ? (JSON.parse(readFileSync(OUT_FILE, "utf8")) as SiteResult[])
    : [];
  const results = new Map<string, SiteResult>(prior.map((r) => [r.id, r]));

  const save = () => {
    mkdirSync(dirname(OUT_FILE), { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify([...results.values()], null, 2));
  };

  for (const site of sites) {
    // Resume: a site with a completed record (outcome or error) is not re-run
    // unless --force or an explicit --only list asks for it.
    const done = prior.find((r) => r.id === site.id && (r.outcome || r.error));
    if (done && !FORCE && !ONLY) {
      console.log(`-- ${site.id}: already complete, skipping (use --force to re-run)`);
      continue;
    }
    process.stdout.write(`\n== ${site.id} (${site.domain}) ... `);
    const client = ClientSchema.parse({
      id: `gauntlet-${site.id}`,
      name: site.name,
      domain: site.domain,
      offerings: site.offerings,
      notes: "",
    });

    try {
      const evidence: EvidenceBundle = await provider.getEvidence(client);
      const readable = evidence.site.pages.filter((p) => p.status >= 200 && p.status < 300 && (p.title || p.wordCount > 0)).length;
      const blockedEvents = evidence.networkEvents.map((e) => ({ url: e.url, reason: e.reason }));

      const result = await analyzeClient({
        client,
        catalog: CATALOG,
        coverage: [],
        existing: [],
        evidenceProvider: provider,
        evaluator: meteredEvaluator,
        maxAiCalls: MAX_AI_CALLS,
      });

      const classification = classifyAnalysis({
        evidence,
        analyzable: result.coverage.analyzable,
        coverageReason: result.coverage.reason,
        coverageLimitation: result.coverage.limitation,
        surfaced: result.opportunities.length,
        evaluatorErrors: result.stats.evaluatorErrors,
        catalog: result.catalogCoverage,
      });

      const findings: Finding[] = result.opportunities.map((o) => {
        const service = CATALOG.find((s) => s.id === o.suggestedServiceId);
        return {
          ruleId: o.ruleId,
          title: o.title,
          tier: tierForRule(o.ruleId),
          serviceName: service?.name ?? null,
          priceMin: o.priceMin,
          priceMax: o.priceMax,
          confidence: o.confidence,
          rationale: o.rationale,
          evidenceRefs: [...o.evidenceRefs],
          suggestedScope: [...o.suggestedScope],
          dedupeKey: o.dedupeKey,
        };
      });

      results.set(site.id, {
        id: site.id,
        name: site.name,
        domain: site.domain,
        vertical: site.vertical,
        offerings: [...site.offerings],
        crawl: {
          pagesFetched: evidence.site.pages.length,
          pagesReadable: readable,
          navCount: evidence.site.nav.length,
          sitemapUrls: evidence.site.sitemapUrls.length,
          links: evidence.site.links.length,
          crawlExhaustive: evidence.site.crawlExhaustive,
          blockedEvents,
        },
        coverage: {
          analyzable: result.coverage.analyzable,
          reason: result.coverage.reason,
          limitation: result.coverage.limitation,
          representedOfferings: result.coverage.representedOfferings,
          serviceLikePages: result.coverage.serviceLikePages,
        },
        outcome: classification.outcome,
        outcomeSummary: classification.summary,
        limitation: classification.limitation,
        catalogReach: {
          matched: result.catalogCoverage.matched,
          total: result.catalogCoverage.total,
          unmatchedLabels: [...result.catalogCoverage.unmatchedLabels],
        },
        stats: { ...result.stats },
        findings,
      });

      const f = findings.length;
      save();
      console.log(
        `${classification.outcome.toUpperCase()} | analyzable=${result.coverage.analyzable} | findings=${f} | aiCalls=${aiCalls}`,
      );
      for (const fd of findings) {
        console.log(
          `   -> [${fd.ruleId}] ${fd.title.slice(0, 80)} | conf=${fd.confidence}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      results.set(site.id, {
        id: site.id,
        name: site.name,
        domain: site.domain,
        vertical: site.vertical,
        offerings: [...site.offerings],
        error: message,
        findings: [],
      });
      save();
      console.log(`ERROR ${message}`);
    }
  }

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify([...results.values()], null, 2));
  const cs = cacheStats();
  console.log(
    `\ndone: ${results.size} site(s) | aiCalls=${aiCalls}/${MAX_AI_CALLS} | cache hits=${cs.hits} misses=${cs.misses} errors=${cs.errors} refused=${cs.refused}`,
  );
  console.log(`wrote ${OUT_FILE}`);
}



// ---------------------------------------------------------------------------
// Report: aggregate summary for the evidence doc
// ---------------------------------------------------------------------------

function report() {
  if (!existsSync(OUT_FILE)) {
    console.error("no results.json — run the analysis first");
    process.exit(1);
  }
  const results = JSON.parse(readFileSync(OUT_FILE, "utf8")) as SiteResult[];
  const errs = results.filter((r) => r.error);
  const byOutcome: Record<string, number> = {};
  for (const r of results) {
    if (r.error) continue;
    byOutcome[r.outcome ?? "?"] = (byOutcome[r.outcome ?? "?"] ?? 0) + 1;
  }
  const findings = results.flatMap((r) => r.findings.map((f) => ({ site: r.id, ...f })));
  const commercial = findings.filter((f) => f.tier === "commercial");
  const byRule: Record<string, number> = {};
  for (const f of findings) byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;

  console.log(`sites: ${results.length} (errors: ${errs.length})`);
  console.log(`outcomes:`, byOutcome);
  console.log(`findings: ${findings.length} total, ${commercial.length} commercial`);
  console.log(`by rule:`, byRule);
  console.log(`\ncommercial findings:`);
  for (const f of commercial) {
    console.log(`  ${f.site.padEnd(18)} [${f.ruleId}] ${f.title.slice(0, 70)} | conf=${f.confidence}`);
  }
  const evaluators = results.reduce((n, r) => n + (r.stats?.evaluated ?? 0), 0);
  const rejected = results.reduce((n, r) => n + (r.stats?.rejectedByEvaluator ?? 0), 0);
  const aiErr = results.reduce((n, r) => n + (r.stats?.evaluatorErrors ?? 0), 0);
  console.log(
    `\nevaluator: evaluated=${evaluators} rejected=${rejected} errors=${aiErr} surfaced=${findings.length}`,
  );
}

void main();
