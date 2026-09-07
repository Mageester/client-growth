import { z } from "zod";

import { classifyCommercialLanguage } from "@/core/commercialLanguage";
import { significantTokens, titleCase } from "@/core/text";

/**
 * External-source adapters are deliberately narrow. The legacy normalized
 * payload remains available to internal callers, while the user-facing path
 * accepts Google's documented ServiceList API response. Neither path accepts
 * a URL scraped from a directory, a review, a social post, or an advert.
 */
export const EXTERNAL_PROFILE_PROVIDER = "google-business-profile-export" as const;
export const GOOGLE_BUSINESS_PROFILE_API_PROVIDER = "google-business-profile-api" as const;
export const EXTERNAL_PROFILE_AUTHORIZATION = "owner-authorized-export" as const;
export const GOOGLE_BUSINESS_PROFILE_API_AUTHORIZATION = "owner-authorized-api-response" as const;
export const EXTERNAL_PROFILE_SOURCE_FIELD = "services" as const;
export const GOOGLE_BUSINESS_PROFILE_API_SOURCE_FIELD = "serviceItems" as const;
export const EXTERNAL_CLAIM_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const GOOGLE_BUSINESS_PROFILE_SERVICE_LIST_PATH =
  /^accounts\/[^/]+\/locations\/[^/]+\/serviceList$/;
const GOOGLE_BUSINESS_PROFILE_API_HOST = "mybusiness.googleapis.com";

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
  provider: z.enum([EXTERNAL_PROFILE_PROVIDER, GOOGLE_BUSINESS_PROFILE_API_PROVIDER]),
  sourceRecordId: z.string().min(1),
  sourceUrl: z.string().url(),
  authorization: z.enum([
    EXTERNAL_PROFILE_AUTHORIZATION,
    GOOGLE_BUSINESS_PROFILE_API_AUTHORIZATION,
  ]),
  rawServiceLabel: z.string().min(1),
  sourceField: z.enum([EXTERNAL_PROFILE_SOURCE_FIELD, GOOGLE_BUSINESS_PROFILE_API_SOURCE_FIELD]),
  observedAt: z.string().min(1),
  retrievedAt: z.string().min(1),
  sourceHash: z.string().min(1),
  sourceVersion: z.string().min(1).optional(),
  normalizedLabel: z.string().min(1),
  semanticState: ExternalSemanticStateSchema,
  semanticReason: z.string().min(1),
});
export type ExternalBusinessClaim = z.infer<typeof ExternalBusinessClaimSchema>;

const GoogleStructuredServiceItemSchema = z.object({
  serviceTypeId: z.string().min(1),
  description: z.string().optional(),
});

const GoogleFreeFormServiceItemSchema = z.object({
  categoryId: z.string().min(1),
  label: z.object({
    displayName: z.string().min(1),
    description: z.string().optional(),
    languageCode: z.string().optional(),
  }),
});

const GoogleServiceItemSchema = z
  .object({
    isOffered: z.boolean().optional(),
    structuredServiceItem: GoogleStructuredServiceItemSchema.optional(),
    freeFormServiceItem: GoogleFreeFormServiceItemSchema.optional(),
  })
  .superRefine((item, ctx) => {
    if (Boolean(item.structuredServiceItem) === Boolean(item.freeFormServiceItem)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A service item must contain exactly one official service representation.",
      });
    }
  });

/** Google's documented `ServiceList` API response shape. */
export const GoogleBusinessProfileServiceListSchema = z.object({
  name: z.string().regex(GOOGLE_BUSINESS_PROFILE_SERVICE_LIST_PATH),
  serviceItems: z.array(GoogleServiceItemSchema).min(1).max(100),
});
export type GoogleBusinessProfileServiceList = z.infer<
  typeof GoogleBusinessProfileServiceListSchema
>;

export const OfficialBusinessProfileExportSchema = z.object({
  provider: z.literal(EXTERNAL_PROFILE_PROVIDER),
  sourceRecordId: z.string().min(1),
  sourceUrl: z.string().url(),
  authorization: z.literal(EXTERNAL_PROFILE_AUTHORIZATION),
  sourceField: z.literal(EXTERNAL_PROFILE_SOURCE_FIELD),
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
const BROAD_LABEL_SUFFIX = /(?:\b|^)(?:services?|solutions?|support|products?)$/i;

function parseTime(value: string): number | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function officialProfileUrl(
  provider: ExternalBusinessClaim["provider"],
  sourceRecordId: string,
  value: string,
): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.search || url.hash) return false;
    if (provider === GOOGLE_BUSINESS_PROFILE_API_PROVIDER) {
      return (
        url.hostname === GOOGLE_BUSINESS_PROFILE_API_HOST &&
        url.pathname === `/v4/${sourceRecordId}` &&
        GOOGLE_BUSINESS_PROFILE_SERVICE_LIST_PATH.test(sourceRecordId)
      );
    }
    return (
      (url.hostname === "business.google.com" || url.hostname === "www.business.google.com") &&
      url.pathname === `/locations/${sourceRecordId}`
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
  if (
    significant.length === 0 ||
    BROAD_LABELS.has(cleaned.toLowerCase()) ||
    BROAD_LABEL_SUFFIX.test(cleaned)
  ) {
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

interface NormalizedExternalProfileInput {
  provider: ExternalBusinessClaim["provider"];
  sourceRecordId: string;
  sourceUrl: string;
  authorization: ExternalBusinessClaim["authorization"];
  sourceField: ExternalBusinessClaim["sourceField"];
  observedAt: string;
  retrievedAt: string;
  sourceVersion?: string;
  services: string[];
}

function expectedProvenance(provider: ExternalBusinessClaim["provider"]): {
  authorization: ExternalBusinessClaim["authorization"];
  sourceField: ExternalBusinessClaim["sourceField"];
} {
  return provider === GOOGLE_BUSINESS_PROFILE_API_PROVIDER
    ? {
        authorization: GOOGLE_BUSINESS_PROFILE_API_AUTHORIZATION,
        sourceField: GOOGLE_BUSINESS_PROFILE_API_SOURCE_FIELD,
      }
    : {
        authorization: EXTERNAL_PROFILE_AUTHORIZATION,
        sourceField: EXTERNAL_PROFILE_SOURCE_FIELD,
      };
}

/** Defense-in-depth validation for every persistence boundary. */
export function validateExternalBusinessClaimProvenance(
  claim: ExternalBusinessClaim,
  now = new Date(),
): void {
  const expected = expectedProvenance(claim.provider);
  if (claim.authorization !== expected.authorization || claim.sourceField !== expected.sourceField) {
    throw new Error("External business claim provenance does not match its provider.");
  }
  if (!officialProfileUrl(claim.provider, claim.sourceRecordId, claim.sourceUrl)) {
    throw new Error("External business claim source is not an allowed official profile endpoint.");
  }
  if (claim.provider === GOOGLE_BUSINESS_PROFILE_API_PROVIDER && claim.sourceVersion !== "v4") {
    throw new Error("Google Business Profile API claims must identify the v4 ServiceList response.");
  }
  if (!/^fnv1a:[0-9a-f]{8}$/.test(claim.sourceHash)) {
    throw new Error("External business claim source hash is invalid.");
  }
  const observedAt = parseTime(claim.observedAt);
  const retrievedAt = parseTime(claim.retrievedAt);
  if (observedAt === null || retrievedAt === null || observedAt > retrievedAt) {
    throw new Error("External business claim timestamps are invalid.");
  }
  if (retrievedAt > now.getTime() + 5 * 60 * 1000) {
    throw new Error("External business claim retrieval time cannot be in the future.");
  }
}

function importExternalBusinessProfileClaims(
  scope: ImportScope,
  input: NormalizedExternalProfileInput,
  now: Date,
): OfficialBusinessProfileImportResult {
  const sourceRecordId = input.sourceRecordId.trim();
  if (!sourceRecordId) return { ok: false, error: "The official profile needs a stable location ID." };
  const expected = expectedProvenance(input.provider);
  if (input.authorization !== expected.authorization) {
    return { ok: false, error: "This source must be explicitly owner-authorized." };
  }
  if (input.sourceField !== expected.sourceField) {
    return { ok: false, error: "The supported source must contain official service data." };
  }
  if (!officialProfileUrl(input.provider, sourceRecordId, input.sourceUrl)) {
    return {
      ok: false,
      error: "Use the HTTPS URL of the official business profile API, not a directory or review page.",
    };
  }
  if (!Array.isArray(input.services) || input.services.length === 0 || input.services.length > 100) {
    return { ok: false, error: "The official source must contain between 1 and 100 service labels." };
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
        id: externalClaimId(scope, input.provider, sourceRecordId, sourceHash, key),
        workspaceId: scope.workspaceId,
        clientId: scope.clientId,
        provider: input.provider,
        sourceRecordId,
        sourceUrl: input.sourceUrl,
        authorization: input.authorization,
        rawServiceLabel: cleanLabel(raw),
        sourceField: input.sourceField,
        observedAt: input.observedAt,
        retrievedAt: input.retrievedAt,
        sourceHash,
        sourceVersion: input.sourceVersion?.trim() || undefined,
        normalizedLabel: decision.normalizedLabel,
        semanticState: decision.semanticState,
        semanticReason: decision.semanticReason,
      }),
    );
    validateExternalBusinessClaimProvenance(claims[claims.length - 1]!, now);
  }

  if (claims.length === 0) {
    return { ok: false, error: "The export contained no usable service labels." };
  }
  return { ok: true, claims, rejectedLabels };
}

/**
 * Validate and normalize the legacy internal owner-authorized payload.
 *
 * This remains available to internal callers only. The normal UI uses the
 * documented Google ServiceList adapter below.
 */
export function importOfficialBusinessProfile(
  scope: ImportScope,
  input: OfficialBusinessProfileExport,
  now: Date,
): OfficialBusinessProfileImportResult {
  return importExternalBusinessProfileClaims(scope, input, now);
}

function googleServiceItemLabel(
  item: GoogleBusinessProfileServiceList["serviceItems"][number],
): string | null {
  if (item.structuredServiceItem) {
    return (
      item.structuredServiceItem.description?.trim() ||
      item.structuredServiceItem.serviceTypeId.replace(/[_-]+/g, " ")
    );
  }
  return item.freeFormServiceItem?.label.displayName.trim() || null;
}

/**
 * Parse the documented Google Business Profile `ServiceList` response. The
 * adapter owns all Orbit provenance fields; users only upload the official
 * response and review the resulting labels.
 */
export function importGoogleBusinessProfileServiceList(
  scope: ImportScope,
  input: unknown,
  now: Date,
  options: { ownerAuthorized: boolean },
): OfficialBusinessProfileImportResult {
  if (!options.ownerAuthorized) {
    return { ok: false, error: "This profile response requires owner authorization." };
  }
  const parsed = GoogleBusinessProfileServiceListSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Upload the official Google Business Profile service list response.",
    };
  }

  const sourceRecordId = parsed.data.name;
  const services = parsed.data.serviceItems
    .filter((item) => item.isOffered !== false)
    .map(googleServiceItemLabel)
    .filter((label): label is string => Boolean(label));

  if (services.length === 0) {
    return { ok: false, error: "The official profile did not contain any currently offered services." };
  }

  const observedAt = now.toISOString();
  return importExternalBusinessProfileClaims(
    scope,
    {
      provider: GOOGLE_BUSINESS_PROFILE_API_PROVIDER,
      sourceRecordId,
      sourceUrl: `https://${GOOGLE_BUSINESS_PROFILE_API_HOST}/v4/${sourceRecordId}`,
      authorization: GOOGLE_BUSINESS_PROFILE_API_AUTHORIZATION,
      sourceField: GOOGLE_BUSINESS_PROFILE_API_SOURCE_FIELD,
      observedAt,
      retrievedAt: observedAt,
      sourceVersion: "v4",
      services,
    },
    now,
  );
}

/** Apply only explicit user confirmations to ambiguous profile labels. */
export function confirmExternalBusinessProfileClaims(
  claims: ExternalBusinessClaim[],
  confirmedClaimKeys: ReadonlySet<string>,
): ExternalBusinessClaim[] {
  return claims.map((claim) =>
    claim.semanticState === "ambiguous" &&
    (confirmedClaimKeys.has(claim.id) ||
      confirmedClaimKeys.has(claim.normalizedLabel) ||
      confirmedClaimKeys.has(labelKey(claim.normalizedLabel)))
      ? {
          ...claim,
          semanticState: "accepted",
          semanticReason: "Confirmed by the agency during profile review.",
        }
      : claim,
  );
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
  provider: ExternalBusinessClaim["provider"],
  sourceRecordId: string,
  sourceHash: string,
  labelKeyValue: string,
): string {
  return `external-${fnv1a(
    `${scope.workspaceId}:${scope.clientId}:${provider}:${sourceRecordId}:${sourceHash}:${labelKeyValue}`,
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
