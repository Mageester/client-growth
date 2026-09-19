// src/core/visualSchema.ts
var CREDENTIAL_QUERY_KEY = /^(?:access[-_]?token|api[-_]?key|auth|authorization|bearer|credential|csrf[-_]?token|id[-_]?token|password|passwd|pass|refresh[-_]?token|secret|session[-_]?token|sig|signature|token|xsrf[-_]?token)$/i;
var CREDENTIAL_QUERY_TOKEN = /^(?:auth|authorization|bearer|credential|key|pass|password|passwd|secret|sig|signature|token)$/i;
var CREDENTIAL_INLINE_LABEL = /(?:^|[?#&\s_.:/-])(?:authorization|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|pass|api[-_]?key|auth|credential|bearer|basic|key|signature|sig)(?:=|:|\/|%[0-9a-f]{0,2}\/|\s)/i;
var MAX_IDENTIFIER_DECODE_PASSES = 6;
function boundedDecode(value) {
  let decoded = value;
  for (let index = 0; index < MAX_IDENTIFIER_DECODE_PASSES; index += 1) {
    const next = decoded.replace(
      /%([0-9a-f]{2})/gi,
      (_match, hex2) => String.fromCharCode(Number.parseInt(hex2, 16))
    );
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}
__name(boundedDecode, "boundedDecode");
function decodeBudgetExhausted(value) {
  return /%[0-9a-f]{2}/i.test(boundedDecode(value));
}
__name(decodeBudgetExhausted, "decodeBudgetExhausted");
function queryKeyTokens(value) {
  return value.trim().replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[-_\s]+/).filter(Boolean);
}
__name(queryKeyTokens, "queryKeyTokens");
function isCredentialQueryKey(value) {
  const trimmed = value.trim();
  return CREDENTIAL_QUERY_KEY.test(trimmed) || queryKeyTokens(trimmed).some((token3) => CREDENTIAL_QUERY_TOKEN.test(token3));
}
__name(isCredentialQueryKey, "isCredentialQueryKey");
function isCredentialBearingIdentifier(value) {
  const trimmed = value.trim();
  if (CREDENTIAL_INLINE_LABEL.test(trimmed) || CREDENTIAL_INLINE_LABEL.test(boundedDecode(trimmed)) || decodeBudgetExhausted(trimmed)) return true;
  try {
    const parsed = new URL(trimmed);
    return Boolean(parsed.username || parsed.password) || [...parsed.searchParams.keys()].some(isCredentialQueryKey) || [...parsed.searchParams.values()].some(
      (queryValue) => CREDENTIAL_INLINE_LABEL.test(boundedDecode(queryValue))
    );
  } catch {
    return CREDENTIAL_INLINE_LABEL.test(trimmed) || CREDENTIAL_INLINE_LABEL.test(boundedDecode(trimmed));
  }
}
__name(isCredentialBearingIdentifier, "isCredentialBearingIdentifier");
function opaqueVisualEvidenceIdSchema(maxLength) {
  return external_exports.string().trim().min(1).max(maxLength).regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    "Visual evidence identifiers must be opaque and URL-free."
  ).refine(
    (value) => !isCredentialBearingIdentifier(value),
    "Visual evidence identifiers must not contain credentials or credential-bearing query keys."
  );
}
__name(opaqueVisualEvidenceIdSchema, "opaqueVisualEvidenceIdSchema");
var OpaqueVisualEvidenceIdSchema = opaqueVisualEvidenceIdSchema(100);
var OpaqueRenderedEvidenceIdSchema = opaqueVisualEvidenceIdSchema(200);
var VisualPageUrlSchema = external_exports.string().trim().url().max(2e3).superRefine((value, context) => {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Visual page URLs must be credential-free HTTP(S) URLs."
      });
    }
    if ([...url.searchParams.keys()].some(isCredentialQueryKey)) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Visual page URLs must not contain credential-bearing query keys."
      });
    }
    if (isCredentialBearingIdentifier(value)) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Visual page URLs must not contain inline or encoded credentials."
      });
    }
  } catch {
  }
});
var VisualScreenshotSchema = external_exports.object({
  id: opaqueVisualEvidenceIdSchema(100),
  pageUrl: VisualPageUrlSchema,
  viewport: external_exports.enum(["desktop", "mobile"]),
  width: external_exports.number().int().positive(),
  height: external_exports.number().int().positive(),
  capturedAt: external_exports.string().min(1),
  label: external_exports.string().min(1).max(160)
});
var RenderedScreenshotIdSchema = external_exports.string().regex(/^shot_[0-9a-f]{64}$/).max(100);
var RenderedPageUrlSchema = VisualPageUrlSchema;
var RenderedGeometrySchema = external_exports.object({
  left: external_exports.number().finite(),
  top: external_exports.number().finite(),
  width: external_exports.number().finite().nonnegative(),
  height: external_exports.number().finite().nonnegative(),
  horizontallyClipped: external_exports.boolean(),
  verticallyClipped: external_exports.boolean()
}).strict();
var RenderedElementObservationSchema = external_exports.object({
  runId: external_exports.string().trim().min(1).max(200),
  screenshotId: RenderedScreenshotIdSchema,
  pageUrl: RenderedPageUrlSchema,
  viewport: external_exports.enum(["desktop", "mobile"]),
  viewportWidth: external_exports.number().int().positive().max(1e4),
  viewportHeight: external_exports.number().int().positive().max(1e4),
  elementKey: external_exports.string().trim().min(1).max(120),
  kind: external_exports.enum(["anchor", "button", "form-control", "label", "landmark"]),
  geometry: RenderedGeometrySchema,
  label: external_exports.string().trim().max(500).default(""),
  accessibleName: external_exports.string().trim().max(500).default(""),
  labelState: external_exports.enum(["present", "missing", "empty", "not-applicable"]),
  source: external_exports.enum(["parsed", "rendered"])
}).strict().superRefine((value, context) => {
  const right = value.geometry.left + value.geometry.width;
  const bottom = value.geometry.top + value.geometry.height;
  const horizontallyOutside = value.geometry.left < 0 || right > value.viewportWidth;
  const verticallyOutside = value.geometry.top < 0 || bottom > value.viewportHeight;
  if (horizontallyOutside && !value.geometry.horizontallyClipped) {
    context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["geometry"], message: "Horizontal geometry outside the viewport must be marked clipped." });
  }
  if (verticallyOutside && !value.geometry.verticallyClipped) {
    context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["geometry"], message: "Vertical geometry outside the viewport must be marked clipped." });
  }
  if (value.labelState === "present" && !value.label && !value.accessibleName) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["labelState"],
      message: "A present label state requires a literal label or accessible name."
    });
  }
  if ((value.labelState === "missing" || value.labelState === "empty") && value.accessibleName) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["labelState"],
      message: "A missing or empty label state cannot carry an accessible name."
    });
  }
});
var RenderedPageObservationSchema = external_exports.object({
  runId: external_exports.string().trim().min(1).max(200),
  screenshotId: RenderedScreenshotIdSchema,
  pageUrl: RenderedPageUrlSchema,
  viewport: external_exports.enum(["desktop", "mobile"]),
  width: external_exports.number().int().positive().max(1e4),
  height: external_exports.number().int().positive().max(1e4),
  capturedAt: external_exports.string().trim().min(1).max(200),
  source: external_exports.enum(["parsed", "rendered"]),
  elements: external_exports.array(RenderedElementObservationSchema).max(250)
}).strict().superRefine((value, context) => {
  value.elements.forEach((element, index) => {
    const matches = element.runId === value.runId && element.screenshotId === value.screenshotId && element.pageUrl === value.pageUrl && element.viewport === value.viewport && element.viewportWidth === value.width && element.viewportHeight === value.height;
    if (!matches) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["elements", index],
        message: "Rendered element identity and viewport must match its screenshot page."
      });
    }
  });
});
var VisibleRegionSchema = external_exports.object({
  left: external_exports.number().finite().nonnegative().max(1e4),
  top: external_exports.number().finite().nonnegative().max(1e4),
  width: external_exports.number().finite().positive().max(1e4),
  height: external_exports.number().finite().positive().max(1e4)
}).strict();
var VisualEvidenceReferenceObjectSchema = external_exports.object({
  screenshotId: OpaqueVisualEvidenceIdSchema,
  pageUrl: RenderedPageUrlSchema,
  viewport: external_exports.enum(["desktop", "mobile"]),
  width: external_exports.number().int().positive().max(1e4),
  height: external_exports.number().int().positive().max(1e4),
  visibleRegion: VisibleRegionSchema,
  renderedObservationId: OpaqueRenderedEvidenceIdSchema.optional(),
  counterEvidenceIds: external_exports.array(OpaqueVisualEvidenceIdSchema).max(8).optional()
}).strict().superRefine((value, context) => {
  try {
    const url = new URL(value.pageUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["pageUrl"],
        message: "Visual evidence must reference an HTTP(S) page."
      });
    }
    if (url.username || url.password || url.hash || [...url.searchParams.keys()].some(isCredentialQueryKey) || isCredentialBearingIdentifier(value.pageUrl)) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["pageUrl"],
        message: "Visual evidence page URLs must be canonical and credential-free."
      });
    }
  } catch {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["pageUrl"],
      message: "Visual evidence page URL is malformed."
    });
  }
});
var VisualEvidenceReferenceSchema = external_exports.preprocess((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const input = value;
  const normalized3 = { ...input };
  if (normalized3.visibleRegion === void 0 && normalized3.region !== void 0) {
    normalized3.visibleRegion = normalized3.region;
  }
  if (normalized3.width === void 0 && normalized3.viewportWidth !== void 0) {
    normalized3.width = normalized3.viewportWidth;
  }
  if (normalized3.height === void 0 && normalized3.viewportHeight !== void 0) {
    normalized3.height = normalized3.viewportHeight;
  }
  delete normalized3.region;
  delete normalized3.viewportWidth;
  delete normalized3.viewportHeight;
  return normalized3;
}, VisualEvidenceReferenceObjectSchema);
var VisualFindingSchema = external_exports.object({
  // Durable identity describes the affected region and defect, not the model's
  // changeable commercial category. Optional for previously saved reviews.
  region: external_exports.enum(["header", "hero", "service-list", "form", "proof", "footer", "page"]).optional(),
  problem: external_exports.enum([
    "overlap",
    "clipped",
    "unreadable",
    "conflicting-actions",
    "contradictory-offer",
    "obscured-action",
    "small-target",
    "target-size"
  ]).optional(),
  category: external_exports.enum([
    "mobile-usability",
    "enquiry-friction",
    "offer-clarity",
    "decision-support",
    "trust-placement"
  ]),
  pageUrl: VisualPageUrlSchema,
  screenshotIds: external_exports.array(OpaqueVisualEvidenceIdSchema).min(1).max(4),
  /** New model replies use visualEvidence; old persisted findings may omit it. */
  visualEvidence: external_exports.array(VisualEvidenceReferenceSchema).min(1).max(4).optional(),
  /** `evidence` is accepted as a compatibility spelling for external callers. */
  evidence: external_exports.array(VisualEvidenceReferenceSchema).min(1).max(4).optional(),
  counterEvidenceIds: external_exports.array(OpaqueVisualEvidenceIdSchema).max(8).optional(),
  title: external_exports.string().min(12).max(120),
  observation: external_exports.string().min(30).max(900),
  impact: external_exports.string().min(25).max(700),
  recommendation: external_exports.string().min(25).max(700),
  counterEvidence: external_exports.string().max(700).optional(),
  /** Optional in shadow mode; legacy publication still requires an active map. */
  serviceId: external_exports.string().min(1).optional(),
  scope: external_exports.array(external_exports.string().min(15).max(350)).min(2).max(5),
  acceptanceCriteria: external_exports.array(external_exports.string().min(15).max(350)).min(1).max(4),
  effort: external_exports.enum(["small", "medium", "large"]),
  priority: external_exports.enum(["high", "medium"])
});
var VisualReviewSchema = external_exports.object({
  status: external_exports.enum(["complete", "partial", "unavailable"]),
  model: external_exports.string().default(""),
  providerCalls: external_exports.number().int().min(0).max(2).optional(),
  rejectedSuggestions: external_exports.array(
    external_exports.object({ title: external_exports.string().max(120), reason: external_exports.string().max(700) })
  ).max(3).optional(),
  summary: external_exports.string().max(900),
  strengths: external_exports.array(external_exports.string().max(400)).max(4).default([]),
  limitations: external_exports.array(external_exports.string().max(700)).max(12).default([]),
  screenshots: external_exports.array(VisualScreenshotSchema).max(4).default([]),
  findings: external_exports.array(VisualFindingSchema).max(3).default([]),
  accounting: VisualAccountingSchema.optional()
});
