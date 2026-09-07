import { z } from "zod";

import { classifyCommercialLanguage } from "@/core/commercialLanguage";
import { significantTokens, titleCase } from "@/core/text";

/**
 * The first external-source adapter is deliberately narrow. It accepts an
 * owner-authorized export from an official business profile, not a URL scraped
 * from a directory, a review, a social post, or an advert.
 */
export const EXTERNAL_PROFILE_PROVIDER = "google-business-profile-export" as const;
export const EXTERNAL_PROFILE_AUTHORIZATION = "owner-authorized-export" as const;
export const EXTERNAL_PROFILE_SOURCE_FIELD = "services" as const;
export const EXTERNAL_CLAIM_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const ExternalSemanticStateSchema = z.enum([
  "accepted",
  "ambiguous",
  "rejected",
  "stale",
  "conflicting",
]);
export type ExternalSemanticState = z.infer<typeof ExternalSemanticStateSchema>;

export const ExternalBusinessClaimSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  clientId: z.string().min(1),
  provider: z.literal(EXTERNAL_PROFILE_PROVIDER),
  sourceRecordId: z.string().min(1),
  sourceUrl: z.string().url(),
  authorization: z.literal(EXTERNAL_PROFILE_AUTHORIZATION),
  rawServiceLabel: z.string().min(1),
  sourceField: z.literal(EXTERNAL_PROFILE_SOURCE_FIELD),
  observedAt: z.string().min(1),
  retrievedAt: z.string().min(1),
  sourceHash: z.string().min(1),
  sourceVersion: z.string().min(1).optional(),
  normalizedLabel: z.string().min(1),
  semanticState: ExternalSemanticStateSchema,
  semanticReason: z.string().min(1),
});
export type ExternalBusinessClaim = z.infer<typeof ExternalBusinessClaimSchema>;

export const OfficialBusinessProfileExportSchema = z.object({
  provider: z.literal(EXTERNAL_PROFILE_PROVIDER),
  sourceRecordId: z.string().min(1),
  sourceUrl: z.string().url(),
  authorization: z.literal(EXTERNAL_PROFILE_AUTHORIZATION),
  sourceField: z.string().min(1),
  observedAt: z.string().min(1),
  retrievedAt: z.string().min(1),
  sourceVersion: z.string().min(1).optional(),
  services: z.array(z.string()).min(1).max(100),
});
export type OfficialBusinessProfileExport = z.infer<typeof OfficialBusinessProfileExportSchema>;

interface ImportScope {
  workspaceId: string;
  clientId: string;
}

export type OfficialBusinessProfileImportResult =
  | { ok: true; claims: ExternalBusinessClaim[]; rejectedLabels: string[] }
  | { ok: false; error: string };

interface LabelDecision {
  normalizedLabel: string;
  semanticState: Exclude<ExternalSemanticState, "stale" | "conflicting">;
  semanticReason: string;
}

const BROAD_LABELS = new Set([
  "business",
  "consulting",
  "general services",
  "other",
  "products",
  "services",
  "solutions",
  "support",
]);

function parseTime(value: string): number | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function officialProfileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "business.google.com" || url.hostname === "www.business.google.com")
    );
  } catch {
    return false;
  }
}

function cleanLabel(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[\s–—-]+|[\s–—\-:|,.]+$/g, "")
    .trim();
}

function labelKey(label: string): string {
  return significantTokens(label).slice().sort().join(" ") || label.toLowerCase();
}

function decideLabel(raw: string): LabelDecision | null {
  const cleaned = cleanLabel(raw);
  if (!cleaned) return null;
  if (cleaned.length < 3 || cleaned.length > 80 || cleaned.split(/\s+/).length > 8) {
    return {
      normalizedLabel: titleCase(cleaned),
      semanticState: "rejected",
      semanticReason: "The profile label is not a usable service name.",
    };
  }

  const marketingKind = classifyCommercialLanguage(cleaned);
  if (marketingKind) {
    return {
      normalizedLabel: titleCase(cleaned),
      semanticState: "rejected",
      semanticReason: `The profile label looks like a ${marketingKind}, not work a customer buys.`,
    };
  }

  const significant = significantTokens(cleaned);
  if (significant.length === 0 || BROAD_LABELS.has(cleaned.toLowerCase())) {
    return {
      normalizedLabel: titleCase(cleaned),
      semanticState: "ambiguous",
      semanticReason: "The profile label is too broad to treat as a distinct service without confirmation.",
    };
  }

  return {
    normalizedLabel: titleCase(cleaned),
    semanticState: "accepted",
    semanticReason: "The profile supplied a specific service-shaped label.",
  };
}

/**
 * Validate and normalize one owner-authorized official-profile export.
 *
 * This function never turns a label into an opportunity. It only preserves the
 * source, normalizes equivalent labels, and records deterministic semantic
 * states. `accepted` still has to pass website coverage, deterministic absence
 * verification, the evidence threshold, and the existing evaluator gate.
 */
export function importOfficialBusinessProfile(
  scope: ImportScope,
  input: OfficialBusinessProfileExport,
  now: Date,
): OfficialBusinessProfileImportResult {
  if (input.provider !== EXTERNAL_PROFILE_PROVIDER) {
    return { ok: false, error: "Orbit only accepts the supported official business-profile export." };
  }
  if (input.authorization !== EXTERNAL_PROFILE_AUTHORIZATION) {
    return { ok: false, error: "This source must be explicitly owner-authorized." };
  }
  if (input.sourceField !== EXTERNAL_PROFILE_SOURCE_FIELD) {
    return { ok: false, error: "The supported export must contain official service data." };
  }
  if (!officialProfileUrl(input.sourceUrl)) {
    return { ok: false, error: "Use the HTTPS URL of the official business profile, not a directory or review page." };
  }

  const sourceRecordId = input.sourceRecordId.trim();
  if (!sourceRecordId) return { ok: false, error: "The official profile needs a stable location ID." };
  if (!Array.isArray(input.services) || input.services.length === 0 || input.services.length > 100) {
    return { ok: false, error: "The official export must contain between 1 and 100 service labels." };
  }

  const observedAt = parseTime(input.observedAt);
  const retrievedAt = parseTime(input.retrievedAt);
  if (observedAt === null || retrievedAt === null) {
    return { ok: false, error: "The observed and retrieved times must be valid dates." };
  }
  if (observedAt > retrievedAt) {
    return { ok: false, error: "The observed time cannot be later than the retrieved time." };
  }
  if (retrievedAt > now.getTime() + 5 * 60 * 1000) {
    return { ok: false, error: "The retrieved time cannot be in the future." };
  }

  const canonical = JSON.stringify({
    provider: input.provider,
    sourceRecordId,
    sourceUrl: input.sourceUrl,
    sourceField: input.sourceField,
    observedAt: input.observedAt,
    retrievedAt: input.retrievedAt,
    sourceVersion: input.sourceVersion ?? null,
    services: input.services.map((label) => cleanLabel(label)),
  });
  const sourceHash = `fnv1a:${fnv1a(canonical)}`;
  const claims: ExternalBusinessClaim[] = [];
  const seen = new Set<string>();
  const rejectedLabels: string[] = [];

  for (const raw of input.services) {
    if (typeof raw !== "string") continue;
    const decision = decideLabel(raw);
    if (!decision) {
      if (cleanLabel(raw)) rejectedLabels.push(cleanLabel(raw));
      continue;
    }
    const key = labelKey(decision.normalizedLabel);
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push(
      ExternalBusinessClaimSchema.parse({
        id: externalClaimId(scope, sourceRecordId, sourceHash, key),
        workspaceId: scope.workspaceId,
        clientId: scope.clientId,
        provider: EXTERNAL_PROFILE_PROVIDER,
        sourceRecordId,
        sourceUrl: input.sourceUrl,
        authorization: EXTERNAL_PROFILE_AUTHORIZATION,
        rawServiceLabel: cleanLabel(raw),
        sourceField: EXTERNAL_PROFILE_SOURCE_FIELD,
        observedAt: input.observedAt,
        retrievedAt: input.retrievedAt,
        sourceHash,
        sourceVersion: input.sourceVersion?.trim() || undefined,
        normalizedLabel: decision.normalizedLabel,
        semanticState: decision.semanticState,
        semanticReason: decision.semanticReason,
      }),
    );
  }

  if (claims.length === 0) {
    return { ok: false, error: "The export contained no usable service labels." };
  }
  return { ok: true, claims, rejectedLabels };
}

/**
 * Select the newest snapshot for each source record and mark unsafe states.
 * Older snapshots cannot keep a service alive after a newer export removes it.
 */
export function resolveCurrentExternalClaims(
  claims: ExternalBusinessClaim[],
  now: Date,
): ExternalBusinessClaim[] {
  const bySource = new Map<string, ExternalBusinessClaim[]>();
  for (const claim of claims) {
    const key = `${claim.provider}:${claim.sourceRecordId}`;
    const list = bySource.get(key) ?? [];
    list.push(claim);
    bySource.set(key, list);
  }

  const current: ExternalBusinessClaim[] = [];
  for (const sourceClaims of bySource.values()) {
    const newestRetrieved = Math.max(...sourceClaims.map((claim) => parseTime(claim.retrievedAt) ?? -1));
    const newest = sourceClaims.filter((claim) => parseTime(claim.retrievedAt) === newestRetrieved);
    const hashes = new Set(newest.map((claim) => claim.sourceHash));
    for (const claim of newest) {
      let semanticState = claim.semanticState;
      let semanticReason = claim.semanticReason;
      if (hashes.size > 1) {
        semanticState = "conflicting";
        semanticReason = "Two different exports were observed at the same retrieval time; the claim is not used.";
      } else if (
        newestRetrieved < 0 ||
        now.getTime() - newestRetrieved > EXTERNAL_CLAIM_MAX_AGE_MS
      ) {
        semanticState = "stale";
        semanticReason = "The official profile export is older than the freshness window.";
      }
      current.push({ ...claim, semanticState, semanticReason });
    }
  }

  // Equivalent labels from multiple current records are one claim in the
  // comparison. Prefer the newest accepted claim, but never turn an ambiguous
  // or rejected source into an accepted one.
  const byLabel = new Map<string, ExternalBusinessClaim>();
  for (const claim of current) {
    const key = labelKey(claim.normalizedLabel);
    const existing = byLabel.get(key);
    if (!existing || claim.retrievedAt > existing.retrievedAt) byLabel.set(key, claim);
  }
  return [...byLabel.values()];
}

function externalClaimId(
  scope: ImportScope,
  sourceRecordId: string,
  sourceHash: string,
  labelKeyValue: string,
): string {
  return `external-${fnv1a(
    `${scope.workspaceId}:${scope.clientId}:${EXTERNAL_PROFILE_PROVIDER}:${sourceRecordId}:${sourceHash}:${labelKeyValue}`,
  )}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
