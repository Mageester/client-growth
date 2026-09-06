import { describe, expect, it } from "vitest";

import {
  DEFAULT_SIGNUP_MODE,
  decideSignup,
  parseSignupPolicy,
} from "@/core/signupAccess";

const invite = (allowlist: string[] = []) =>
  ({ mode: "invite", allowlist }) as const;

describe("who may create a workspace", () => {
  it("is closed when the environment says nothing at all", () => {
    expect(DEFAULT_SIGNUP_MODE).toBe("invite");
    const policy = parseSignupPolicy({});
    expect(policy.mode).toBe("invite");
    expect(decideSignup({ policy, email: "stranger@example.com" }).allowed).toBe(false);
  });

  it("is closed when the mode is unrecognised rather than guessing it meant open", () => {
    for (const mode of ["OPEN", "public", "yes", "", 1, null]) {
      expect(parseSignupPolicy({ SIGNUP_MODE: mode }).mode, String(mode)).toBe("invite");
    }
  });

  it("admits everyone only when explicitly opened", () => {
    const policy = parseSignupPolicy({ SIGNUP_MODE: "open" });
    const decision = decideSignup({ policy, email: "stranger@example.com" });
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.basis).toBe("open");
  });

  it("admits a named address, case and whitespace insensitively", () => {
    const policy = parseSignupPolicy({
      SIGNUP_MODE: "invite",
      SIGNUP_ALLOWLIST: " Owner@Agency.example , second@agency.example ",
    });
    expect(decideSignup({ policy, email: "owner@AGENCY.example" }).allowed).toBe(true);
    expect(decideSignup({ policy, email: "  second@agency.example " }).allowed).toBe(true);
    expect(decideSignup({ policy, email: "someone@agency.example" }).allowed).toBe(false);
  });

  it("admits a whole domain when the entry is a bare domain", () => {
    const policy = invite(["@agency.example"]);
    expect(decideSignup({ policy, email: "anyone@agency.example" }).allowed).toBe(true);
    expect(decideSignup({ policy, email: "anyone@other.example" }).allowed).toBe(false);
  });

  it("does not let a lookalike domain pass as the allowed one", () => {
    const policy = invite(["@agency.example"]);
    for (const email of [
      "someone@notagency.example",
      "someone@agency.example.evil.test",
      "agency.example@evil.test",
      "someone@evil.test?@agency.example",
    ]) {
      expect(decideSignup({ policy, email }).allowed, email).toBe(false);
    }
  });

  it("refuses an address that is not an address", () => {
    const policy = invite(["@agency.example"]);
    for (const email of ["", "   ", "no-at-sign", "@agency.example", "trailing@"]) {
      expect(decideSignup({ policy, email }).allowed, JSON.stringify(email)).toBe(false);
    }
  });

  it("lets an invited colleague through without putting them on the list", () => {
    // Otherwise the gate would silently break the team feature: an owner sends
    // an invitation, and the invitee cannot create the account needed to accept it.
    const policy = invite([]);
    const decision = decideSignup({
      policy,
      email: "colleague@agency.example",
      hasPendingInvitation: true,
    });
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.basis).toBe("invitation");
  });

  it("explains the refusal without blaming the person for it", () => {
    const decision = decideSignup({ policy: invite([]), email: "stranger@example.com" });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toMatch(/invitation/i);
    expect(decision.reason).not.toMatch(/error|denied|forbidden|invalid/i);
  });
});
