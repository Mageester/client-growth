import type { Candidate } from "@/core/schema";
import type { RuleContext } from "@/core/rules/context";
import { serviceForRule } from "@/core/rules/registry";
import {
  isReadablePage,
  normalizedTitle,
  pageCandidate,
} from "@/core/rules/technical";

const TAG = "duplicate-title";

/** Reports each repeated non-empty page title as one deduplicated finding. */
export async function duplicateTitleRule(ctx: RuleContext): Promise<Candidate[]> {
  const service = serviceForRule(ctx.catalog, TAG);
  if (!service) return [];

  const groups = new Map<string, Array<{ url: string; title: string }>>();
  for (const page of ctx.evidence.site.pages) {
    if (!isReadablePage(page)) continue;
    const title = page.title.trim();
    const key = normalizedTitle(title);
    if (!key) continue;
    const pages = groups.get(key) ?? [];
    pages.push({ url: page.url, title });
    groups.set(key, pages);
  }

  return [...groups.entries()]
    .filter(([, pages]) => pages.length > 1)
    .map(([key, pages]) => {
      const first = pages[0]!;
      const urls = pages.map((page) => page.url);
      return pageCandidate({
        ruleId: "duplicate-title",
        subject: key,
        detected:
          `The title "${first.title}" is repeated on ${pages.length} readable pages: ` +
          `${urls.join(", ")}.`,
        evidenceRefs: [
          ...urls.map((url) => `page:${url}`),
          `title:${first.title}`,
        ],
        suggestedServiceId: service.id,
      });
    });
}
