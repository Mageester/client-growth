import { describe, expect, it, vi } from "vitest";

import {
  catalogAssistantAvailable,
  catalogAssistantError,
  generateAgencyCatalogDraft,
} from "../app/lib/catalog-assistant.server";
import { reviewRowsAreValid } from "../app/components/catalog-assistant";
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
  it("reports configuration availability before the assistant accepts input", () => {
    expect(catalogAssistantAvailable({ AI_PROVIDER: "mock" })).toBe(false);
    expect(catalogAssistantAvailable({ AI_PROVIDER: "deepseek" })).toBe(false);
    expect(catalogAssistantAvailable({ AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "test" })).toBe(true);
  });

  it("turns validation internals into plain user-facing guidance", () => {
    const raw = new Error('[{"code":"custom","message":"Enter an agency website or a summary of at least 10 characters."}]');
    expect(catalogAssistantError(raw)).toBe(
      "Enter an agency website or a summary of at least 10 characters.",
    );
    expect(catalogAssistantError(new Error("The AI catalog assistant is not available in this environment."))).toMatch(/not available/i);
  });

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
