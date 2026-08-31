import type { Candidate } from "@/core/schema";
import { missingServicePageRule, type RuleContext } from "@/core/rules/missingServicePage";

export type { RuleContext };
export type Rule = (ctx: RuleContext) => Candidate[];

/**
 * V0 ships one rule, done well. Adding a rule later is a new file plus one line
 * here — not a refactor.
 */
export const allRules: Rule[] = [missingServicePageRule];

export function runRules(ctx: RuleContext): Candidate[] {
  return allRules.flatMap((rule) => rule(ctx));
}
