import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { generateAgencyCatalogDraft } from "../app/lib/catalog-assistant.server";
import { CatalogAssistant, reviewRowsAreValid } from "../app/components/catalog-assistant";
import type { AgencyCatalogGenerator } from "@/ports/AgencyCatalogGenerator";

const scope = { db: {} as never, workspaceId: "ws_test" };
const env = {
  AI_PROVIDER: "deepseek",
  DEEPSEEK_API_KEY: "test",
  CATALOG_AI_WORKSPACE_DAILY_LIMIT: "10",
  CATALOG_AI_PLATFORM_DAILY_LIMIT: "200",
};

const generator: AgencyCatalogGenerator = {
  generate: vi.fn(async () => [{
    name: "Web Design",
    description: "A conversion-focused website from strategy through launch.",
    sourceKind: "both" as const,
    sourceUrls: ["https://agency.example/services"],
  }]),
};

describe("agency catalog assistant orchestration", () => {
  it("does not mistake blank review prices for explicit zero-dollar prices", () => {
    expect(reviewRowsAreValid([{ selected: true, name: "Web Design", description: "A complete website for the client.", priceMin: "", priceMax: "" }])).toBe(false);
    expect(reviewRowsAreValid([{ selected: true, name: "Web Design", description: "A complete website for the client.", priceMin: "0", priceMax: "0" }])).toBe(true);
  });
  it("rejects a request with neither a website nor a useful summary", async () => {
    await expect(
      generateAgencyCatalogDraft(scope, env, { website: "", summary: " " }, undefined, {
        generator,
      }),
    ).rejects.toThrow(/website or.*summary/i);
  });

  it("crawls before reserving a paid call and does not charge an unreadable site", async () => {
    const reserve = vi.fn();
    await expect(
      generateAgencyCatalogDraft(
        scope,
        env,
        { website: "agency.example", summary: "" },
        undefined,
        {
          generator,
          crawl: async () => ({ pages: [], limitation: "No readable pages" }),
          reserve,
        },
      ),
    ).rejects.toThrow(/could not read/i);
    expect(reserve).not.toHaveBeenCalled();
  });

  it("returns a provenance-bound review draft without persisting services", async () => {
    const reserve = vi.fn(async () => ({
      allowed: true as const,
      reservationId: 1,
      reservedAt: "2026-09-08T00:00:00.000Z",
      dayUtc: "2026-09-08",
    }));
    const listServices = vi.fn(async () => []);
    const result = await generateAgencyCatalogDraft(
      scope,
      env,
      { website: "https://agency.example", summary: "We build websites and manage SEO." },
      undefined,
      {
        generator,
        reserve,
        listServices,
        crawl: async () => ({
          pages: [{
            url: "https://agency.example/services",
            title: "Services",
            headings: ["Web Design"],
            textExcerpt: "Web design and development",
          }],
        }),
      },
    );

    expect(result).toMatchObject({ pageCount: 1, sourceCount: 1, drafts: [{ name: "Web Design" }] });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(listServices).toHaveBeenCalledTimes(1);
  });
});

/**
 * The same disclosure has to be where the button is.
 *
 * A privacy page nobody has opened does not inform the click that sends an
 * agency's summary and public pages to a third-party model.
 */
describe("the catalog assistant discloses its transfer beside its action", () => {
  // useFetcher needs a data router, so the assistant is rendered inside one.
  const html = renderToStaticMarkup(
    createElement(RouterProvider, {
      router: createMemoryRouter(
        [{ path: "/", element: createElement(CatalogAssistant) }],
        { initialEntries: ["/"] },
      ),
    }),
  );

  it("names the summary, the public pages, and the provider next to the button", () => {
    const button = html.indexOf("Build my service catalog");
    expect(button).toBeGreaterThan(-1);
    expect(html).toMatch(/DeepSeek/);
    expect(html).toMatch(/headings/i);
    expect(html).toMatch(/excerpt/i);
  });

  it("keeps review-before-save and agency-set prices mandatory in the copy", () => {
    expect(html).toMatch(/Nothing is saved until you review/i);
  });
});
