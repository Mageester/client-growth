import { z } from "zod";
import { VisualAccountingSchema } from "@/core/analysisAccounting";

const CREDENTIAL_QUERY_KEY = /^(?:access[-_]?token|api[-_]?key|auth|authorization|bearer|credential|csrf[-_]?token|id[-_]?token|password|passwd|pass|refresh[-_]?token|secret|session[-_]?token|sig|signature|token|xsrf[-_]?token)$/i;
const CREDENTIAL_QUERY_TOKEN = /^(?:auth|authorization|bearer|credential|key|pass|password|passwd|secret|sig|signature|token)$/i;
const CREDENTIAL_INLINE_LABEL = /(?:^|[?#&\s_.:/-])(?:authorization|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|pass|api[-_]?key|auth|credential|bearer|basic|key|signature|sig)(?:=|:|\/|%[0-9a-f]{0,2}\/|\s)/i;
const MAX_IDENTIFIER_DECODE_PASSES = 6;

export function boundedDecode(value: string): string {
  let decoded = value;
  for (let index = 0; index < MAX_IDENTIFIER_DECODE_PASSES; index += 1) {
    const next = decoded.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

export function decodeBudgetExhausted(value: string): boolean {
  return /%[0-9a-f]{2}/i.test(boundedDecode(value));
}

export function queryKeyTokens(value: string): string[] {
  return value.trim().replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[-_\s]+/).filter(Boolean);
}

export function isCredentialQueryKey(value: string): boolean {
  const trimmed = value.trim();
  return CREDENTIAL_QUERY_KEY.test(trimmed) || queryKeyTokens(trimmed).some((token) => CREDENTIAL_QUERY_TOKEN.test(token));
}

export function isCredentialBearingIdentifier(value: string): boolean {
  const trimmed = value.trim();
  if (CREDENTIAL_INLINE_LABEL.test(trimmed) || CREDENTIAL_INLINE_LABEL.test(boundedDecode(trimmed)) || decodeBudgetExhausted(trimmed)) return true;
  try {
    const parsed = new URL(trimmed);
    return Boolean(parsed.username || parsed.password) ||
      [...parsed.searchParams.keys()].some(isCredentialQueryKey) ||
      [...parsed.searchParams.values()].some((queryValue) => CREDENTIAL_INLINE_LABEL.test(boundedDecode(queryValue)));
  } catch {
    return CREDENTIAL_INLINE_LABEL.test(trimmed) || CREDENTIAL_INLINE_LABEL.test(boundedDecode(trimmed));
  }
}

export function opaqueVisualEvidenceIdSchema(maxLength: number) {
  return z.string().trim().min(1).max(maxLength).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Visual evidence identifiers must be opaque and URL-free.").refine(
    (value) => !isCredentialBearingIdentifier(value),
    "Visual evidence identifiers must not contain credentials or credential-bearing query keys.",
  );
}

export const OpaqueVisualEvidenceIdSchema = opaqueVisualEvidenceIdSchema(100);
export const OpaqueRenderedEvidenceIdSchema = opaqueVisualEvidenceIdSchema(200);

export const VisualPageUrlSchema = z.string().trim().url().max(2_000).superRefine((value, context) => {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Visual page URLs must be credential-free HTTP(S) URLs." });
    }
    if ([...url.searchParams.keys()].some(isCredentialQueryKey)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Visual page URLs must not contain credential-bearing query keys." });
    }
    if (isCredentialBearingIdentifier(value)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Visual page URLs must not contain inline or encoded credentials." });
    }
  } catch {
    // z.url() reports malformed URLs.
  }
});

export const VisualScreenshotSchema = z.object({
  id: opaqueVisualEvidenceIdSchema(100),
  pageUrl: VisualPageUrlSchema,
  viewport: z.enum(["desktop", "mobile"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  capturedAt: z.string().min(1),
  label: z.string().min(1).max(160),
});

export const RenderedScreenshotIdSchema = z.string().regex(/^shot_[0-9a-f]{64}$/).max(100);
export const RenderedPageUrlSchema = VisualPageUrlSchema;
export const RenderedGeometrySchema = z.object({
  left: z.number().finite(),
  top: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
  horizontallyClipped: z.boolean(),
  verticallyClipped: z.boolean(),
}).strict();

export const RenderedElementObservationSchema = z.object({
  runId: z.string().trim().min(1).max(200),
  screenshotId: RenderedScreenshotIdSchema,
  pageUrl: RenderedPageUrlSchema,
  viewport: z.enum(["desktop", "mobile"]),
  viewportWidth: z.number().int().positive().max(10_000),
  viewportHeight: z.number().int().positive().max(10_000),
  elementKey: z.string().trim().min(1).max(120),
  kind: z.enum(["anchor", "button", "form-control", "label", "landmark"]),
  geometry: RenderedGeometrySchema,
  label: z.string().trim().max(500).default(""),
  accessibleName: z.string().trim().max(500).default(""),
  labelState: z.enum(["present", "missing", "empty", "not-applicable"]),
  source: z.enum(["parsed", "rendered"]),
}).strict().superRefine((value, context) => {
  const right = value.geometry.left + value.geometry.width;
  const bottom = value.geometry.top + value.geometry.height;
  const horizontallyOutside = value.geometry.left < 0 || right > value.viewportWidth;
  const verticallyOutside = value.geometry.top < 0 || bottom > value.viewportHeight;
  if (horizontallyOutside && !value.geometry.horizontallyClipped) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["geometry"], message: "Horizontal geometry outside the viewport must be marked clipped." });
  }
  if (verticallyOutside && !value.geometry.verticallyClipped) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["geometry"], message: "Vertical geometry outside the viewport must be marked clipped." });
  }
  if (value.labelState === "present" && !value.label && !value.accessibleName) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["labelState"], message: "A present label state requires a literal label or accessible name." });
  }
  if ((value.labelState === "missing" || value.labelState === "empty") && value.accessibleName) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["labelState"], message: "A missing or empty label state cannot carry an accessible name." });
  }
});

export const RenderedPageObservationSchema = z.object({
  runId: z.string().trim().min(1).max(200),
  screenshotId: RenderedScreenshotIdSchema,
  pageUrl: RenderedPageUrlSchema,
  viewport: z.enum(["desktop", "mobile"]),
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
  capturedAt: z.string().trim().min(1).max(200),
  source: z.enum(["parsed", "rendered"]),
  elements: z.array(RenderedElementObservationSchema).max(250),
}).strict().superRefine((value, context) => {
  value.elements.forEach((element, index) => {
    const matches = element.runId === value.runId && element.screenshotId === value.screenshotId && element.pageUrl === value.pageUrl && element.viewport === value.viewport && element.viewportWidth === value.width && element.viewportHeight === value.height;
    if (!matches) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["elements", index], message: "Rendered element identity and viewport must match its screenshot page." });
    }
  });
});

export const VisibleRegionSchema = z.object({
  left: z.number().finite().nonnegative().max(10_000),
  top: z.number().finite().nonnegative().max(10_000),
  width: z.number().finite().positive().max(10_000),
  height: z.number().finite().positive().max(10_000),
}).strict();

const VisualEvidenceReferenceObjectSchema = z.object({
  screenshotId: OpaqueVisualEvidenceIdSchema,
  pageUrl: RenderedPageUrlSchema,
  viewport: z.enum(["desktop", "mobile"]),
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
  visibleRegion: VisibleRegionSchema,
  renderedObservationId: OpaqueRenderedEvidenceIdSchema.optional(),
  counterEvidenceIds: z.array(OpaqueVisualEvidenceIdSchema).max(8).optional(),
}).strict().superRefine((value, context) => {
  try {
    const url = new URL(value.pageUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["pageUrl"], message: "Visual evidence must reference an HTTP(S) page." });
    }
    if (url.username || url.password || url.hash || [...url.searchParams.keys()].some(isCredentialQueryKey) || isCredentialBearingIdentifier(value.pageUrl)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["pageUrl"], message: "Visual evidence page URLs must be canonical and credential-free." });
    }
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["pageUrl"], message: "Visual evidence page URL is malformed." });
  }
});

export const VisualEvidenceReferenceSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  const normalized = { ...input };
  if (normalized.visibleRegion === undefined && normalized.region !== undefined) normalized.visibleRegion = normalized.region;
  if (normalized.width === undefined && normalized.viewportWidth !== undefined) normalized.width = normalized.viewportWidth;
  if (normalized.height === undefined && normalized.viewportHeight !== undefined) normalized.height = normalized.viewportHeight;
  delete normalized.region;
  delete normalized.viewportWidth;
  delete normalized.viewportHeight;
  return normalized;
}, VisualEvidenceReferenceObjectSchema);

export const VisualFindingSchema = z.object({
  region: z.enum(["header", "hero", "service-list", "form", "proof", "footer", "page"]).optional(),
  problem: z.enum(["overlap", "clipped", "unreadable", "conflicting-actions", "contradictory-offer", "obscured-action", "small-target", "target-size"]).optional(),
  category: z.enum(["mobile-usability", "enquiry-friction", "offer-clarity", "decision-support", "trust-placement"]),
  pageUrl: VisualPageUrlSchema,
  screenshotIds: z.array(OpaqueVisualEvidenceIdSchema).min(1).max(4),
  visualEvidence: z.array(VisualEvidenceReferenceSchema).min(1).max(4).optional(),
  evidence: z.array(VisualEvidenceReferenceSchema).min(1).max(4).optional(),
  counterEvidenceIds: z.array(OpaqueVisualEvidenceIdSchema).max(8).optional(),
  title: z.string().min(12).max(120),
  observation: z.string().min(30).max(900),
  impact: z.string().min(25).max(700),
  recommendation: z.string().min(25).max(700),
  counterEvidence: z.string().max(700).optional(),
  serviceId: z.string().min(1).optional(),
  scope: z.array(z.string().min(15).max(350)).min(2).max(5),
  acceptanceCriteria: z.array(z.string().min(15).max(350)).min(1).max(4),
  effort: z.enum(["small", "medium", "large"]),
  priority: z.enum(["high", "medium"]),
});

export const VisualReviewSchema = z.object({
  status: z.enum(["complete", "partial", "unavailable"]),
  model: z.string().default(""),
  providerCalls: z.number().int().min(0).max(2).optional(),
  rejectedSuggestions: z.array(z.object({ title: z.string().max(120), reason: z.string().max(700) })).max(3).optional(),
  summary: z.string().max(900),
  strengths: z.array(z.string().max(400)).max(4).default([]),
  limitations: z.array(z.string().max(700)).max(12).default([]),
  screenshots: z.array(VisualScreenshotSchema).max(4).default([]),
  findings: z.array(VisualFindingSchema).max(3).default([]),
  accounting: VisualAccountingSchema.optional(),
});

export type VisualScreenshot = z.infer<typeof VisualScreenshotSchema>;
export type RenderedPageObservation = z.infer<typeof RenderedPageObservationSchema>;
export type RenderedElementObservation = z.infer<typeof RenderedElementObservationSchema>;
export type VisualEvidenceReference = z.infer<typeof VisualEvidenceReferenceSchema>;
export type VisualFinding = z.infer<typeof VisualFindingSchema>;
export type VisualReview = z.infer<typeof VisualReviewSchema>;
