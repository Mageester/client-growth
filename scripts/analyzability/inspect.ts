/**
 * Per-site crawl inspector.
 *
 *   pnpm tsx scripts/analyzability/inspect.ts <corpus-id> [...]
 *
 * Prints what the crawler actually saw for one site — every page it kept, every
 * request it refused and why, the links it discovered, and the offerings the
 * evidence would suggest. This is the tool the failure classification in the
 * benchmark is checked against by hand; it never writes anything.
 */
import { join } from "node:path";

import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { assessServiceCoverage } from "@/core/absenceVerification";
import { suggestOfferings } from "@/core/offeringSuggestions";
import { ClientSchema } from "@/core/schema";

import { createCachingFetch } from "./cache";
import { CORPUS } from "./corpus";

const CACHE_DIR = join(process.cwd(), ".analyzability-cache");

async function main(): Promise<void> {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const offline = process.argv.includes("--offline");
  const { fetchImpl } = createCachingFetch({ dir: CACHE_DIR, allowNetwork: !offline });

  for (const id of ids) {
    const site = CORPUS.find((s) => s.id === id);
    if (!site) {
      console.log(`\n!! no corpus site called "${id}"`);
      continue;
    }
    const client = ClientSchema.parse({
      id: `bench-${site.id}`,
      name: site.id,
      domain: site.domain,
      offerings: site.offerings,
      notes: "",
    });
    const provider = new HttpEvidenceProvider({ fetchImpl, maxPages: 10 });
    const evidence = await provider.getEvidence(client);
    const coverage = assessServiceCoverage({ client, evidence });

    console.log(`\n================ ${site.domain} ================`);
    console.log(`coverage: ${coverage.analyzable ? "ANALYZABLE" : "inconclusive"} — ${coverage.reason}`);

    console.log(`\npages (${evidence.site.pages.length}):`);
    for (const page of evidence.site.pages) {
      console.log(`  ${String(page.status).padEnd(4)} ${String(page.wordCount).padEnd(6)} ${page.url}`);
      if (page.title) console.log(`       title: ${page.title.slice(0, 90)}`);
    }

    console.log(`\nnetwork events (${evidence.networkEvents.length}):`);
    for (const event of evidence.networkEvents) {
      console.log(`  ${event.outcome.padEnd(13)} ${event.url}`);
      console.log(`       ${event.reason}`);
    }

    console.log(`\nnav (${evidence.site.nav.length}): ${evidence.site.nav.slice(0, 30).join(" · ")}`);
    console.log(`\nsitemap urls (${evidence.site.sitemapUrls.length}):`);
    for (const url of evidence.site.sitemapUrls.slice(0, 30)) console.log(`  ${url}`);

    const httpLinks = evidence.site.links.filter((l) => l.scheme === "http");
    console.log(`\nhttp links (${httpLinks.length}):`);
    for (const link of httpLinks.slice(0, 40)) {
      console.log(`  ${link.inNav ? "nav " : "    "}${link.href}  «${link.label.slice(0, 44)}»`);
    }

    const suggestions = suggestOfferings({ evidence, existingOfferings: site.offerings });
    console.log(`\nsuggested offerings (${suggestions.length}):`);
    for (const suggestion of suggestions) {
      console.log(`  [${suggestion.confidence}] ${suggestion.label}`);
      for (const item of suggestion.evidence) console.log(`      - ${item.detail}`);
    }
  }
}

void main();
