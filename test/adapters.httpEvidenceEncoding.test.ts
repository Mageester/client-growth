import { describe, expect, it, vi } from "vitest";

import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { ClientSchema } from "@/core/schema";

/**
 * Character encoding is an accuracy problem, not a cosmetic one.
 *
 * The crawled text becomes offering suggestions and the `detected` sentence
 * that is copied verbatim into a client-facing proposal draft. Decoding a
 * Windows-1252 page as UTF-8 put the offering "Pool Removal <U+FFFD> Riverview"
 * in front of a reviewer on thelawnsalon.ca in the analyzability corpus.
 */

const ORIGIN = "https://legacy.example";

/** "Pool Removal – Riverview": the en-dash is 0x96 in Windows-1252. */
function windows1252Page(): Uint8Array {
  const prefix = "<html><head><title>Services</title></head><body><h1>Pool Removal ";
  const suffix = " Riverview</h1></body></html>";
  const bytes: number[] = [];
  for (const ch of prefix) bytes.push(ch.charCodeAt(0));
  bytes.push(0x96);
  for (const ch of suffix) bytes.push(ch.charCodeAt(0));
  return new Uint8Array(bytes);
}

function makeFetch(contentType: string) {
  return vi.fn(async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === `${ORIGIN}/` || url === ORIGIN) {
      // The Workers Response type in this project does not accept a bare
      // Uint8Array, so hand it the underlying buffer.
      return new Response(windows1252Page().buffer as ArrayBuffer, {
        status: 200,
        headers: { "content-type": contentType },
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

const client = ClientSchema.parse({
  id: "client-legacy",
  name: "Legacy Co",
  domain: "legacy.example",
  offerings: [],
});

type Page = { title: string; h1s: string[]; headings: string[]; textExcerpt: string };

/** Everything the crawl kept as text, which is what reaches a proposal draft. */
const contentOf = (bundle: { site: { pages: Page[] } }) =>
  bundle.site.pages
    .map((page) => [page.title, ...page.h1s, ...page.headings, page.textExcerpt].join(" "))
    .join(" ");

describe("response decoding", () => {
  it("decodes a page using the charset the server declared", async () => {
    const provider = new HttpEvidenceProvider({ fetchImpl: makeFetch("text/html; charset=windows-1252") });
    const bundle = await provider.getEvidence(client);

    const content = contentOf(bundle);
    expect(content).not.toContain("�");
    expect(content).toContain("Pool Removal – Riverview");
  });

  it("still reads a page that declares no charset at all", async () => {
    // No declaration means UTF-8, which is both the standard's default and the
    // behaviour this replaced. The page must still be crawled, not dropped.
    const provider = new HttpEvidenceProvider({ fetchImpl: makeFetch("text/html") });
    const bundle = await provider.getEvidence(client);

    expect(bundle.site.pages.length).toBeGreaterThan(0);
    expect(bundle.site.pages[0]?.status).toBe(200);
  });

  it("falls back to UTF-8 rather than failing on an unknown charset label", async () => {
    const provider = new HttpEvidenceProvider({
      fetchImpl: makeFetch("text/html; charset=x-not-a-real-encoding"),
    });
    const bundle = await provider.getEvidence(client);

    expect(bundle.site.pages.length).toBeGreaterThan(0);
    expect(bundle.site.pages[0]?.status).toBe(200);
  });
});
