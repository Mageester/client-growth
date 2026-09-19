import { z } from "zod";
import { ClaimScopeSchema, EvidenceGradeSchema, EvidenceOriginSchema, InsightCategorySchema, ProblemTypeSchema } from "@/core/insightSchema";

export const FINDING_CALIBRATIONS = ["VERIFIED_DEFECT", "EVIDENCE_BACKED_COMMERCIAL_OPPORTUNITY", "NEEDS_CLIENT_CONTEXT", "UNSUPPORTED", "ORBIT_MEASUREMENT_LIMITATION"] as const;
export const FindingCalibrationSchema = z.enum(FINDING_CALIBRATIONS);
export type FindingCalibration = z.infer<typeof FindingCalibrationSchema>;
export const FINDING_TIERS = ["broken_conversion", "unreachable_content", "placeholder_production", "contact_action_mismatch", "trust_content_inconsistency", "accessibility_usability", "commercial_opportunity", "minor_metadata", "maintenance"] as const;
export const FindingTierSchema = z.enum(FINDING_TIERS);
export const FINDING_TIER_RANK = { broken_conversion: 1, unreachable_content: 2, placeholder_production: 3, contact_action_mismatch: 4, trust_content_inconsistency: 5, accessibility_usability: 6, commercial_opportunity: 7, minor_metadata: 8, maintenance: 9 } as const;
export const FINDING_SOURCES = ["deterministic", "broad_detector", "visual", "semantic"] as const;
export const FindingSourceSchema = z.enum(FINDING_SOURCES);
const boundedId = z.string().trim().min(1).max(200);
const boundedText = z.string().trim().max(5_000);
const boundedShort = z.string().trim().max(500);
const boundedList = (maxItems: number, maxLength = 2_000) => z.array(z.string().trim().min(1).max(maxLength)).max(maxItems);
export const FindingCatalogMatchSchema = z.object({ serviceId: boundedId, serviceName: z.string().trim().max(300), tag: z.string().trim().max(200).optional(), state: z.enum(["direct", "adjacent", "manual_review"]) }).strict();
export const FindingEvidenceCapSchema = z.object({ detectorId: boundedId, limit: z.number().int().nonnegative(), observed: z.number().int().nonnegative(), emitted: z.number().int().nonnegative(), omitted: z.number().int().nonnegative() }).strict();
export const PublishedFindingSchema = z.object({
  id: boundedId,
  fingerprint: boundedId,
  statement: boundedText,
  whyItMatters: boundedText,
  businessConsequence: boundedText.nullable(),
  category: InsightCategorySchema,
  problemType: ProblemTypeSchema,
  calibration: FindingCalibrationSchema,
  origin: EvidenceOriginSchema,
  tier: FindingTierSchema,
  rank: z.number().int().min(1).max(9),
  confidence: EvidenceGradeSchema,
  claimScope: ClaimScopeSchema,
  pages: boundedList(1_000),
  evidenceIds: boundedList(1_000),
  evidenceLabels: boundedList(1_000),
  validationSteps: boundedList(50),
  limitations: boundedList(100),
  catalogMatch: FindingCatalogMatchSchema.nullable(),
  opportunityId: boundedId.nullable(),
  source: FindingSourceSchema,
  reviewed: z.boolean(),
  measurementLimitation: boundedShort.optional(),
  evidenceCaps: z.array(FindingEvidenceCapSchema).max(20).optional(),
}).strict();
export const FindingSetSchema = z.object({ runId: boundedId, findings: z.array(PublishedFindingSchema).max(2_000), limitations: z.array(PublishedFindingSchema).max(2_000).default([]), withheld: z.number().int().nonnegative() }).strict();
export type PublishedFinding = z.infer<typeof PublishedFindingSchema>;
export type FindingSet = z.infer<typeof FindingSetSchema>;
