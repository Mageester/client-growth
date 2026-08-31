import type { Candidate } from "@/core/schema";
import type { Rule, RuleContext } from "@/core/rules/context";
import { missingServicePageRule } from "@/core/rules/missingServicePage";
import { brokenConversionPathRule } from "@/core/rules/brokenConversionPath";

export type { Rule, RuleContext };

/**
 * V0 rules. Each is a pure async function of RuleContext. Adding a rule is a new
 * file plus one line here.
 */
export const allRules: Rule[] = [missingServicePageRule, brokenConversionPathRule];

export async function runRules(ctx: RuleContext): Promise<Candidate[]> {
  const batches = await Promise.all(allRules.map((rule) => rule(ctx)));
  return batches.flat();
}
