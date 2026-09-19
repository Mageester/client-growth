// src/core/entitlements.ts
var MONITOR_ENTITLEMENT_MODES = ["off", "allowlist", "open"];
var DEFAULT_MONITOR_ENTITLEMENT_MODE = "off";
function isMonitorEntitlementMode(value) {
  return typeof value === "string" && MONITOR_ENTITLEMENT_MODES.includes(value);
}
__name(isMonitorEntitlementMode, "isMonitorEntitlementMode");
function parseMonitorEntitlementPolicy(raw = {}) {
  const mode = raw.MONITOR_ENTITLEMENT_MODE;
  return {
    mode: isMonitorEntitlementMode(mode) ? mode : DEFAULT_MONITOR_ENTITLEMENT_MODE,
    allowlist: parseAllowlist(raw.MONITOR_ALLOWLIST)
  };
}
__name(parseMonitorEntitlementPolicy, "parseMonitorEntitlementPolicy");
function decideMonitorEntitlement(input) {
  if (input.policy.mode === "open") return { entitled: true, basis: "open" };
  if (input.policy.mode === "allowlist" && input.ownerEmail && matchesAllowlist(input.policy.allowlist, input.ownerEmail)) {
    return { entitled: true, basis: "allowlist" };
  }
  return { entitled: false, basis: "off" };
}
__name(decideMonitorEntitlement, "decideMonitorEntitlement");
