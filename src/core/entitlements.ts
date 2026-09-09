/**
 * Who has the paid MONITOR feature.
 *
 * MONITOR is the product's first paid tier and the only feature that both
 * spends money *unattended* (the recurring scanner it is built on) and reaches
 * *outside* the app on its own (the weekly digest email). Until there is a way
 * to charge, "this workspace is paying for MONITOR" is a decision an operator
 * makes on purpose — exactly the same shape of decision as admission to the
 * product ([[signupAccess]]).
 *
 * This is the smallest honest stand-in for billing: an operator-managed guest
 * list, default-closed, designed to be deleted the day real billing exists. It
 * deliberately reuses the same address-matching rule as the signup gate
 * ([[allowlist]]).
 *
 * Pure: no database, no environment beyond the raw record handed in, no clock.
 */

import { matchesAllowlist, parseAllowlist } from "@/core/allowlist";

export const MONITOR_ENTITLEMENT_MODES = ["off", "allowlist", "open"] as const;
export type MonitorEntitlementMode = (typeof MONITOR_ENTITLEMENT_MODES)[number];

/**
 * The default is `off`, so an environment that says nothing grants the paid
 * feature to nobody. A paid capability that fails *open* is a provider bill and
 * a batch of emails you never decided to send.
 */
export const DEFAULT_MONITOR_ENTITLEMENT_MODE: MonitorEntitlementMode = "off";

export interface MonitorEntitlementPolicy {
  mode: MonitorEntitlementMode;
  /** Lowercased entries: "owner@agency.example" or "@agency.example". */
  allowlist: readonly string[];
}

export type MonitorEntitlementDecision = {
  entitled: boolean;
  basis: "open" | "allowlist" | "off";
};

export function isMonitorEntitlementMode(value: unknown): value is MonitorEntitlementMode {
  return (
    typeof value === "string" &&
    (MONITOR_ENTITLEMENT_MODES as readonly string[]).includes(value)
  );
}

export function parseMonitorEntitlementPolicy(
  raw: Record<string, unknown> = {},
): MonitorEntitlementPolicy {
  const mode = raw.MONITOR_ENTITLEMENT_MODE;
  return {
    mode: isMonitorEntitlementMode(mode) ? mode : DEFAULT_MONITOR_ENTITLEMENT_MODE,
    allowlist: parseAllowlist(raw.MONITOR_ALLOWLIST),
  };
}

/**
 * Is this workspace entitled to MONITOR?
 *
 * Decided from its OWNER's address, because a workspace is entitled as a paying
 * account, not per signed-in member. An owner email that is missing or
 * unparseable is never entitled — the gate fails closed, which for a paid,
 * spend-bearing feature is the correct direction to be wrong in.
 */
export function decideMonitorEntitlement(input: {
  policy: MonitorEntitlementPolicy;
  ownerEmail: string | null | undefined;
}): MonitorEntitlementDecision {
  if (input.policy.mode === "open") return { entitled: true, basis: "open" };
  if (
    input.policy.mode === "allowlist" &&
    input.ownerEmail &&
    matchesAllowlist(input.policy.allowlist, input.ownerEmail)
  ) {
    return { entitled: true, basis: "allowlist" };
  }
  return { entitled: false, basis: "off" };
}

/**
 * Convenience for the common call site that holds the raw environment record
 * and the owner's email and just wants a yes/no.
 */
export function isWorkspaceEntitledToMonitor(
  raw: Record<string, unknown>,
  ownerEmail: string | null | undefined,
): boolean {
  return decideMonitorEntitlement({
    policy: parseMonitorEntitlementPolicy(raw),
    ownerEmail,
  }).entitled;
}
