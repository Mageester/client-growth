import { z } from "zod";

/** Rule identifiers emitted by the production analysis pipeline. */
export const RULE_IDS = [
  "visual-conversion-opportunity",
  "missing-service-page",
  "no-service-pages",
  "broken-conversion-path",
  "competitor-service-gap",
  "missing-title",
  "duplicate-title",
  "thin-service-page",
  "missing-h1",
  "broken-internal-link",
  "missing-meta-description",
  "missing-structured-data",
  "missing-image-alt",
] as const;

export const RuleIdSchema = z.enum(RULE_IDS);
export type RuleId = z.infer<typeof RuleIdSchema>;
