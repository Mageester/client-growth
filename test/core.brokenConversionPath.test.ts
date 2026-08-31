import { describe, expect, it, vi } from "vitest";

import { brokenConversionPathRule } from "@/core/rules/brokenConversionPath";
import type { RuleContext } from "@/core/rules/context";
import type { ProbeResult } from "@/ports/EvidenceProvider";
import {
  ClientSchema,
  EvidenceBundleSchema,
  ServiceSchema,
  type EvidenceBundle,
} from "@/core/schema";

const CONVERSION_FIX = ServiceSchema.parse({
  id: "svc-conversion-fix",
  name: "Conversion Path Fix",
  description: "Diagnose and repair a broken conversion element.",
  priceMin: 300,
  priceMax: 900,
  tags: ["conversion-fix"],
  active: true,
});

const client = ClientSchema.parse({
  id: "c1",
  name: "Acme",
  domain: "acme.example",
  offerings: [],
});

function bundle(site: {
  pages?: Array<{
    url: string;
    status?: number;
    title?: string;
    forms?: Array<{ action: string; method?: "GET" | "POST"; hasSubmit?: boolean }>;
  }>;
  links?: Array<{
    href: string;
    label?: string;
    ariaLabel?: string;
    scheme?: "http" | "tel" | "mailto";
    foundOn?: string[];
  }>;
}): EvidenceBundle {
  return EvidenceBundleSchema.parse({
    clientId: "c1",
    source: "http",
    capturedAt: "2026-08-31T00:00:00.000Z",
    site: {
      pages: (site.pages ?? []).map((p) => ({
        url: p.url,
        status: p.status ?? 200,
        title: p.title ?? "",
        h1s: [],
        headings: [],
        textExcerpt: "",
        wordCount: 100,
        forms: (p.forms ?? []).map((f) => ({
          action: f.action,
          method: f.method ?? "GET",
          hasSubmit: f.hasSubmit ?? true,
        })),
      })),
      nav: [],
      links: (site.links ?? []).map((l) => ({
        href: l.href,
        label: l.label ?? "",
        ariaLabel: l.ariaLabel ?? "",
        title: "",
        scheme: l.scheme ?? "http",
        inNav: false,
        foundOn: l.foundOn ?? ["https://acme.example/"],
      })),
      sitemapUrls: [],
    },
  });
}

function ctx(evidence: EvidenceBundle, probeMap: Record<string, number>): RuleContext {
  const probe = vi.fn(
    async (url: string): Promise<ProbeResult> => ({
      requestedUrl: url,
      status: probeMap[url] ?? 200,
      finalUrl: url,
      ok: (probeMap[url] ?? 200) < 400,
    }),
  );
  return {
    client,
    catalog: [CONVERSION_FIX],
    evidence,
    probe,
    probeBudget: { remaining: 12 },
  };
}

describe("broken-conversion-path", () => {
  it("no conversion-fix service in the catalog -> nothing", async () => {
    const c = ctx(
      bundle({ links: [{ href: "https://acme.example/quote", label: "Get a Quote" }] }),
      { "https://acme.example/quote": 404 },
    );
    c.catalog = [];
    expect(await brokenConversionPathRule(c)).toEqual([]);
  });

  it("dead same-origin conversion link (404) -> candidate with exact evidence", async () => {
    const ev = bundle({
      pages: [{ url: "https://acme.example/" }],
      links: [
        { href: "https://acme.example/free-estimate", label: "Get a Free Estimate", foundOn: ["https://acme.example/"] },
      ],
    });
    const [cand] = await brokenConversionPathRule(ctx(ev, { "https://acme.example/free-estimate": 404 }));
    expect(cand?.ruleId).toBe("broken-conversion-path");
    expect(cand?.conversionDefect?.kind).toBe("dead-conversion-link");
    expect(cand?.conversionDefect?.observedStatus).toBe(404);
    expect(cand?.detected).toContain("https://acme.example/free-estimate");
    expect(cand?.detected).toContain("404");
    expect(cand?.evidenceRefs).toContain("target:https://acme.example/free-estimate");
    expect(cand?.evidenceRefs).toContain("status:404");
  });

  it("REGRESSION: a POST form whose action returns GET 405 does NOT surface", async () => {
    const ev = bundle({
      pages: [
        {
          url: "https://acme.example/contact",
          forms: [{ action: "/wp/form-handler.php", method: "POST" }],
        },
      ],
    });
    const cands = await brokenConversionPathRule(
      ctx(ev, { "https://acme.example/wp/form-handler.php": 405 }),
    );
    expect(cands).toEqual([]);
  });

  it("REGRESSION: a 403 conversion link does NOT surface", async () => {
    const ev = bundle({
      links: [{ href: "https://acme.example/get-a-quote", label: "Request a Quote" }],
    });
    const cands = await brokenConversionPathRule(
      ctx(ev, { "https://acme.example/get-a-quote": 403 }),
    );
    expect(cands).toEqual([]);
  });

  it("REGRESSION: tel:000-0000 and tel:XXX-XXX-XXXX surface as malformed", async () => {
    const ev = bundle({
      pages: [{ url: "https://acme.example/" }, { url: "https://acme.example/services" }],
      links: [
        { href: "tel:000-0000", label: "Call now", scheme: "tel", foundOn: ["https://acme.example/"] },
        { href: "tel:XXX-XXX-XXXX", label: "Call", scheme: "tel", foundOn: ["https://acme.example/services"] },
      ],
    });
    const cands = await brokenConversionPathRule(ctx(ev, {}));
    expect(cands).toHaveLength(2);
    expect(cands.every((c) => c.conversionDefect?.kind === "malformed-tel")).toBe(true);
    expect(cands.map((c) => c.conversionDefect?.elementHref).sort()).toEqual([
      "tel:000-0000",
      "tel:XXX-XXX-XXXX",
    ]);
  });

  it("REGRESSION: an external WORKING booking URL does NOT surface", async () => {
    const ev = bundle({
      links: [
        {
          href: "https://app.housecallpro.com/schedule/acme-hvac",
          label: "Book Online",
        },
      ],
    });
    const probe = vi.fn(async (url: string): Promise<ProbeResult> => ({
      requestedUrl: url,
      status: 200,
      finalUrl: url,
      ok: true,
    }));
    const cands = await brokenConversionPathRule({
      client,
      catalog: [CONVERSION_FIX],
      evidence: ev,
      probe,
      probeBudget: { remaining: 12 },
    });
    expect(cands).toEqual([]);
    // We must never probe arbitrary external providers.
    expect(probe).not.toHaveBeenCalled();
  });

  it("REGRESSION: an external OBVIOUS placeholder booking URL DOES surface", async () => {
    const ev = bundle({
      links: [
        {
          href: "https://booking.example.com/YOUR-CALENDAR-ID",
          label: "Book Online",
          foundOn: ["https://acme.example/"],
        },
      ],
    });
    const [cand] = await brokenConversionPathRule(ctx(ev, {}));
    expect(cand?.conversionDefect?.kind).toBe("dead-conversion-link");
    expect(cand?.conversionDefect?.target).toContain("YOUR-CALENDAR-ID");
    expect(cand?.detected.toLowerCase()).toContain("placeholder");
  });

  it("conversion page crawled with status 500 (repeat-confirmed) -> candidate", async () => {
    const ev = bundle({
      pages: [
        { url: "https://acme.example/" },
        { url: "https://acme.example/contact-us", status: 500 },
      ],
      links: [
        { href: "https://acme.example/contact-us", label: "Contact", foundOn: ["https://acme.example/"] },
      ],
    });
    const [cand] = await brokenConversionPathRule(
      ctx(ev, { "https://acme.example/contact-us": 500 }),
    );
    expect(cand?.conversionDefect?.kind).toBe("dead-conversion-link");
    expect(cand?.conversionDefect?.observedStatus).toBe(500);
  });

  it("transient 500 that clears on re-probe -> does NOT surface", async () => {
    const ev = bundle({
      pages: [{ url: "https://acme.example/" }],
      links: [{ href: "https://acme.example/quote", label: "Get a Quote", foundOn: ["https://acme.example/"] }],
    });
    let call = 0;
    const probe = vi.fn(async (url: string): Promise<ProbeResult> => {
      call++;
      const status = call === 1 ? 503 : 200;
      return { requestedUrl: url, status, finalUrl: url, ok: status < 400 };
    });
    const cands = await brokenConversionPathRule({
      client,
      catalog: [CONVERSION_FIX],
      evidence: ev,
      probe,
      probeBudget: { remaining: 12 },
    });
    expect(cands).toEqual([]);
  });

  it("placeholder form action -> candidate without probing", async () => {
    const ev = bundle({
      pages: [
        {
          url: "https://acme.example/contact",
          forms: [{ action: "https://formspree.io/f/xxxx", method: "POST" }],
        },
      ],
    });
    const [cand] = await brokenConversionPathRule(ctx(ev, {}));
    expect(cand?.conversionDefect?.kind).toBe("broken-form-target");
    expect(cand?.detected).toContain("placeholder");
  });

  it("GET form action returning 404 -> candidate; action='#' -> nothing", async () => {
    const ev = bundle({
      pages: [
        { url: "https://acme.example/a", forms: [{ action: "/handler", method: "GET" }] },
        { url: "https://acme.example/b", forms: [{ action: "#", method: "GET" }] },
      ],
    });
    const cands = await brokenConversionPathRule(
      ctx(ev, { "https://acme.example/handler": 404 }),
    );
    expect(cands).toHaveLength(1);
    expect(cands[0]?.conversionDefect?.kind).toBe("broken-form-target");
    expect(cands[0]?.conversionDefect?.observedStatus).toBe(404);
  });

  it("healthy: contact link 200 + working form -> nothing", async () => {
    const ev = bundle({
      pages: [
        { url: "https://acme.example/" },
        {
          url: "https://acme.example/contact",
          forms: [{ action: "/contact/submit", method: "GET" }],
        },
      ],
      links: [{ href: "https://acme.example/contact", label: "Contact Us", foundOn: ["https://acme.example/"] }],
    });
    const cands = await brokenConversionPathRule(
      ctx(ev, {
        "https://acme.example/contact": 200,
        "https://acme.example/contact/submit": 200,
      }),
    );
    expect(cands).toEqual([]);
  });

  it("non-conversion 404 (Careers link) -> nothing", async () => {
    const ev = bundle({
      links: [{ href: "https://acme.example/careers", label: "Careers" }],
    });
    const cands = await brokenConversionPathRule(
      ctx(ev, { "https://acme.example/careers": 404 }),
    );
    expect(cands).toEqual([]);
  });

  it("status 0 (network error) -> inconclusive, nothing", async () => {
    const ev = bundle({
      links: [{ href: "https://acme.example/quote", label: "Get a Quote" }],
    });
    const cands = await brokenConversionPathRule(
      ctx(ev, { "https://acme.example/quote": 0 }),
    );
    expect(cands).toEqual([]);
  });

  it("dedupes: same dead target linked from 3 pages -> 1 candidate, 3 pages in evidence", async () => {
    const ev = bundle({
      pages: [
        { url: "https://acme.example/services/ac-repair" },
        { url: "https://acme.example/services/furnace" },
        { url: "https://acme.example/services/duct" },
      ],
      links: [
        {
          href: "https://acme.example/request",
          label: "Request Service",
          foundOn: [
            "https://acme.example/services/ac-repair",
            "https://acme.example/services/furnace",
            "https://acme.example/services/duct",
          ],
        },
      ],
    });
    const cands = await brokenConversionPathRule(
      ctx(ev, { "https://acme.example/request": 410 }),
    );
    expect(cands).toHaveLength(1);
    expect(cands[0]?.conversionDefect?.seenOn).toHaveLength(3);
    expect(cands[0]?.detected).toContain("Appears on 3 pages");
  });
});
