/**
 * GRAUNTLET VERIFIER — human-grade support for each surfaced absence finding.
 *
 * For every commercial finding in results.json this fetches, through the same
 * polite on-disk cache as the gauntlet run:
 *   1. the site's /sitemap.xml (following up to 5 sitemap-index children)
 *   2. a handful of candidate slug URLs for the missing service
 * and reports whether the service has existing site coverage the pipeline
 * missed (=> FALSE_POSITIVE / DUPLICATE_OR_EQUIVALENT) or not (=> the claim
 * stands, graded on commercial sense).
 *
 *   pnpm tsx scripts/gauntlet/verify.ts
 *
 * Read-only, bounded, cached. Results go to verify.json.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createCachingFetch } from "../analyzability/cache";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const RESULTS = join(HERE, "results.json");
const OUT = join(HERE, "verify.json");
const CACHE_DIR = join(ROOT, ".analyzability-cache");

interface Finding {
  ruleId: string;
  title: string;
  tier: string;
  dedupeKey: string;
}
interface SiteResult {
  id: string;
  domain: string;
  offerings: string[];
  findings: Finding[];
}

/** Slug candidates for a subject like "Stump Grinding — dedicated service page". */
function slugCandidates(subject: string, domain: string): string[] {
  const base = subject
    .toLowerCase()
    .replace(/—.*$/, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  const schemes = new Set<string>();
  // Known per-site URL schemes (from the crawled pages themselves).
  if (domain.includes("cambridgeheating")) schemes.add(`${base}.html`);
  else if (domain.includes("bartlett")) schemes.add(`services/${base}`);
  else if (domain.includes("russelllandscape")) schemes.add(`services/${base}/`);
  else if (domain.includes("davey")) schemes.add(`residential-tree-services/${base}/`);
  else if (domain.includes("romanelectric")) schemes.add(`electrical/${base}/`);
  else if (domain.includes("interstateroofing")) {
    schemes.add(`or/${base}`);
    schemes.add(`wa/${base}`);
    schemes.add(base);
  } else {
    schemes.add(base);
    schemes.add(`${base}/`);
  }
  return [...schemes].map((s) => `https://${domain}/${s}`);
}

/** Does the HTML carry real service content (not just a soft-404 shell)? */
function bodySaysService(html: string, tokens: string[]): boolean {
  const text = html.toLowerCase();
  const joined = tokens.map((t) => t.toLowerCase());
  // Every token must appear somewhere in the body (title/h1/slug/text).
  return joined.every((t) => text.includes(t));
}

function tokensOf(subject: string): string[] {
  return subject
    .toLowerCase()
    .replace(/—.*$/, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3);
}

async function main() {
  const cachingFetch = createCachingFetch({
    dir: CACHE_DIR,
    allowNetwork: true,
    maxLiveRequests: 400,
    perHostDelayMs: 1200,
    timeoutMs: 15_000,
  });
  const fetchImpl = cachingFetch.fetchImpl;

  const results = JSON.parse(readFileSync(RESULTS, "utf8")) as SiteResult[];
  const out: Record<string, unknown>[] = [];
  mkdirSync(dirname(OUT), { recursive: true });

  for (const site of results) {
    if (!site.findings?.length) continue;
    const root = `https://${site.domain}`;
    const sitemapUrls = [`${root}/sitemap.xml`, `${root}/sitemap_index.xml`, `${root}/sitemap-index.xml`];

    // 1. Sitemap: collect URLs, follow small indexes.
    const sitemapEntries: string[] = [];
    const fetchedIndexes: string[] = [];
    for (const sm of sitemapUrls) {
      try {
        const res = await fetchImpl(sm);
        if (!res.ok) continue;
        const xml = await res.text();
        fetchedIndexes.push(sm);
        const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
          .map((m) => m[1])
          .filter((u): u is string => Boolean(u));
        // Index? fetch up to 5 children.
        const children = urls.filter((u) => u.endsWith(".xml")).slice(0, 5);
        if (children.length > 0 && urls.some((u) => !u.endsWith(".xml")) === false) {
          sitemapEntries.push(...urls);
          for (const child of children) {
            try {
              const r2 = await fetchImpl(child);
              if (!r2.ok) continue;
              const x2 = await r2.text();
              sitemapEntries.push(
                ...[...x2.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
                  .map((m) => m[1])
                  .filter((u): u is string => Boolean(u)),
              );
            } catch {
              /* child sitemap unreachable */
            }
          }
        } else {
          sitemapEntries.push(...urls.filter((u) => !u.endsWith(".xml")));
        }
        break; // first sitemap that answered is the site's canonical one
      } catch {
        /* try next */
      }
    }

    for (const f of site.findings) {
      const tokens = tokensOf(f.title);
      const candidates = slugCandidates(f.title, site.domain).slice(0, 4);
      const checked: { url: string; status: number; serviceContent: boolean }[] = [];

      for (const url of candidates) {
        try {
          const res = await fetchImpl(url);
          const html = res.ok ? await res.text() : "";
          const finalUrl = res.url || url;
          checked.push({
            url: finalUrl,
            status: res.status,
            serviceContent: res.ok ? bodySaysService(html, tokens) : false,
          });
        } catch {
          checked.push({ url, status: 0, serviceContent: false });
        }
      }

      // Sitemap coverage: any sitemap URL containing every token?
      const smHits = sitemapEntries.filter((u) => {
        const lu = u.toLowerCase();
        return tokens.every((t) => lu.includes(t));
      });

      out.push({
        site: site.id,
        domain: site.domain,
        finding: f.title,
        tokens,
        sitemapProbed: fetchedIndexes,
        sitemapUrlCount: sitemapEntries.length,
        sitemapHits: smHits.slice(0, 5),
        candidateChecks: checked,
        verdict:
          smHits.length > 0
            ? "PAGE_EXISTS_IN_SITEMAP"
            : checked.some((c) => c.status === 200 && c.serviceContent)
              ? "PAGE_EXISTS_200"
              : checked.some((c) => c.status >= 300 && c.status < 400)
                ? "REDIRECT_INSPECT"
                : "NO_PAGE_FOUND",
      });

      console.log(
        `${site.id.padEnd(18)} ${f.title.slice(0, 44).padEnd(44)} -> ${
          smHits.length ? "SITEMAP HIT: " + smHits[0] : (out[out.length - 1]?.verdict ?? "?")
        }`,
      );
      writeFileSync(OUT, JSON.stringify(out, null, 2));
    }
  }
  const cs = cachingFetch.stats;
  console.log(`\nverify done: cache hits=${cs.hits} misses=${cs.misses} errors=${cs.errors}`);
  console.log(`wrote ${OUT}`);
}

void main();
