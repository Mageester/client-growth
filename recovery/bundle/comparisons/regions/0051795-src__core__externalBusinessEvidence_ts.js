// src/core/externalBusinessEvidence.ts
var EXTERNAL_PROFILE_PROVIDER = "google-business-profile-export";
var GOOGLE_BUSINESS_PROFILE_API_PROVIDER = "google-business-profile-api";
var EXTERNAL_PROFILE_AUTHORIZATION = "owner-authorized-export";
var GOOGLE_BUSINESS_PROFILE_API_AUTHORIZATION = "owner-authorized-api-response";
var EXTERNAL_PROFILE_SOURCE_FIELD = "services";
var GOOGLE_BUSINESS_PROFILE_API_SOURCE_FIELD = "serviceItems";
var EXTERNAL_CLAIM_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1e3;
var GOOGLE_BUSINESS_PROFILE_SERVICE_LIST_PATH = /^accounts\/[^/]+\/locations\/[^/]+\/serviceList$/;
var ExternalSemanticStateSchema = external_exports.enum([
  "accepted",
  "ambiguous",
  "rejected",
  "stale",
  "conflicting"
]);
var ExternalBusinessClaimSchema = external_exports.object({
  id: external_exports.string().min(1),
  workspaceId: external_exports.string().min(1),
  clientId: external_exports.string().min(1),
  provider: external_exports.enum([EXTERNAL_PROFILE_PROVIDER, GOOGLE_BUSINESS_PROFILE_API_PROVIDER]),
  sourceRecordId: external_exports.string().min(1),
  sourceUrl: external_exports.string().url(),
  authorization: external_exports.enum([
    EXTERNAL_PROFILE_AUTHORIZATION,
    GOOGLE_BUSINESS_PROFILE_API_AUTHORIZATION
  ]),
  rawServiceLabel: external_exports.string().min(1),
  sourceField: external_exports.enum([EXTERNAL_PROFILE_SOURCE_FIELD, GOOGLE_BUSINESS_PROFILE_API_SOURCE_FIELD]),
  observedAt: external_exports.string().min(1),
  retrievedAt: external_exports.string().min(1),
  sourceHash: external_exports.string().min(1),
  sourceVersion: external_exports.string().min(1).optional(),
  normalizedLabel: external_exports.string().min(1),
  semanticState: ExternalSemanticStateSchema,
  semanticReason: external_exports.string().min(1)
});
var GoogleStructuredServiceItemSchema = external_exports.object({
  serviceTypeId: external_exports.string().min(1),
  description: external_exports.string().optional()
});
var GoogleFreeFormServiceItemSchema = external_exports.object({
  categoryId: external_exports.string().min(1),
  label: external_exports.object({
    displayName: external_exports.string().min(1),
    description: external_exports.string().optional(),
    languageCode: external_exports.string().optional()
  })
});
var GoogleServiceItemSchema = external_exports.object({
  isOffered: external_exports.boolean().optional(),
  structuredServiceItem: GoogleStructuredServiceItemSchema.optional(),
  freeFormServiceItem: GoogleFreeFormServiceItemSchema.optional()
}).superRefine((item, ctx) => {
  if (Boolean(item.structuredServiceItem) === Boolean(item.freeFormServiceItem)) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "A service item must contain exactly one official service representation."
    });
  }
});
var GoogleBusinessProfileServiceListSchema = external_exports.object({
  name: external_exports.string().regex(GOOGLE_BUSINESS_PROFILE_SERVICE_LIST_PATH),
  serviceItems: external_exports.array(GoogleServiceItemSchema).min(1).max(100)
});
var OfficialBusinessProfileExportSchema = external_exports.object({
  provider: external_exports.literal(EXTERNAL_PROFILE_PROVIDER),
  sourceRecordId: external_exports.string().min(1),
  sourceUrl: external_exports.string().url(),
  authorization: external_exports.literal(EXTERNAL_PROFILE_AUTHORIZATION),
  sourceField: external_exports.literal(EXTERNAL_PROFILE_SOURCE_FIELD),
  observedAt: external_exports.string().min(1),
  retrievedAt: external_exports.string().min(1),
  sourceVersion: external_exports.string().min(1).optional(),
  services: external_exports.array(external_exports.string()).min(1).max(100)
});
function parseTime(value) {
  const time2 = Date.parse(value);
  return Number.isFinite(time2) ? time2 : null;
}
__name(parseTime, "parseTime");
function labelKey(label) {
  return significantTokens(label).slice().sort().join(" ") || label.toLowerCase();
}
__name(labelKey, "labelKey");
function resolveCurrentExternalClaims(claims, now2) {
  const bySource = /* @__PURE__ */ new Map();
  for (const claim2 of claims) {
    const key = `${claim2.provider}:${claim2.sourceRecordId}`;
    const list = bySource.get(key) ?? [];
    list.push(claim2);
    bySource.set(key, list);
  }
  const current = [];
  for (const sourceClaims of bySource.values()) {
    const newestRetrieved = Math.max(...sourceClaims.map((claim2) => parseTime(claim2.retrievedAt) ?? -1));
    const newest = sourceClaims.filter((claim2) => parseTime(claim2.retrievedAt) === newestRetrieved);
    const hashes = new Set(newest.map((claim2) => claim2.sourceHash));
    for (const claim2 of newest) {
      let semanticState = claim2.semanticState;
      let semanticReason = claim2.semanticReason;
      if (hashes.size > 1) {
        semanticState = "conflicting";
        semanticReason = "Two different exports were observed at the same retrieval time; the claim is not used.";
      } else if (newestRetrieved < 0 || now2.getTime() - newestRetrieved > EXTERNAL_CLAIM_MAX_AGE_MS) {
        semanticState = "stale";
        semanticReason = "The official profile export is older than the freshness window.";
      }
      current.push({ ...claim2, semanticState, semanticReason });
    }
  }
  const byLabel = /* @__PURE__ */ new Map();
  for (const claim2 of current) {
    const key = labelKey(claim2.normalizedLabel);
    const existing = byLabel.get(key);
    if (!existing || claim2.retrievedAt > existing.retrievedAt) byLabel.set(key, claim2);
  }
  return [...byLabel.values()];
}
__name(resolveCurrentExternalClaims, "resolveCurrentExternalClaims");
