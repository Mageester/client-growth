/**
 * Who is allowed to create a NEW workspace.
 *
 * Self-serve signup and metered, paid work are a bad pair without billing: the
 * per-workspace analysis cap bounds a tenant, and nothing bounds the number of
 * tenants, so "anyone with an email address" is also "anyone with a share of
 * the operator's provider bill". Until there is a way to charge, admission to
 * the product is a decision someone makes on purpose.
 *
 * This is deliberately not a paywall and not an approval queue. It is the
 * smallest thing that turns an open door into a guest list, and it is designed
 * to be deleted the day billing exists.
 *
 * Pure: no database, no environment, no clock beyond what is handed in.
 */

import { matchesAllowlist, normalizeEmail, parseAllowlist } from "@/core/allowlist";

export const SIGNUP_MODES = ["open", "invite"] as const;
export type SignupMode = (typeof SIGNUP_MODES)[number];

export interface SignupPolicy {
  mode: SignupMode;
  /**
   * Lowercased entries. A full address ("owner@agency.example") admits exactly
   * that person; a bare domain ("@agency.example") admits everyone at it.
   */
  allowlist: readonly string[];
}

export type SignupDecision =
  | { allowed: true; basis: "open" | "allowlist" | "invitation" }
  | { allowed: false; reason: string };

/**
 * The default is `invite`, so an environment that forgets to say anything is
 * closed rather than open. A missing ceiling that fails open is how a bill
 * arrives before the news does.
 */
export const DEFAULT_SIGNUP_MODE: SignupMode = "invite";

function isSignupMode(value: unknown): value is SignupMode {
  return typeof value === "string" && (SIGNUP_MODES as readonly string[]).includes(value);
}

/** Normalize one address for comparison. Never used for delivery. */
export function normalizeSignupEmail(email: string): string {
  return normalizeEmail(email);
}

export function parseSignupAllowlist(raw: unknown): string[] {
  return parseAllowlist(raw);
}

export function parseSignupPolicy(raw: Record<string, unknown> = {}): SignupPolicy {
  const mode = raw.SIGNUP_MODE;
  return {
    mode: isSignupMode(mode) ? mode : DEFAULT_SIGNUP_MODE,
    allowlist: parseSignupAllowlist(raw.SIGNUP_ALLOWLIST),
  };
}

/**
 * The address-matching rule (exactly one "@", full-address or whole-domain
 * entries, stricter-than-a-mail-server) lives in [[allowlist]] so the signup
 * gate and the MONITOR entitlement gate ([[entitlements]]) agree on it.
 *
 * `hasPendingInvitation` is what keeps the gate from breaking the team feature:
 * an owner who invites a colleague has already made exactly the decision this
 * policy exists to require, and the invitee has no account yet, so they must be
 * able to create one. It is proven against the address they are signing up
 * with, not asserted by them.
 */
export function decideSignup(input: {
  policy: SignupPolicy;
  email: string;
  hasPendingInvitation?: boolean;
}): SignupDecision {
  if (input.policy.mode === "open") return { allowed: true, basis: "open" };
  if (input.hasPendingInvitation) return { allowed: true, basis: "invitation" };
  if (matchesAllowlist(input.policy.allowlist, input.email)) {
    return { allowed: true, basis: "allowlist" };
  }
  return {
    allowed: false,
    reason:
      "Axiom Orbit is not open for public sign-up yet. Ask the agency that invited you to send an invitation, or contact us for access.",
  };
}
