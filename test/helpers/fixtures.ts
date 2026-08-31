import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ClientSchema,
  CoverageSchema,
  EvidenceBundleSchema,
  ServiceSchema,
  type Client,
  type Coverage,
  type EvidenceBundle,
  type Service,
} from "@/core/schema";

const here = dirname(fileURLToPath(import.meta.url));
const hvacDir = join(here, "..", "..", "fixtures", "hvac");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(hvacDir, name), "utf8"));
}

export function loadRawHtml(name: string): string {
  return readFileSync(join(hvacDir, "raw", name), "utf8");
}

export function hvacClient(): Client {
  return ClientSchema.parse(readJson("client.json"));
}

export function hvacCatalog(): Service[] {
  const raw = readJson("catalog.json") as unknown[];
  return raw.map((s) => ServiceSchema.parse(s));
}

export function hvacEvidence(): EvidenceBundle {
  return EvidenceBundleSchema.parse(readJson("evidence.json"));
}

export function coverageNone(): Coverage[] {
  return (readJson("coverage.none.json") as unknown[]).map((c) => CoverageSchema.parse(c));
}

export function coverageLandingPages(): Coverage[] {
  return (readJson("coverage.landing-pages.json") as unknown[]).map((c) =>
    CoverageSchema.parse(c),
  );
}
