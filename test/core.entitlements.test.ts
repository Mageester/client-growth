import { describe, expect, it } from "vitest";

import {
  DEFAULT_MONITOR_ENTITLEMENT_MODE,
  decideMonitorEntitlement,
  isWorkspaceEntitledToMonitor,
  parseMonitorEntitlementPolicy,
} from "@/core/entitlements";

describe("MONITOR entitlement policy", () => {
  it("defaults to off when the environment says nothing", () => {
    const policy = parseMonitorEntitlementPolicy({});
    expect(policy.mode).toBe("off");
    expect(DEFAULT_MONITOR_ENTITLEMENT_MODE).toBe("off");
    expect(policy.allowlist).toEqual([]);
  });

  it("treats an unrecognised mode as off rather than throwing", () => {
    expect(parseMonitorEntitlementPolicy({ MONITOR_ENTITLEMENT_MODE: "premium" }).mode).toBe("off");
  });

  it("parses an allowlist of addresses and domains, lowercased", () => {
    const policy = parseMonitorEntitlementPolicy({
      MONITOR_ENTITLEMENT_MODE: "allowlist",
      MONITOR_ALLOWLIST: "Owner@Agency.example, @Big.example",
    });
    expect(policy.allowlist).toEqual(["owner@agency.example", "@big.example"]);
  });
});

describe("decideMonitorEntitlement", () => {
  it("off mode entitles nobody, even a named owner", () => {
    const policy = { mode: "off" as const, allowlist: ["owner@agency.example"] };
    expect(decideMonitorEntitlement({ policy, ownerEmail: "owner@agency.example" }).entitled).toBe(
      false,
    );
  });

  it("open mode entitles every workspace, even without an owner email", () => {
    const policy = { mode: "open" as const, allowlist: [] };
    const decision = decideMonitorEntitlement({ policy, ownerEmail: null });
    expect(decision).toEqual({ entitled: true, basis: "open" });
  });

  it("allowlist mode entitles a named address", () => {
    const policy = { mode: "allowlist" as const, allowlist: ["owner@agency.example"] };
    expect(
      decideMonitorEntitlement({ policy, ownerEmail: "Owner@Agency.example" }),
    ).toEqual({ entitled: true, basis: "allowlist" });
  });

  it("allowlist mode entitles anyone at an allowlisted domain", () => {
    const policy = { mode: "allowlist" as const, allowlist: ["@agency.example"] };
    expect(decideMonitorEntitlement({ policy, ownerEmail: "someone@agency.example" }).entitled).toBe(
      true,
    );
  });

  it("allowlist mode refuses an unlisted address", () => {
    const policy = { mode: "allowlist" as const, allowlist: ["owner@agency.example"] };
    expect(decideMonitorEntitlement({ policy, ownerEmail: "stranger@other.example" }).entitled).toBe(
      false,
    );
  });

  it("fails closed on a missing or malformed owner email", () => {
    const policy = { mode: "allowlist" as const, allowlist: ["@agency.example"] };
    expect(decideMonitorEntitlement({ policy, ownerEmail: null }).entitled).toBe(false);
    expect(decideMonitorEntitlement({ policy, ownerEmail: "" }).entitled).toBe(false);
    // Two "@" is refused outright rather than read as belonging to the domain.
    expect(
      decideMonitorEntitlement({ policy, ownerEmail: "a@evil.test?@agency.example" }).entitled,
    ).toBe(false);
  });
});

describe("isWorkspaceEntitledToMonitor", () => {
  it("reads mode and allowlist straight from a raw env record", () => {
    const env = {
      MONITOR_ENTITLEMENT_MODE: "allowlist",
      MONITOR_ALLOWLIST: "@agency.example",
    };
    expect(isWorkspaceEntitledToMonitor(env, "owner@agency.example")).toBe(true);
    expect(isWorkspaceEntitledToMonitor(env, "owner@elsewhere.example")).toBe(false);
    expect(isWorkspaceEntitledToMonitor({}, "owner@agency.example")).toBe(false);
  });
});
