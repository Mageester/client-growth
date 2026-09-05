import type { Candidate } from "@/core/schema";
import type { RuleContext } from "@/core/rules/context";
import { serviceForRule } from "@/core/rules/registry";
import { isReadablePage, pageCandidate, uniquePages } from "@/core/rules/technical";

const TAG = "missing-image-alt";

/** Reports only images with no alt ATTRIBUTE; alt="" remains decorative. */
export async function missingImageAltRule(ctx: RuleContext): Promise<Candidate[]> {
  const service = serviceForRule(ctx.catalog, TAG);
  if (!service) return [];

  return uniquePages(ctx.evidence.site.pages)
    .filter((page) => {
      if (!isReadablePage(page) || page.images === undefined) return false;
      return page.images.some((image) => image.alt === undefined);
    })
    .map((page) => {
      const missing = page.images!.filter((image) => image.alt === undefined).length;
      return pageCandidate({
        ruleId: "missing-image-alt",
        subject: page.url,
        detected:
          `The page ${page.url} contains ${missing} image${missing === 1 ? "" : "s"} ` +
          `without an alt attribute; decorative alt="" images are excluded.`,
        evidenceRefs: [`page:${page.url}`, `images-without-alt:${missing}`],
        suggestedServiceId: service.id,
      });
    });
}
