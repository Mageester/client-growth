import { z } from "zod";

import type { Service } from "@/core/schema";
import { significantTokens } from "@/core/text";
import type { AgencyCatalogDraftItem } from "@/ports/AgencyCatalogGenerator";

export const AgencyCatalogDraftItemSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(10).max(500),
  sourceKind: z.enum(["website", "summary", "both"]),
  sourceUrls: z.array(z.string().url()).max(10),
}).strict();

const AgencyCatalogResponseSchema = z.object({
  services: z.array(AgencyCatalogDraftItemSchema).max(60),
}).strict();

function normalizedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isAllowedUrl(url: string | null, allowed: ReadonlySet<string>): url is string {
  return url !== null && allowed.has(url);
}

function meaningKey(value: string): string {
  return significantTokens(value)
    .map((token) => (token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token))
    .sort()
    .join(" ");
}

export function sanitizeCatalogDraft(input: {
  raw: unknown;
  allowedPageUrls: string[];
  existingServices: Service[];
}): AgencyCatalogDraftItem[] {
  const parsed = AgencyCatalogResponseSchema.parse(input.raw);
  const allowed = new Set(input.allowedPageUrls.map(normalizedUrl).filter((url): url is string => Boolean(url)));
  const seen = new Set(input.existingServices.map((service) => meaningKey(service.name)));
  const result: AgencyCatalogDraftItem[] = [];

  for (const row of parsed.services) {
    const key = meaningKey(row.name);
    if (!key || seen.has(key)) continue;
    const sourceUrls = [
      ...new Set(row.sourceUrls.map(normalizedUrl).filter((url) => isAllowedUrl(url, allowed))),
    ];
    if (row.sourceKind !== "summary" && sourceUrls.length === 0) continue;
    const clean = {
      ...row,
      sourceUrls: row.sourceKind === "summary" ? [] : sourceUrls,
    };
    seen.add(key);
    result.push(clean);
    if (result.length === 30) break;
  }
  return result;
}
