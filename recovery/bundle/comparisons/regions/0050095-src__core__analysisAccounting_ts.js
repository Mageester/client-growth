// src/core/analysisAccounting.ts
var BudgetUsageSchema = external_exports.object({
  limit: external_exports.number().int().nonnegative().max(1e4),
  used: external_exports.number().int().nonnegative().max(1e4),
  remaining: external_exports.number().int().nonnegative().max(1e4),
  attempted: external_exports.number().int().nonnegative().max(1e6),
  capped: external_exports.boolean(),
  capReason: external_exports.string().trim().min(1).max(500).optional()
}).strict().superRefine((value, context) => {
  if (value.used > value.limit) {
    context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["used"], message: "Used budget cannot exceed its limit." });
  }
  if (value.remaining !== value.limit - value.used) {
    context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["remaining"], message: "Remaining budget must equal limit minus used." });
  }
  if (value.attempted < value.used) {
    context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["attempted"], message: "Attempted budget cannot be lower than used." });
  }
  if (!value.capped && value.capReason !== void 0) {
    context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["capReason"], message: "An uncapped budget cannot have a cap reason." });
  }
  if (value.capped && value.capReason === void 0) {
    context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["capReason"], message: "A capped budget requires a bounded reason." });
  }
});
var AccountingCountSchema = external_exports.number().int().nonnegative().max(1e6);
var AccountingTextSchema = external_exports.string().trim().min(1).max(500);
var AccountingTextListSchema = external_exports.array(AccountingTextSchema).max(100);
var AccountingStateSchema = external_exports.enum([
  "assessed",
  "limited",
  "blocked",
  "unavailable",
  "unassessed"
]);
var DetectorCapSchema = external_exports.object({
  limit: AccountingCountSchema,
  observed: AccountingCountSchema,
  reason: AccountingTextSchema
}).strict();
var DetectorAccountingSchema = external_exports.object({
  detectorId: external_exports.string().trim().min(1).max(200),
  detectorVersion: external_exports.string().trim().min(1).max(100),
  category: InsightCategorySchema,
  state: AccountingStateSchema,
  enabled: external_exports.boolean(),
  emitted: AccountingCountSchema,
  rejected: AccountingCountSchema,
  duplicateCount: AccountingCountSchema,
  capped: external_exports.boolean(),
  cap: DetectorCapSchema.optional(),
  limitation: AccountingTextSchema.optional(),
  disabledReason: AccountingTextSchema.optional()
}).strict().superRefine((value, context) => {
  if (value.enabled === false && !value.disabledReason) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["disabledReason"],
      message: "A disabled detector requires a bounded reason."
    });
  }
  if (value.enabled && value.disabledReason) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["disabledReason"],
      message: "An enabled detector cannot carry a disabled reason."
    });
  }
  if (value.capped && !value.cap && !value.limitation) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["cap"],
      message: "A capped detector requires cap details or a limitation."
    });
  }
});
var CategoryAccountingSchema = external_exports.object({
  category: InsightCategorySchema,
  state: AccountingStateSchema,
  detectorCount: AccountingCountSchema,
  emitted: AccountingCountSchema,
  rejected: AccountingCountSchema,
  capped: external_exports.boolean(),
  reason: AccountingTextSchema.optional(),
  limitation: AccountingTextSchema.optional(),
  limitations: AccountingTextListSchema.optional()
}).strict().superRefine((value, context) => {
  if (value.state !== "assessed" && !value.reason && !value.limitation && !(value.limitations && value.limitations.length > 0)) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["reason"],
      message: "A non-assessed category requires a bounded reason or limitation."
    });
  }
});
var ModelAccountingStateSchema = external_exports.enum([
  "complete",
  "partial",
  "blocked",
  "unavailable",
  "unassessed"
]);
var ModelCallAccountingSchema = external_exports.object({
  state: ModelAccountingStateSchema,
  understandingCalls: AccountingCountSchema,
  criticCalls: AccountingCountSchema,
  skippedCalls: AccountingCountSchema,
  cappedCalls: AccountingCountSchema,
  draftsBeforeCritic: AccountingCountSchema,
  draftsAfterCritic: AccountingCountSchema,
  rejectedDrafts: AccountingCountSchema,
  providerCalls: AccountingCountSchema.optional(),
  failedCalls: AccountingCountSchema.optional(),
  malformedCalls: AccountingCountSchema.optional(),
  timedOutCalls: AccountingCountSchema.optional(),
  cancelledCalls: AccountingCountSchema.optional(),
  limitations: AccountingTextListSchema
}).strict().superRefine((value, context) => {
  if (value.draftsAfterCritic > value.draftsBeforeCritic) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["draftsAfterCritic"],
      message: "Post-critic drafts cannot exceed pre-critic drafts."
    });
  }
});
var VisualAccountingSchema = external_exports.object({
  state: ModelAccountingStateSchema,
  suggestions: AccountingCountSchema,
  accepted: AccountingCountSchema,
  rejected: AccountingCountSchema,
  truncated: AccountingCountSchema,
  capped: external_exports.boolean(),
  capReason: AccountingTextSchema.optional(),
  limitations: AccountingTextListSchema
}).strict().superRefine((value, context) => {
  if (value.accepted + value.rejected > value.suggestions) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["accepted"],
      message: "Accepted and rejected visual findings cannot exceed suggestions."
    });
  }
  if (value.capped && !value.capReason) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["capReason"],
      message: "A capped visual review requires a bounded reason."
    });
  }
});
var PublicationStateSchema = external_exports.enum([
  "available",
  "blocked",
  "inconclusive",
  "unavailable",
  "unassessed"
]);
var PublicationAccountingSchema = external_exports.object({
  state: PublicationStateSchema,
  attempted: AccountingCountSchema,
  published: AccountingCountSchema,
  blocked: AccountingCountSchema,
  blockReason: external_exports.enum(["no_matching_catalog_service", "no_ready_catalog_service"]).optional(),
  limitations: AccountingTextListSchema
}).strict().superRefine((value, context) => {
  if (value.published + value.blocked > value.attempted) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["published"],
      message: "Published and blocked counts cannot exceed publication attempts."
    });
  }
  if (value.state === "blocked" && !value.blockReason) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["blockReason"],
      message: "A blocked publication requires a catalog block reason."
    });
  }
});
var AccountingBudgetsSchema = external_exports.object({
  pages: BudgetUsageSchema,
  renders: BudgetUsageSchema,
  probes: BudgetUsageSchema,
  modelCalls: BudgetUsageSchema
}).strict();
var InsightAccountingSchema = external_exports.object({
  state: AccountingStateSchema,
  reason: AccountingTextSchema.optional(),
  detectors: external_exports.array(DetectorAccountingSchema).max(500),
  categories: external_exports.array(CategoryAccountingSchema).length(INSIGHT_CATEGORIES.length),
  budgets: AccountingBudgetsSchema,
  enabledDetectorCount: AccountingCountSchema,
  disabledDetectorCount: AccountingCountSchema,
  modelShadow: ModelCallAccountingSchema,
  visual: VisualAccountingSchema,
  publication: PublicationAccountingSchema
}).strict().superRefine((value, context) => {
  if (value.state !== "assessed" && !value.reason) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["reason"],
      message: "A non-assessed run requires a bounded reason."
    });
  }
  if (value.state === "assessed" && value.categories.some((category) => category.state !== "assessed")) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["state"],
      message: "An assessed run cannot contain a category that was not assessed."
    });
  }
  const enabledCount = value.detectors.filter((detector) => detector.enabled).length;
  const disabledCount = value.detectors.length - enabledCount;
  if (value.enabledDetectorCount !== enabledCount || value.disabledDetectorCount !== disabledCount) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["enabledDetectorCount"],
      message: "Enabled and disabled detector counts must match the manifest."
    });
  }
  const categoryNames = value.categories.map((category) => category.category);
  const uniqueCategories = new Set(categoryNames);
  if (uniqueCategories.size !== INSIGHT_CATEGORIES.length || INSIGHT_CATEGORIES.some((category) => !uniqueCategories.has(category))) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["categories"],
      message: "Insight accounting must contain each category exactly once."
    });
  }
  for (const category of value.categories) {
    const detectors = value.detectors.filter(
      (detector) => detector.category === category.category
    );
    if (category.detectorCount !== detectors.length) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["categories", categoryNames.indexOf(category.category), "detectorCount"],
        message: "Category detector count must match the detector manifest."
      });
    }
    if (category.state === "assessed" && !detectors.some(
      (detector) => detector.enabled && detector.state === "assessed"
    )) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["categories", categoryNames.indexOf(category.category), "state"],
        message: "An assessed category requires at least one enabled, assessed detector."
      });
    }
  }
});
function emptyBudget() {
  return {
    limit: 0,
    used: 0,
    remaining: 0,
    attempted: 0,
    capped: false
  };
}
__name(emptyBudget, "emptyBudget");
function legacyInsightAccounting() {
  const reason = "legacy snapshot has no Increment 2 accounting";
  return InsightAccountingSchema.parse({
    state: "unassessed",
    reason,
    detectors: [],
    categories: INSIGHT_CATEGORIES.map((category) => ({
      category,
      state: "unassessed",
      detectorCount: 0,
      emitted: 0,
      rejected: 0,
      capped: false,
      reason,
      limitations: []
    })),
    budgets: {
      pages: emptyBudget(),
      renders: emptyBudget(),
      probes: emptyBudget(),
      modelCalls: emptyBudget()
    },
    enabledDetectorCount: 0,
    disabledDetectorCount: 0,
    modelShadow: {
      state: "unassessed",
      understandingCalls: 0,
      criticCalls: 0,
      skippedCalls: 0,
      cappedCalls: 0,
      draftsBeforeCritic: 0,
      draftsAfterCritic: 0,
      rejectedDrafts: 0,
      limitations: [reason]
    },
    visual: {
      state: "unassessed",
      suggestions: 0,
      accepted: 0,
      rejected: 0,
      truncated: 0,
      capped: false,
      limitations: [reason]
    },
    publication: {
      state: "unassessed",
      attempted: 0,
      published: 0,
      blocked: 0,
      limitations: [reason]
    }
  });
}
__name(legacyInsightAccounting, "legacyInsightAccounting");
var RunIdSchema = external_exports.string().trim().min(1).max(200);
var ReservationLabelSchema = external_exports.string().trim().min(1).max(160);
var BudgetLimitSchema = external_exports.number().int().nonnegative().max(1e4);
var ReservationCountSchema = external_exports.number().int().positive().max(1e4);
var RenderBudget = class {
  static {
    __name(this, "RenderBudget");
  }
  runId;
  limit;
  usedCount = 0;
  attemptedCount = 0;
  cappedState = false;
  capReasonValue;
  constructor(runId, limit) {
    this.runId = RunIdSchema.parse(runId);
    this.limit = BudgetLimitSchema.parse(limit);
  }
  get used() {
    return this.usedCount;
  }
  get remaining() {
    return this.limit - this.usedCount;
  }
  get attempted() {
    return this.attemptedCount;
  }
  reserve(label, count5) {
    const normalizedLabel2 = ReservationLabelSchema.parse(label);
    const normalizedCount = ReservationCountSchema.parse(count5);
    this.attemptedCount += normalizedCount;
    if (normalizedCount > this.remaining) {
      this.cappedState = true;
      this.capReasonValue ??= `Render budget could not reserve ${normalizedCount} for ${normalizedLabel2}.`;
      return false;
    }
    this.usedCount += normalizedCount;
    return true;
  }
  snapshot() {
    return BudgetUsageSchema.parse({
      limit: this.limit,
      used: this.usedCount,
      remaining: this.remaining,
      attempted: this.attemptedCount,
      capped: this.cappedState,
      ...this.capReasonValue ? { capReason: this.capReasonValue } : {}
    });
  }
};
