/**
 * Reconnaissance pass used once, by hand, to author the corpus.
 *
 * It prints each site's title, H1s and navigation labels so the offerings in
 * corpus.ts can be written the way a business owner would describe what they
 * sell — rather than copied out of URL slugs, which would make slug matching
 * look better than it is.
 */
import { join } from "node:path";
import { parseHtml } from "@/adapters/evidence/parseHtml";
import { createCachingFetch } from "./cache";

const CACHE_DIR = join(process.cwd(), ".analyzability-cache");

async function main(): Promise<void> {
  const domains = process.argv.slice(2);
  const { fetchImpl } = createCachingFetch({ dir: CACHE_DIR });
  for (const domain of domains) {
    try {
      const response = await fetchImpl(`https://${domain}/`, {
        headers: {
          "user-agent": "ClientGrowthBot/0.1 (+website evidence; operated by the agency)",
          accept: "text/html,application/xhtml+xml",
        },
      });
      if (!response.ok) {
        console.log(`\n### ${domain}  HTTP ${response.status}`);
        continue;
      }
      const parsed = parseHtml(await response.text(), `https://${domain}/`);
      console.log(`\n### ${domain}`);
      console.log(`title: ${parsed.page.title}`);
      console.log(`h1:    ${parsed.page.h1s.join(" | ")}`);
      console.log(`nav:   ${parsed.nav.slice(0, 45).join(" · ")}`);
      console.log(`heads: ${parsed.page.headings.slice(0, 25).join(" · ")}`);
    } catch (err) {
      console.log(`\n### ${domain}  ERROR ${(err as Error).message}`);
    }
  }
}

void main();
