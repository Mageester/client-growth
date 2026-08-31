import { describe, expect, it } from "vitest";

import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { brokenConversionPathRule } from "@/core/rules/brokenConversionPath";
import { ClientSchema, ServiceSchema } from "@/core/schema";

/**
 * LIVE: real crawl + real status probes, NO AI. Opt-in.
 *
 *   CG_LIVE_SCAN=1 pnpm eval:live
 *
 * Asserts only that the rule runs without crashing and that any surfaced defect
 * carries a real definite status / malformed value. Most sites are fine and the
 * result is an empty array — that is a pass.
 */
const DOMAIN = process.env.CG_LIVE_CONV_DOMAIN ?? "books.toscrape.com";

const CONVERSION_FIX = ServiceSchema.parse({
  id: "svc-conversion-fix",
  name: "Conversion Path Fix",
  description: "Repair a broken conversion element.",
  priceMin: 300,
  priceMax: 900,
  tags: ["conversion-fix"],
  active: true,
});

describe.skipIf(process.env.CG_LIVE_SCAN !== "1")("LIVE broken-conversion-path", () => {
  it("runs against a real site and only surfaces definite defects", async () => {
    const provider = new HttpEvidenceProvider({ maxPages: 8 });
    const client = ClientSchema.parse({
      id: "live",
      name: "Live",
      domain: DOMAIN,
      offerings: [],
    });
    const evidence = await provider.getEvidence(client);

    const candidates = await brokenConversionPathRule({
      client,
      catalog: [CONVERSION_FIX],
      evidence,
      probe: provider.probe.bind(provider),
      probeBudget: { remaining: 10 },
    });

    for (const c of candidates) {
      const d = c.conversionDefect!;
      const definite =
        d.kind === "malformed-tel" ||
        (d.kind === "broken-form-target" && d.observedStatus === undefined) ||
        (d.observedStatus !== undefined &&
          [404, 410, 405, 500, 502, 503].includes(d.observedStatus));
      expect(definite).toBe(true);
      // eslint-disable-next-line no-console
      console.log(`[live] ${d.kind} ${d.pageUrl} -> ${d.target ?? d.elementHref} (${d.observedStatus ?? "n/a"})`);
    }
    // eslint-disable-next-line no-console
    console.log(`[live] ${DOMAIN}: ${candidates.length} conversion defect(s)`);
  }, 60_000);
});
