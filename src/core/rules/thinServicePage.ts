import type { Candidate } from "@/core/schema";
import type { RuleContext } from "@/core/rules/context";
import { serviceForRule } from "@/core/rules/registry";
import { isReadablePage, isServiceShapedPage, pageCandidate, uniquePages } from "@/core/rules/technical";

const TAG = "thin-service-page";
/** A small, fixed observation threshold; the candidate reports the measured count. */
export const THIN_SERVICE_PAGE_WORD_LIMIT = 120;

/** Reports service-shaped URLs whose readable page body is unusually short. */
export async function thinServicePageRule(ctx: RuleContext): Promise<Candidate[]> {
  const service = serviceForRule(ctx.catalog, TAG);
  if (!service) return [];

  return uniquePages(ctx.evidence.site.pages)
    .filter(
      (page) =>
        isReadablePage(page) &&
        isServiceShapedPage(page.url) &&
        page.wordCount < THIN_SERVICE_PAGE_WORD_LIMIT,
    )
    .map((page) =>
      pageCandidate({
        ruleId: "thin-service-page",
        subject: page.url,
        detected:
          `The service page ${page.url} contains ${page.wordCount} words, below the ` +
          `${THIN_SERVICE_PAGE_WORD_LIMIT}-word observation threshold.`,
        evidenceRefs: [`page:${page.url}`, `word-count:${page.wordCount}`],
        suggestedServiceId: service.id,
      }),
    );
}
