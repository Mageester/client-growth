/**
 * Turns the analyzability corpus into a fixture the design harness can render,
 * so the product UI can be reviewed against real sites rather than invented
 * ones.
 *
 *   pnpm tsx scripts/analyzability/ui-fixture.ts [out.json]
 *
 * Everything here is real: the crawl is replayed from the on-disk cache, the
 * coverage assessment is the product's, and the candidates come from the actual
 * rule modules. The one thing that does NOT run is the AI evaluator, because it
 * costs money and needs a key — so a candidate's `rawConfidence` is carried
 * through as its confidence and no candidate is filtered out by judgment. The
 * harness labels the screen accordingly.
 *
 * Prices come from the benchmark agency catalog in test/bench/agency.ts, which
 * is a realistic small-agency price list rather than anyone's real quotes.
 *
 * Local only. Never imported by the Worker.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { assessServiceCoverage } from "@/core/absenceVerification";
import { classifyAnalysis, measureEvidenceReach } from "@/core/analysisOutcome";
import { runRules } from "@/core/rules";
import { assessCatalogCoverage } from "@/core/rules/registry";
import { ClientSchema, type Candidate, type EvidenceBundle } from "@/core/schema";

import { createCachingFetch } from "./cache";
import { CORPUS } from "./corpus";
import { AGENCY_SERVICES } from "../../test/bench/agency";

const CACHE_DIR = join(process.cwd(), ".analyzability-cache");
const outPath = process.argv[2] ?? ".analyzability-ui.json";

/** The catalog every corpus site is priced against. */
const CATALOG = AGENCY_SERVICES.filter((service) => service.active);

async function main() {
  const { fetchImpl } = createCachingFetch({ dir: CACHE_DIR, allowNetwork: false });

  const clients: unknown[] = [];
  const candidatesOut: unknown[] = [];

  for (const site of CORPUS) {
    const client = ClientSchema.parse({
      id: `corpus-${site.id}`,
      name: site.id
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
      domain: site.domain,
      offerings: site.offerings,
      notes: "",
    });

    let evidence: EvidenceBundle | null = null;
    try {
      evidence = await new HttpEvidenceProvider({ fetchImpl, maxPages: 10 }).getEvidence(client);
    } catch {
      evidence = null;
    }

    if (!evidence) {
      clients.push({ client, outcome: "inconclusive", summary: "The crawl could not run.", open: 0 });
      continue;
    }

    const coverage = assessServiceCoverage({ client, evidence });
    const reach = measureEvidenceReach(evidence);

    const candidates: Candidate[] = await runRules({
      client,
      catalog: CATALOG,
      evidence,
      coverage,
      fetchPage: (url) => new HttpEvidenceProvider({ fetchImpl }).fetchPage(url),
      verifyBudget: { remaining: 12 },
    });

    const outcome = classifyAnalysis({
      evidence,
      analyzable: coverage.analyzable,
      coverageReason: coverage.reason,
      coverageLimitation: coverage.limitation,
      surfaced: candidates.length,
      evaluatorErrors: 0,
      catalog: assessCatalogCoverage(CATALOG),
    });

    for (const candidate of candidates) {
      const service = CATALOG.find((s) => s.id === candidate.suggestedServiceId);
      candidatesOut.push({
        clientId: client.id,
        clientName: client.name,
        clientDomain: client.domain,
        serviceName: service?.name ?? "Unmapped",
        opportunity: {
          id: `${client.id}-${candidatesOut.length}`,
          dedupeKey: `${client.id}-${candidate.subject}`,
          clientId: client.id,
          ruleId: candidate.ruleId,
          title: titleFor(candidate),
          detected: candidate.detected,
          evidenceRefs: candidate.evidenceRefs,
          rationale: candidate.detected,
          suggestedServiceId: candidate.suggestedServiceId,
          suggestedScope: [],
          priceMin: service?.priceMin ?? 0,
          priceMax: service?.priceMax ?? 0,
          confidence: candidate.rawConfidence,
          billableStatus: "billable",
          status: "new",
          updatedAt: new Date().toISOString(),
        },
      });
    }

    clients.push({
      client,
      outcome: outcome.outcome,
      summary: outcome.summary,
      limitation: outcome.limitation,
      open: candidates.length,
      pagesRead: reach.readablePages,
      analyzable: coverage.analyzable,
    });
  }

  const path = join(process.cwd(), outPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), catalog: CATALOG, clients, candidates: candidatesOut },
      null,
      2,
    ),
    "utf8",
  );
  console.log(
    `wrote ${outPath}: ${clients.length} clients, ${candidatesOut.length} candidate finding(s)`,
  );
}

function titleFor(candidate: Candidate): string {
  if (candidate.ruleId === "no-service-pages") {
    return `${candidate.subject} describes none of its services`;
  }
  if (candidate.ruleId === "broken-conversion-path") {
    return `Broken conversion path: ${candidate.subject}`;
  }
  return `No page for ${candidate.subject}`;
}

void main();
