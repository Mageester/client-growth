import { describe, expect, it, vi } from "vitest";

import { isPlatformInfrastructurePath } from "@/core/siteStructure";
import { runRules } from "@/core/rules";
import { ClientSchema, EvidenceBundleSchema, ServiceSchema } from "@/core/schema";

const ORIGIN = "https://ex.example";

const client = ClientSchema.parse({
  id: "c1",
  name: "Example",
  domain: "ex.example",
  offerings: ["drain cleaning"],
});

const catalog = [
  ServiceSchema.parse({
    id: "svc-broken",
    name: "Repair a broken internal link",
    description: "",
    priceMin: 200,
    priceMax: 500,
    tags: ["broken-internal-link"],
    active: true,
  }),
];

/** A site whose only "broken" link is Cloudflare's email-obfuscation endpoint. */
function evidenceWithCloudflareEmailLink() {
  return EvidenceBundleSchema.parse({
    clientId: client.id,
    source: "http",
    capturedAt: "2026-09-06T00:00:00.000Z",
    site: {
      pages: [
        {
          url: `${ORIGIN}/`,
          status: 200,
          title: "Home",
          h1s: ["Home"],
          headings: [],
          textExcerpt: "",
          wordCount: 400,
        },
      ],
      links: [
        {
          href: `${ORIGIN}/cdn-cgi/l/email-protection`,
          label: "[email protected]",
          scheme: "http",
          inNav: false,
          foundOn: [`${ORIGIN}/`],
        },
      ],
    },
  });
}

describe("platform-injected paths", () => {
  it("recognises Cloudflare's reserved namespace and nothing else", () => {
    for (const url of [
      `${ORIGIN}/cdn-cgi/l/email-protection`,
      `${ORIGIN}/cdn-cgi/trace`,
      `${ORIGIN}/cdn-cgi`,
    ]) {
      expect(isPlatformInfrastructurePath(url), url).toBe(true);
    }
    // Not a suppression list for anything that merely looks technical.
    for (const url of [
      `${ORIGIN}/services/drain-cleaning`,
      `${ORIGIN}/cdn`,
      `${ORIGIN}/my-cdn-cgi-page`,
      `${ORIGIN}/blog/cdn-cgi-explained`,
      "not a url",
    ]) {
      expect(isPlatformInfrastructurePath(url), url).toBe(false);
    }
  });

  it("never calls Cloudflare's email obfuscation a broken link", async () => {
    // Found by auditing the corpus: this was the ONLY thing the broken-link
    // rule found across 24 real sites, and it was wrong. The path 404s to a bot
    // and is rewritten to a working mailto: by Cloudflare's own script, so the
    // agency would have taken a fault report to a client whose email links work.
    const probe = vi.fn(async (url: string) => ({
      requestedUrl: url,
      status: 404,
      finalUrl: url,
      ok: false,
      outcome: "complete" as const,
    }));

    const candidates = await runRules({
      client,
      catalog,
      evidence: evidenceWithCloudflareEmailLink(),
      probe,
      probeBudget: { remaining: 20 },
    });

    expect(candidates.filter((c) => c.ruleId === "broken-internal-link")).toEqual([]);
    // And it must not even be requested: probing it wastes the budget that a
    // genuinely broken link needs.
    expect(probe).not.toHaveBeenCalled();
  });
});
