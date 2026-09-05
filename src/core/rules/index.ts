import type { Candidate } from "@/core/schema";
import type { Rule, RuleContext } from "@/core/rules/context";
import { missingServicePageRule } from "@/core/rules/missingServicePage";
import { noServicePagesRule } from "@/core/rules/noServicePages";
import { brokenConversionPathRule } from "@/core/rules/brokenConversionPath";
import { missingTitleRule } from "@/core/rules/missingTitle";
import { duplicateTitleRule } from "@/core/rules/duplicateTitle";
import { thinServicePageRule } from "@/core/rules/thinServicePage";
import { missingH1Rule } from "@/core/rules/missingH1";
import { brokenInternalLinkRule } from "@/core/rules/brokenInternalLink";
import { missingMetaDescriptionRule } from "@/core/rules/missingMetaDescription";
import { missingStructuredDataRule } from "@/core/rules/missingStructuredData";
import { missingImageAltRule } from "@/core/rules/missingImageAlt";
import { aggregateTechnicalCandidates } from "@/core/rules/technical";
import { serviceForRule } from "@/core/rules/registry";

export type { Rule, RuleContext };

/**
 * V0 rules. Each is a pure async function of RuleContext. Adding a rule is a new
 * file plus one line here.
 */
export const allRules: Rule[] = [
  missingServicePageRule,
  noServicePagesRule,
  brokenConversionPathRule,
  missingTitleRule,
  duplicateTitleRule,
  thinServicePageRule,
  missingH1Rule,
  brokenInternalLinkRule,
  missingMetaDescriptionRule,
  missingStructuredDataRule,
  missingImageAltRule,
];

export async function runRules(ctx: RuleContext): Promise<Candidate[]> {
  const configuredProbeBudget = ctx.probeBudget?.remaining;
  const totalProbeBudget = Math.max(
    0,
    Number.isFinite(configuredProbeBudget) ? Math.floor(configuredProbeBudget!) : 8,
  );
  const internalLinkActive = serviceForRule(ctx.catalog, "broken-internal-link") !== null;
  const conversionActive = serviceForRule(ctx.catalog, "conversion-fix") !== null;
  const internalLinkBudget =
    internalLinkActive && conversionActive
      ? Math.ceil(totalProbeBudget / 2)
      : internalLinkActive
        ? totalProbeBudget
        : 0;
  const conversionBudget =
    conversionActive && internalLinkActive
      ? totalProbeBudget - internalLinkBudget
      : conversionActive
        ? totalProbeBudget
        : 0;

  const contextFor = (rule: Rule): RuleContext => {
    if (rule === brokenInternalLinkRule) {
      return { ...ctx, probeBudget: { remaining: internalLinkBudget } };
    }
    if (rule === brokenConversionPathRule) {
      return { ...ctx, probeBudget: { remaining: conversionBudget } };
    }
    return ctx;
  };

  const batches = await Promise.all(allRules.map((rule) => rule(contextFor(rule))));
  return aggregateTechnicalCandidates({
    client: ctx.client,
    candidates: batches.flat(),
    suppressedEvidenceRefsByRule: ctx.technicalSuppressedEvidenceRefsByRule,
  });
}
