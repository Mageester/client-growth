import type { EvidenceBundle } from "@/core/schema";

/**
 * Was the client's site actually reached during this run?
 *
 * A run that fetched nothing (bad domain, DNS failure, timeout, blocked host)
 * produces exactly the same shape of "nothing found" as a healthy site with no
 * problems. Those two must never look the same to the agency: one means "no
 * work to sell", the other means "we learned nothing". This assessment is what
 * the pipeline and the UI use to tell them apart.
 */
export interface SiteReachability {
  /** At least one page returned real content (status < 400). */
  reached: boolean;
  /** Pages the crawler recorded a status for (including error pages). */
  pagesSeen: number;
  /** Pages that returned content we could parse. */
  pagesOk: number;
  /** Requests refused by the URL policy (bad domain, private host, bad scheme). */
  blocked: number;
  /** Requests that could not be completed or trusted (DNS, timeout, size cap). */
  inconclusive: number;
  reason: string;
}

export function assessReachability(evidence: EvidenceBundle): SiteReachability {
  const pages = evidence.site.pages;
  const pagesOk = pages.filter((p) => p.status > 0 && p.status < 400).length;
  const blocked = evidence.networkEvents.filter((e) => e.outcome === "blocked").length;
  const inconclusive = evidence.networkEvents.filter((e) => e.outcome === "inconclusive").length;
  const reached = pagesOk > 0;

  let reason: string;
  if (reached) {
    reason = `Reached the site and read ${pagesOk} page(s).`;
  } else if (blocked > 0) {
    const first = evidence.networkEvents.find((e) => e.outcome === "blocked");
    reason =
      `The site could not be visited: ${first?.reason ?? "the address was refused by the URL policy"}. ` +
      `Check the client's website domain.`;
  } else if (pages.length > 0) {
    reason =
      `Every page the crawler reached returned an error status; no readable content was retrieved. ` +
      `Nothing can be concluded about this site.`;
  } else {
    const first = evidence.networkEvents.find((e) => e.outcome === "inconclusive");
    reason =
      `The site could not be reached: ${first?.reason ?? "no response"}. ` +
      `The domain may be wrong, or the site may be down or blocking automated requests.`;
  }

  return { reached, pagesSeen: pages.length, pagesOk, blocked, inconclusive, reason };
}
