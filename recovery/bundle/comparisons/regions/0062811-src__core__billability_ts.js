// src/core/billability.ts
function resolveBillability(suggestedServiceId, coverage) {
  const isCovered = coverage.some(
    (c) => c.serviceId === suggestedServiceId && c.covered === true
  );
  return isCovered ? "already_covered" : "billable";
}
__name(resolveBillability, "resolveBillability");
