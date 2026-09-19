// src/core/siteUnderstandingSchema.ts
var boundedId2 = external_exports.string().trim().min(1).max(200);
var boundedKey = external_exports.string().trim().min(1).max(200).refine((value) => !/[<>]/.test(value), "Keys cannot contain markup.").refine(
  (value) => !/(?:https?:|www\.|\/\/|mailto:|tel:)/i.test(value),
  "Keys must reference supplied IDs rather than URLs."
);
var boundedText2 = external_exports.string().trim().min(1).max(5e3);
var boundedShortText2 = external_exports.string().trim().min(1).max(500);
var boundedStringList2 = /* @__PURE__ */ __name((maxItems, maxLength = 500) => external_exports.array(external_exports.string().trim().min(1).max(maxLength)).max(maxItems), "boundedStringList");
var unsafeUrl = /(?:https?:\/\/|www\.|\/\/|mailto:|tel:)[^\s<>{}"']+/i;
var markup = /[<>]/;
var commercialOrSensitive = /(?:\$|€|£|\b(?:usd|cad|aud|gbp|price|pricing|revenue|traffic|demand|conversion\s+rate|metric|analytics|password|credential|secret|token|api[-_ ]?key|authorization|bearer|cookie|session|raw[-_ ]?html)\b)/i;
var inventedMeasurement = /\b\d+(?:\.\d+)?\s*(?:%|percent|milliseconds?|ms|seconds?|secs?|px|bytes?|kb|mb|users?|visitors?|customers?|locations?|employees?|years?)(?![a-z])/i;
var currencyValue = /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?)|(?:\b\d[\d,]*(?:\.\d+)?\s*(?:usd|cad|aud|gbp|dollars?|euros?|pounds?|cents?)\b)/gi;
var contactValue = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b|(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
var currencyValueTest = new RegExp(currencyValue.source, "i");
var unsafeUrlGlobal = new RegExp(unsafeUrl.source, "gi");
var measurementGlobal = new RegExp(inventedMeasurement.source, "gi");
var URL_PROSE_ERROR = "Model prose cannot contain URLs outside supplied evidence IDs.";
var MARKUP_PROSE_ERROR = "Model prose cannot contain markup.";
var COMMERCIAL_PROSE_ERROR = "Model prose cannot invent commercial, metric, or sensitive facts.";
var MEASUREMENT_PROSE_ERROR = "Model prose cannot invent measurements or client facts.";
var ADVICE_PROSE_ERROR = "Model prose must describe a supported, specific issue rather than generic advice.";
var genericAdvice = /\b(?:make\s+it\s+modern|moderni[sz]e|redesign\s+the\s+(?:site|website)|follow\s+best\s+practices|improve\s+seo|improve\s+ux|improve\s+user\s+experience|add\s+(?:more\s+)?cta(?:s)?|add\s+more\s+content|refresh\s+the\s+design|optimi[sz]e\s+the\s+website)\b/i;
var adequateSolution = /\b(?:already\s+(?:adequate|adequately\s+\w+|solves|works)|adequately\s+(?:serves|supports|handles)|working\s+well|no\s+change\s+is\s+needed)\b/i;
var serviceClaim = /\b(?:add|offer|provide|sell|create|build|need|needs|launch|introduce)\b[^.!?]{0,100}\b(?:service|services|offering|offerings|product|package)\b/i;
var absenceClaim = /\b(?:no|not|never|without|missing|absent|lack(?:s|ing)?|nowhere|nothing|doesn['’]?t\s+have|does\s+not\s+have)\b/i;
var BoundedClientFactsSchema = external_exports.object({
  clientId: boundedId2,
  name: external_exports.string().trim().min(1).max(300),
  domain: external_exports.string().trim().min(1).max(300),
  offerings: boundedStringList2(50, 300),
  notes: external_exports.string().trim().max(1e3).default(""),
  facts: boundedStringList2(50, 500).optional()
}).strict();
var CapabilityDescriptionSchema = external_exports.object({
  id: boundedId2,
  name: boundedShortText2,
  description: external_exports.string().trim().max(1e3).default(""),
  deliverableIds: boundedStringList2(50, 200).default([]),
  deliverables: boundedStringList2(50, 300).optional(),
  intent: external_exports.string().trim().max(500).optional(),
  serviceId: boundedId2.optional()
}).strict();
var SubtypeDefinitionSchema = external_exports.object({
  id: boundedId2.optional(),
  subtypeId: boundedId2.optional(),
  version: boundedId2.optional(),
  problemType: ProblemTypeSchema2.optional(),
  category: InsightCategorySchema2,
  claimKind: external_exports.enum(["presence", "absence", "comparison", "measurement", "supported_inference"]),
  minimumGrade: external_exports.enum(["strong", "moderate", "limited", "insufficient"]),
  requiresCompleteCoverage: external_exports.boolean(),
  requiresCounterEvidence: external_exports.boolean(),
  projectWorkstream: boundedKey,
  legacyRuleId: boundedId2.nullable(),
  reconciliationPolicy: external_exports.enum(["condition_clears_with_current_evidence", "requires_current_evidence"]),
  eligibleEvidenceKinds: boundedStringList2(30, 80).optional(),
  capabilityIntent: boundedStringList2(20, 300).optional(),
  deliverableIds: boundedStringList2(50, 200).optional(),
  /**
   * What the subtype means, in one operator sentence. Without it the model
   * selects among 31 snake_case identifiers with no way to tell a
   * production-breaking condition from an editorial nicety.
   */
  description: external_exports.string().trim().max(1e3).optional(),
  /** Business-impact tier, lower sorting first. */
  priority: ProblemPrioritySchema.optional(),
  /**
   * True when this subtype may be raised from cited evidence alone, with no
   * deterministic diagnostic behind it. Told to the model explicitly so it
   * knows which conditions it is allowed to report first-hand.
   */
  modelAnchored: external_exports.boolean().optional()
}).strict();
var SiteUnderstandingInputSchema = external_exports.object({
  clientId: boundedId2,
  clientFacts: BoundedClientFactsSchema,
  evidence: external_exports.array(EvidenceRefSchema).max(1e4),
  diagnostics: external_exports.array(DiagnosticSchema).max(5e3),
  categories: external_exports.array(AnalysisCategoryAssessmentSchema).max(10),
  capabilities: external_exports.array(CapabilityDescriptionSchema).max(100),
  subtypeDefinitions: external_exports.array(SubtypeDefinitionSchema).max(100)
}).strict().superRefine((value, context) => {
  if (value.clientId !== value.clientFacts.clientId) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["clientId"],
      message: "The input clientId must match clientFacts.clientId."
    });
  }
  addUniqueIdIssue(value.evidence.map((item) => item.id), "evidence", context);
  addUniqueIdIssue(value.diagnostics.map((item) => item.id), "diagnostics", context);
  addUniqueIdIssue(value.capabilities.map((item) => item.id), "capabilities", context);
  const categoryNames = value.categories.map((item) => item.category);
  addUniqueIdIssue(categoryNames, "categories", context);
  addSharedEvidenceIdentityIssues(value.evidence, value.diagnostics, value.clientId, context);
  for (const definition3 of value.subtypeDefinitions) {
    if (definition3.problemType) {
      const taxonomy = definitionForProblemType(definition3.problemType);
      if (taxonomy.category !== definition3.category) {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: ["subtypeDefinitions"],
          message: "Subtype definition category must match the taxonomy."
        });
      }
    }
  }
});
var ProblemDraftCandidateSchema = external_exports.object({
  /** Accepted only for compatibility; adapters never trust this value. */
  draftId: boundedId2.optional(),
  clientId: boundedId2,
  category: InsightCategorySchema2,
  problemType: ProblemTypeSchema2,
  canonicalSurface: boundedKey,
  rootCause: boundedKey,
  /**
   * Empty is allowed only for the semantic subtypes, where the condition is
   * one no deterministic sensor observed and the draft stands on the evidence
   * it cites. Everything else must still group an existing diagnostic.
   */
  diagnosticIds: boundedStringList2(100, 200),
  evidenceIds: boundedStringList2(100, 200).min(1),
  statement: boundedText2,
  whyItMatters: boundedText2,
  businessConsequence: boundedText2.optional(),
  validationSteps: boundedStringList2(4, 500).min(1)
}).strict().superRefine((draft, context) => {
  if (draft.diagnosticIds.length === 0 && !MODEL_ANCHORED_PROBLEM_TYPES.has(draft.problemType)) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["diagnosticIds"],
      message: "A grouped draft must cite at least one supplied diagnostic."
    });
  }
});
var ProblemDraftSchema = external_exports.object({
  draftId: external_exports.string().trim().min(1).max(100),
  clientId: boundedId2,
  category: InsightCategorySchema2,
  problemType: ProblemTypeSchema2,
  canonicalSurface: boundedKey,
  rootCause: boundedKey,
  diagnosticIds: boundedStringList2(100, 200),
  evidenceIds: boundedStringList2(100, 200).min(1),
  statement: boundedText2,
  whyItMatters: boundedText2,
  businessConsequence: boundedText2.optional(),
  validationSteps: boundedStringList2(4, 500).min(1)
}).strict().superRefine((draft, context) => {
  if (draft.diagnosticIds.length === 0 && !MODEL_ANCHORED_PROBLEM_TYPES.has(draft.problemType)) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["diagnosticIds"],
      message: "A grouped draft must cite at least one supplied diagnostic."
    });
  }
});
var CriticDecisionSchema = external_exports.object({
  draftId: external_exports.string().trim().min(1).max(100),
  decision: external_exports.enum(["retain", "reject"]),
  reasons: boundedStringList2(6, 700).min(1)
}).strict();
var InsightCriticInputSchema = external_exports.object({
  evidence: external_exports.array(EvidenceRefSchema).max(1e4),
  diagnostics: external_exports.array(DiagnosticSchema).max(5e3),
  drafts: external_exports.array(ProblemDraftSchema).max(100)
}).strict().superRefine((value, context) => {
  addUniqueIdIssue(value.evidence.map((item) => item.id), "evidence", context);
  addUniqueIdIssue(value.diagnostics.map((item) => item.id), "diagnostics", context);
  addUniqueIdIssue(value.drafts.map((item) => item.draftId), "drafts", context);
  addSharedEvidenceIdentityIssues(value.evidence, value.diagnostics, void 0, context);
  const evidenceIds = new Set(value.evidence.map((entry2) => entry2.id));
  const diagnosticIds = new Set(value.diagnostics.map((diagnostic) => diagnostic.id));
  const clientIds = new Set(value.diagnostics.map((diagnostic) => diagnostic.clientId));
  for (const draft of value.drafts) {
    if (clientIds.size > 0 && !clientIds.has(draft.clientId)) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["drafts"],
        message: "Every critic draft must belong to the supplied diagnostic client."
      });
    }
    if (draft.diagnosticIds.some((id) => !diagnosticIds.has(id))) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["drafts"],
        message: "Every critic draft diagnostic reference must resolve in the supplied diagnostics."
      });
    }
    if (draft.evidenceIds.some((id) => !evidenceIds.has(id))) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["drafts"],
        message: "Every critic draft evidence reference must resolve in the supplied evidence."
      });
    }
  }
  if (clientIds.size === 0 && value.drafts.length > 0) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["diagnostics"],
      message: "Critic drafts require a supplied diagnostic client identity."
    });
  }
});
var SiteUnderstandingResultSchema = external_exports.object({
  status: external_exports.enum(["complete", "partial", "unavailable"]),
  drafts: external_exports.array(ProblemDraftSchema).max(100),
  rejectedDrafts: external_exports.number().int().nonnegative().max(1e5),
  limitations: boundedStringList2(100, 500),
  providerCalls: external_exports.number().int().nonnegative().max(100)
}).strict();
var InsightCriticResultSchema = external_exports.object({
  status: external_exports.enum(["complete", "partial", "unavailable"]),
  decisions: external_exports.array(CriticDecisionSchema).max(100),
  rejectedDrafts: external_exports.number().int().nonnegative().max(1e5),
  limitations: boundedStringList2(100, 500),
  providerCalls: external_exports.number().int().nonnegative().max(100)
}).strict();
function normalizeIdentityPart(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
__name(normalizeIdentityPart, "normalizeIdentityPart");
function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}
__name(fnv1a64, "fnv1a64");
function canonicalIds(values) {
  return [...new Set(values.map(normalizeIdentityPart))].sort(
    (left, right) => left.localeCompare(right)
  );
}
__name(canonicalIds, "canonicalIds");
function canonicalDraftTuple(input) {
  return JSON.stringify({
    clientId: normalizeIdentityPart(input.clientId),
    category: normalizeIdentityPart(input.category),
    problemType: normalizeIdentityPart(input.problemType),
    canonicalSurface: normalizeIdentityPart(input.canonicalSurface),
    rootCause: normalizeIdentityPart(input.rootCause),
    diagnosticIds: canonicalIds(input.diagnosticIds),
    evidenceIds: canonicalIds(input.evidenceIds)
  });
}
__name(canonicalDraftTuple, "canonicalDraftTuple");
function problemDraftId(input, hashIdentity = fnv1a64) {
  return `draft_${hashIdentity(canonicalDraftTuple(input))}`;
}
__name(problemDraftId, "problemDraftId");
function addUniqueIdIssue(ids, path, context) {
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: [path],
      message: `${path} IDs must be unique.`
    });
  }
}
__name(addUniqueIdIssue, "addUniqueIdIssue");
function addSharedEvidenceIdentityIssues(evidence, diagnostics, expectedClientId, context) {
  const evidenceRunIds = new Set(evidence.map((entry2) => entry2.runId));
  if (evidenceRunIds.size > 1) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["evidence"],
      message: "All supplied evidence must belong to one analysis run."
    });
  }
  const diagnosticRunIds = new Set(diagnostics.map((diagnostic) => diagnostic.runId));
  const workspaceIds = new Set(diagnostics.map((diagnostic) => diagnostic.workspaceId));
  const clientIds = new Set(diagnostics.map((diagnostic) => diagnostic.clientId));
  if (diagnosticRunIds.size > 1) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["diagnostics"],
      message: "All supplied diagnostics must belong to one analysis run."
    });
  }
  if (workspaceIds.size > 1) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["diagnostics"],
      message: "All supplied diagnostics must belong to one workspace."
    });
  }
  if (clientIds.size > 1) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["diagnostics"],
      message: "All supplied diagnostics must belong to one client."
    });
  }
  if (expectedClientId && diagnostics.some((diagnostic) => diagnostic.clientId !== expectedClientId)) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["diagnostics"],
      message: "Every diagnostic must belong to the supplied client."
    });
  }
  const [evidenceRunId] = [...evidenceRunIds];
  const [diagnosticRunId] = [...diagnosticRunIds];
  if (evidenceRunId && diagnosticRunId && evidenceRunId !== diagnosticRunId) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["evidence"],
      message: "Supplied evidence and diagnostics must belong to the same analysis run."
    });
  }
  const evidenceIds = new Set(evidence.map((entry2) => entry2.id));
  for (const diagnostic of diagnostics) {
    if (diagnostic.evidenceRefs.some((ref) => !evidenceIds.has(ref))) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["diagnostics"],
        message: "Every diagnostic evidence reference must resolve in the supplied evidence."
      });
      break;
    }
  }
}
__name(addSharedEvidenceIdentityIssues, "addSharedEvidenceIdentityIssues");
function forbiddenProse(value) {
  if (unsafeUrl.test(value)) return URL_PROSE_ERROR;
  if (markup.test(value)) return MARKUP_PROSE_ERROR;
  if (commercialOrSensitive.test(value)) return COMMERCIAL_PROSE_ERROR;
  if (inventedMeasurement.test(value)) return MEASUREMENT_PROSE_ERROR;
  if (genericAdvice.test(value)) return ADVICE_PROSE_ERROR;
  return null;
}
__name(forbiddenProse, "forbiddenProse");
function normalizeQuotedText(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
__name(normalizeQuotedText, "normalizeQuotedText");
function trimTrailingPunctuation(value) {
  return value.replace(/[.,;:!?)\]}"']+$/g, "");
}
__name(trimTrailingPunctuation, "trimTrailingPunctuation");
function sourceFromRows(rows) {
  const text = normalizeQuotedText(JSON.stringify(rows));
  return { text, digits: text.replace(/\D+/g, "") };
}
__name(sourceFromRows, "sourceFromRows");
function citedSourceText(evidenceIds, diagnosticIds, evidenceById, diagnosticById) {
  const cited = [];
  const seenEvidence = /* @__PURE__ */ new Set();
  for (const id of evidenceIds) {
    if (seenEvidence.has(id)) continue;
    seenEvidence.add(id);
    const row = evidenceById.get(id);
    if (row !== void 0) cited.push(row);
  }
  const seenDiagnostics = /* @__PURE__ */ new Set();
  for (const id of diagnosticIds) {
    if (seenDiagnostics.has(id)) continue;
    seenDiagnostics.add(id);
    const row = diagnosticById.get(id);
    if (row !== void 0) cited.push(row);
  }
  return sourceFromRows(cited);
}
__name(citedSourceText, "citedSourceText");
function quotedFromSource(literal2, source2) {
  const needle = trimTrailingPunctuation(normalizeQuotedText(literal2));
  return needle.length >= 2 && source2.text.includes(needle);
}
__name(quotedFromSource, "quotedFromSource");
function phoneQuotedFromSource(literal2, source2) {
  const digits = literal2.replace(/\D+/g, "");
  return digits.length >= 10 && source2.digits.includes(digits);
}
__name(phoneQuotedFromSource, "phoneQuotedFromSource");
function contactQuotedFromSource(literal2, source2) {
  return literal2.includes("@") ? quotedFromSource(literal2, source2) : phoneQuotedFromSource(literal2, source2);
}
__name(contactQuotedFromSource, "contactQuotedFromSource");
function forbiddenDraftProse(value, source2) {
  for (const literal2 of value.match(unsafeUrlGlobal) ?? []) {
    if (!quotedFromSource(literal2, source2)) return URL_PROSE_ERROR;
  }
  if (markup.test(value)) return MARKUP_PROSE_ERROR;
  for (const literal2 of value.match(currencyValue) ?? []) {
    if (!quotedFromSource(literal2, source2)) return COMMERCIAL_PROSE_ERROR;
  }
  for (const literal2 of value.match(contactValue) ?? []) {
    if (!contactQuotedFromSource(literal2, source2)) return COMMERCIAL_PROSE_ERROR;
  }
  if (commercialOrSensitive.test(value.replace(currencyValue, " "))) {
    return COMMERCIAL_PROSE_ERROR;
  }
  for (const literal2 of value.match(measurementGlobal) ?? []) {
    if (!quotedFromSource(literal2, source2)) return MEASUREMENT_PROSE_ERROR;
  }
  if (genericAdvice.test(value)) return ADVICE_PROSE_ERROR;
  return null;
}
__name(forbiddenDraftProse, "forbiddenDraftProse");
function draftProseError(values, source2) {
  for (const value of values) {
    const error3 = forbiddenDraftProse(value, source2);
    if (error3) return error3;
  }
  return null;
}
__name(draftProseError, "draftProseError");
function inventsService(value, input) {
  if (!serviceClaim.test(value)) return false;
  const normalized3 = value.toLowerCase();
  return !input.clientFacts.offerings.some((offering) => {
    const candidate = offering.toLowerCase().trim();
    return candidate.length > 0 && normalized3.includes(candidate);
  });
}
__name(inventsService, "inventsService");
function absenceSupported(input, diagnosticIds) {
  return input.diagnostics.some((diagnostic) => {
    if (!diagnosticIds.includes(diagnostic.id)) return false;
    if (diagnostic.state !== "observed") return false;
    const definition3 = definitionForProblemType(diagnostic.problemType);
    return definition3.claimKind === "absence" || /(?:missing|no_|absence)/i.test(diagnostic.problemType);
  });
}
__name(absenceSupported, "absenceSupported");
function draftText(draft) {
  return [draft.statement, draft.whyItMatters, draft.businessConsequence ?? "", ...draft.validationSteps];
}
__name(draftText, "draftText");
function definitionTypes(input) {
  const explicit = input.subtypeDefinitions.map((definition3) => definition3.problemType).filter((value) => value !== void 0);
  return new Set(explicit);
}
__name(definitionTypes, "definitionTypes");
function validateProblemDrafts(rawInput, rawDrafts, maxDrafts = 20, options = {}) {
  const input = SiteUnderstandingInputSchema.parse(rawInput);
  if (!Number.isInteger(maxDrafts) || maxDrafts < 0 || maxDrafts > 100) {
    throw new Error("maxDrafts must be an integer between 0 and 100.");
  }
  const evidenceIds = new Set(input.evidence.map((entry2) => entry2.id));
  const diagnosticIds = new Set(input.diagnostics.map((diagnostic) => diagnostic.id));
  const evidenceById = new Map(input.evidence.map((entry2) => [entry2.id, entry2]));
  const diagnosticById = new Map(input.diagnostics.map((entry2) => [entry2.id, entry2]));
  const explicitTypes = definitionTypes(input);
  const drafts = [];
  const limitations = [];
  const tuples = /* @__PURE__ */ new Set();
  const ids = /* @__PURE__ */ new Map();
  let rejectedDrafts = 0;
  let repairedDrafts = 0;
  const reject = /* @__PURE__ */ __name((reason) => {
    rejectedDrafts += 1;
    if (!limitations.includes(reason) && limitations.length < 100) limitations.push(reason);
  }, "reject");
  for (const raw of rawDrafts.slice(0, Math.max(rawDrafts.length, maxDrafts))) {
    const parsed = ProblemDraftCandidateSchema.safeParse(raw);
    if (!parsed.success) {
      reject("A grouped draft did not match the bounded problem contract.");
      continue;
    }
    const candidate = parsed.data;
    if (candidate.clientId !== input.clientId) {
      reject("A grouped draft referenced a different client.");
      continue;
    }
    const taxonomy = definitionForProblemType(candidate.problemType);
    if (taxonomy.category !== candidate.category) {
      reject("A grouped draft used a category outside the approved taxonomy.");
      continue;
    }
    if (explicitTypes.size > 0 && !explicitTypes.has(candidate.problemType)) {
      reject("A grouped draft used a subtype that was not supplied in the approved definitions.");
      continue;
    }
    if (candidate.evidenceIds.length === 0) {
      reject("Every grouped draft must cite at least one supplied evidence ID.");
      continue;
    }
    if (candidate.diagnosticIds.length === 0 && !MODEL_ANCHORED_PROBLEM_TYPES.has(candidate.problemType)) {
      reject("Every grouped draft must cite at least one supplied diagnostic ID.");
      continue;
    }
    if (new Set(candidate.diagnosticIds).size !== candidate.diagnosticIds.length || new Set(candidate.evidenceIds).size !== candidate.evidenceIds.length) {
      reject("A grouped draft must cite each diagnostic and evidence ID at most once.");
      continue;
    }
    if (candidate.diagnosticIds.some((id) => !diagnosticIds.has(id))) {
      reject("A grouped draft referenced an unknown diagnostic ID.");
      continue;
    }
    const unresolvedEvidence = candidate.evidenceIds.filter((id) => !evidenceIds.has(id));
    if (unresolvedEvidence.length > 0) {
      const resolvedEvidence = candidate.evidenceIds.filter((id) => evidenceIds.has(id));
      if (resolvedEvidence.length === 0) {
        reject("A grouped draft referenced an unknown evidence ID.");
        continue;
      }
      candidate.evidenceIds = resolvedEvidence;
      repairedDrafts += 1;
    }
    const textValues = draftText(candidate);
    const sourceText = citedSourceText(
      candidate.evidenceIds,
      candidate.diagnosticIds,
      evidenceById,
      diagnosticById
    );
    const proseError = draftProseError(textValues, sourceText);
    if (proseError) {
      reject(proseError);
      continue;
    }
    if (textValues.some((value) => inventsService(value, input))) {
      reject("A grouped draft invented a client service or offering outside the supplied facts.");
      continue;
    }
    if (textValues.some((value) => adequateSolution.test(value))) {
      reject("A grouped draft treated an adequate existing solution as new work.");
      continue;
    }
    const firstHandContentReading = candidate.diagnosticIds.length === 0 && MODEL_ANCHORED_PROBLEM_TYPES.has(candidate.problemType);
    if (!firstHandContentReading && !absenceSupported(input, candidate.diagnosticIds) && textValues.some((value) => absenceClaim.test(value))) {
      reject("An absence claim was not supported by the supplied observed evidence.");
      continue;
    }
    const tuple = canonicalDraftTuple(candidate);
    const draftId = problemDraftId(candidate, options.hashIdentity);
    const priorTuple = ids.get(draftId);
    if (priorTuple && priorTuple !== tuple) {
      return {
        drafts: [],
        rejectedDrafts: rawDrafts.length,
        limitations: ["A deterministic draft ID collision was detected; the grouped response was rejected."]
      };
    }
    if (tuples.has(tuple)) {
      return {
        drafts: [],
        rejectedDrafts: rawDrafts.length,
        limitations: ["Duplicate grouped drafts with the same canonical tuple were rejected."]
      };
    }
    if (drafts.length >= maxDrafts) {
      reject("The grouped draft cap was reached; excess drafts were withheld.");
      continue;
    }
    const draft = ProblemDraftSchema.parse({ ...candidate, draftId });
    tuples.add(tuple);
    ids.set(draftId, tuple);
    drafts.push(draft);
  }
  if (repairedDrafts > 0) {
    limitations.push(
      `The bounded repair dropped unresolvable evidence references from ${repairedDrafts} grouped draft(s); no reference was remapped or substituted, and each repaired draft was re-validated against its remaining cited rows.`
    );
  }
  if (rawDrafts.length > maxDrafts) {
    const excess = rawDrafts.length - maxDrafts;
    if (excess > 0 && rejectedDrafts < excess) {
      rejectedDrafts += excess - rejectedDrafts;
    }
    if (!limitations.some((item) => /cap/i.test(item))) {
      limitations.push(`The grouped understanding output exceeded the ${maxDrafts}-draft cap.`);
    }
  }
  drafts.sort((left, right) => left.draftId.localeCompare(right.draftId));
  return { drafts, rejectedDrafts, limitations };
}
__name(validateProblemDrafts, "validateProblemDrafts");
function validateCriticDecisions(rawDecisions, rawDrafts, evidence = []) {
  const result = validateCriticDecisionsWithRepair(rawDecisions, rawDrafts, evidence);
  if (result.repaired) {
    throw new Error(
      result.limitations.join(" ") || "Critic output did not satisfy the remove-only decision contract."
    );
  }
  return result.decisions;
}
__name(validateCriticDecisions, "validateCriticDecisions");
function validateCriticDecisionsWithRepair(rawDecisions, rawDrafts, evidence = []) {
  const drafts = external_exports.array(ProblemDraftSchema).max(100).parse(rawDrafts);
  if (!Array.isArray(rawDecisions)) throw new Error("Critic output must contain a decisions array.");
  const expected = new Set(drafts.map((draft) => draft.draftId));
  const suppliedText = evidence.length > 0 ? sourceFromRows(evidence) : { text: "", digits: "" };
  const limitations = [];
  const byDraftId = /* @__PURE__ */ new Map();
  let droppedDecisionCount = 0;
  for (const raw of rawDecisions) {
    const parsed = CriticDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      droppedDecisionCount += 1;
      continue;
    }
    const decision = parsed.data;
    if (!expected.has(decision.draftId)) {
      droppedDecisionCount += 1;
      continue;
    }
    if (byDraftId.has(decision.draftId)) {
      droppedDecisionCount += 1;
      continue;
    }
    const reasonError = suppliedText.text.length > 0 ? draftProseError(decision.reasons, suppliedText) : decision.reasons.map(forbiddenProse).find(Boolean);
    if (reasonError) {
      droppedDecisionCount += 1;
      continue;
    }
    byDraftId.set(decision.draftId, decision);
  }
  const undecidedDraftIds = drafts.map((draft) => draft.draftId).filter((draftId) => !byDraftId.has(draftId));
  const decisions = drafts.map(
    (draft) => byDraftId.get(draft.draftId) ?? {
      draftId: draft.draftId,
      decision: "reject",
      reasons: [
        "The review stage returned no usable decision for this item, so it was withheld rather than published unreviewed."
      ]
    }
  );
  const reordered = rawDecisions.length === drafts.length && drafts.some((draft, index) => {
    const raw = rawDecisions[index];
    return raw !== null && typeof raw === "object" && raw.draftId !== draft.draftId;
  });
  const repaired = droppedDecisionCount > 0 || undecidedDraftIds.length > 0 || reordered;
  if (droppedDecisionCount > 0) {
    limitations.push(
      `${droppedDecisionCount} review decision(s) could not be used (malformed, repeated, or naming an unknown item) and were discarded; the affected items were withheld rather than published unreviewed.`
    );
  }
  if (undecidedDraftIds.length > 0) {
    limitations.push(
      `The review stage returned no decision for ${undecidedDraftIds.length} of ${drafts.length} item(s); those items were withheld rather than published unreviewed.`
    );
  }
  if (reordered && droppedDecisionCount === 0 && undecidedDraftIds.length === 0) {
    limitations.push(
      "The review stage returned its decisions in a different order from the supplied items; they were matched by identity before use."
    );
  }
  return { decisions, repaired, undecidedDraftIds, droppedDecisionCount, limitations };
}
__name(validateCriticDecisionsWithRepair, "validateCriticDecisionsWithRepair");
