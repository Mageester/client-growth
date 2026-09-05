import type { Candidate } from "@/core/schema";
import type { RuleContext } from "@/core/rules/context";
import { serviceForRule } from "@/core/rules/registry";
import { isReadablePage, pageCandidate, uniquePages } from "@/core/rules/technical";

const TAG = "missing-meta-description";

/** Reports a missing or empty meta description only when that field was observed. */
export async function missingMetaDescriptionRule(ctx: RuleContext): Promise<Candidate[]> {
  const service = serviceForRule(ctx.catalog, TAG);
  if (!service) return [];

  return uniquePages(ctx.evidence.site.pages)
    .filter(
      (page) =>
        isReadablePage(page) &&
        page.metaDescription !== undefined &&
        page.metaDescription.trim() === "",
    )
    .map((page) =>
      pageCandidate({
        ruleId: "missing-meta-description",
        subject: page.url,
        detected: `The page ${page.url} has no non-empty meta description.`,
        evidenceRefs: [`page:${page.url}`, "meta-description:missing"],
        suggestedServiceId: service.id,
      }),
    );
}
