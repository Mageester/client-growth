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
  it("discloses the summary and bounded public-page excerpts sent for catalog drafting", () => {
    const router = createMemoryRouter([
      { path: "/", element: createElement(CatalogAssistant) },
    ], { initialEntries: ["/"] });
    const html = renderToStaticMarkup(createElement(RouterProvider, { router }));

    expect(html).toContain("Build my service catalog");
    expect(html).toContain("summary");
    expect(html).toContain("bounded public-page excerpts");
    expect(html).toContain("No services are added to your catalog until you review and save the draft");
    expect(html).not.toContain("Nothing is saved until you review");
  });

  it("does not mistake blank review prices for explicit zero-dollar prices", () => {
    expect(reviewRowsAreValid([{ selected: true, name: "Web Design", description: "A complete website for the client.", priceMin: "", priceMax: "" }])).toBe(false);
    expect(reviewRowsAreValid([{ selected: true, name: "Web Design", description: "A complete website for the client.", priceMin: "0", priceMax: "0" }])).toBe(true);
  });
  it("rejects a request with neither a website nor a useful summary", async () => {
    const error = await generateAgencyCatalogDraft(
      scope,
      env,
      { website: "", summary: " " },
      undefined,
      { generator },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/describe the agency or add its website/i);
    expect((error as Error).message).not.toMatch(/"(?:code|path)"|\[\s*\{/i);
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
