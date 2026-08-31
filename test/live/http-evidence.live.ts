import { describe, expect, it } from "vitest";

import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { ClientSchema } from "@/core/schema";

/**
 * LIVE: real HTTP crawl. Opt-in via `pnpm eval:live`. Skipped unless
 * CG_LIVE_SCAN=1 so a plain `pnpm eval:live` (for the DeepSeek test) does not
 * also hit the network.
 *
 *   CG_LIVE_SCAN=1 pnpm eval:live
 *
 * books.toscrape.com is a public sandbox site built for scraping practice.
 */
describe.skipIf(process.env.CG_LIVE_SCAN !== "1")("LIVE http evidence crawl", () => {
  it("crawls a real multi-page site and extracts structured evidence", async () => {
    const provider = new HttpEvidenceProvider({ maxPages: 6 });
    const client = ClientSchema.parse({
      id: "live-toscrape",
      name: "Toscrape",
      domain: "books.toscrape.com",
      offerings: [],
    });

    const bundle = await provider.getEvidence(client);

    expect(bundle.source).toBe("http");
    expect(bundle.site.pages.length).toBeGreaterThanOrEqual(3);
    expect(bundle.site.pages.length).toBeLessThanOrEqual(6);
    for (const page of bundle.site.pages) {
      expect(page.url.startsWith("https://books.toscrape.com")).toBe(true);
      expect(page.title.length).toBeGreaterThan(0);
    }

    // eslint-disable-next-line no-console
    console.log(
      `[live] crawled ${bundle.site.pages.length} pages: ` +
        bundle.site.pages.map((p) => p.title).join(" | "),
    );
  }, 30_000);
});
