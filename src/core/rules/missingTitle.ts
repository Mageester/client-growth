import type { Candidate } from "@/core/schema";
import type { RuleContext } from "@/core/rules/context";
import { serviceForRule } from "@/core/rules/registry";
import { isReadablePage, pageCandidate } from "@/core/rules/technical";

const TAG = "missing-title";

/** Reports pages whose inspected HTML has no non-empty title text. */
export async function missingTitleRule(ctx: RuleContext): Promise<Candidate[]> {
  const service = serviceForRule(ctx.catalog, TAG);
  if (!service) return [];

  return ctx.evidence.site.pages
    .filter((page) => isReadablePage(page) && page.title.trim() === "")
    .map((page) =>
      pageCandidate({
        ruleId: "missing-title",
        subject: page.url,
        detected: `The page ${page.url} has no non-empty HTML title element.`,
        evidenceRefs: [`page:${page.url}`, "title:missing"],
        suggestedServiceId: service.id,
      }),
    );
}
