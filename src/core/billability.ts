import type { BillabilityStatus, Coverage } from "@/core/schema";

/**
 * Is the agency service this opportunity maps to already covered by the client's
 * contract? If so it must not be surfaced as a billable upsell.
 */
export function resolveBillability(
  suggestedServiceId: string,
  coverage: Coverage[],
): BillabilityStatus {
  const isCovered = coverage.some(
    (c) => c.serviceId === suggestedServiceId && c.covered === true,
  );
  return isCovered ? "already_covered" : "billable";
}
