import type { Candidate } from "@/core/schema";
import type { RuleContext } from "@/core/rules/context";
import { serviceForRule } from "@/core/rules/registry";
import { isReadablePage, pageCandidate, uniquePages } from "@/core/rules/technical";

const TAG = "missing-h1";

/** Reports readable pages where the parser observed no H1 element with text. */
export async function missingH1Rule(ctx: RuleContext): Promise<Candidate[]> {
  const service = serviceForRule(ctx.catalog, TAG);
  if (!service) return [];

  return uniquePages(ctx.evidence.site.pages)
    .filter((page) => isReadablePage(page) && page.h1s.length === 0)
    .map((page) =>
      pageCandidate({
        ruleId: "missing-h1",
        subject: page.url,
        detected: `The page ${page.url} has no non-empty H1 heading.`,
        evidenceRefs: [`page:${page.url}`, "h1:missing"],
        suggestedServiceId: service.id,
      }),
    );
}
