import { z } from "zod";

import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { createAgencyCatalogGenerator } from "@/adapters/catalog/createAgencyCatalogGenerator";
import { parseCatalogGenerationCaps, parseEnv } from "@/config/env";
import { sanitizeCatalogDraft } from "@/core/agencyCatalogDraft";
import { ClientSchema, type Service } from "@/core/schema";
import {
  requireCatalogGenerationReservation,
  type CatalogGenerationAdmission,
} from "@/db/catalogGenerationLimits";
import * as repo from "@/db/repositories";
import type { TenantScope } from "@/db/tenant";
import type {
  AgencyCatalogGenerationPage,
  AgencyCatalogGenerator,
} from "@/ports/AgencyCatalogGenerator";

const CatalogRequestSchema = z
  .object({
    website: z.string().trim().max(500).default(""),
    summary: z.string().trim().max(4_000).default(""),
  })
  .refine((input) => input.website.length > 0 || input.summary.length >= 10, {
    message: "Enter an agency website or a summary of at least 10 characters.",
  });

interface CatalogCrawlResult {
  pages: AgencyCatalogGenerationPage[];
  limitation?: string;
}

interface CatalogAssistantDependencies {
  crawl?: (website: string, signal?: AbortSignal) => Promise<CatalogCrawlResult>;
  reserve?: (
    scope: TenantScope,
    options: { dailyLimit: number; platformDailyLimit: number },
  ) => Promise<CatalogGenerationAdmission>;
  generator?: AgencyCatalogGenerator;
  listServices?: (scope: TenantScope) => Promise<Service[]>;
}

function normalizedWebsite(value: string): string {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(candidate);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error("Enter a public HTTP or HTTPS agency website.");
  }
  return url.toString();
}

async function crawlAgencyWebsite(
  website: string,
  signal?: AbortSignal,
): Promise<CatalogCrawlResult> {
  const normalized = normalizedWebsite(website);
  const url = new URL(normalized);
  const evidence = await new HttpEvidenceProvider({ maxPages: 12, signal }).getEvidence(
    ClientSchema.parse({
      id: "agency-catalog-source",
      name: "Agency catalog source",
      domain: url.hostname,
      offerings: [],
      notes: "",
    }),
  );
  const pages = evidence.site.pages
    .filter((page) => page.status >= 200 && page.status < 300 && page.wordCount > 0)
    .map((page) => ({
      url: page.url,
      title: page.title,
      headings: [...page.h1s, ...page.headings].slice(0, 30),
      textExcerpt: page.textExcerpt.slice(0, 2_000),
    }));
  const limitation = evidence.networkEvents[0]?.reason;
  return { pages, limitation };
}

export async function generateAgencyCatalogDraft(
  scope: TenantScope,
  rawEnv: Record<string, unknown>,
  rawInput: { website?: string; summary?: string },
  signal?: AbortSignal,
  dependencies: CatalogAssistantDependencies = {},
) {
  const input = CatalogRequestSchema.parse(rawInput);
  let pages: AgencyCatalogGenerationPage[] = [];
  if (input.website) {
    const crawled = await (dependencies.crawl ?? crawlAgencyWebsite)(input.website, signal);
    pages = crawled.pages;
    if (pages.length === 0) {
      throw new Error(
        `Orbit could not read usable text from that agency website${crawled.limitation ? `: ${crawled.limitation}` : "."}`,
      );
    }
  }

  const env = parseEnv(rawEnv);
  const caps = parseCatalogGenerationCaps(rawEnv);
  const reserve = dependencies.reserve ?? requireCatalogGenerationReservation;
  const admission = await reserve(scope, {
    dailyLimit: caps.CATALOG_AI_WORKSPACE_DAILY_LIMIT,
    platformDailyLimit: caps.CATALOG_AI_PLATFORM_DAILY_LIMIT,
  });
  if (!admission.allowed) throw new Error(admission.limitation.reason);

  const existing = await (dependencies.listServices ?? repo.listServices)(scope);
  const generator = dependencies.generator ?? createAgencyCatalogGenerator(env);
  const generated = await generator.generate({ summary: input.summary, pages });
  const drafts = sanitizeCatalogDraft({
    raw: { services: generated },
    allowedPageUrls: pages.map((page) => page.url),
    existingServices: existing,
  });
  if (drafts.length === 0) {
    throw new Error("Orbit could not verify any new services from that information.");
  }
  return {
    drafts,
    pageCount: pages.length,
    sourceCount: new Set(drafts.flatMap((draft) => draft.sourceUrls)).size,
  };
}
