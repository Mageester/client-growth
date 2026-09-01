import { describe, expect, it } from "vitest";

import { checkClientDomain } from "../app/lib/clientDomain";
import { normalizeOrigin } from "@/adapters/evidence/urlPolicy";

describe("client domain validation at the point of entry", () => {
  const accepted: Array<[string, string]> = [
    ["example.com", "example.com"],
    [" Example.COM ", "example.com"],
    ["https://example.com", "example.com"],
    ["http://example.com/", "example.com"],
    ["www.acme-plumbing.co.uk", "www.acme-plumbing.co.uk"],
    // A bare host:port is a host, not a URL scheme.
    ["example.com:8443", "example.com:8443"],
  ];
  for (const [input, expected] of accepted) {
    it(`accepts ${JSON.stringify(input)}`, () => {
      const r = checkClientDomain(input);
      expect(r.ok).toBe(true);
      expect(r.domain).toBe(expected);
    });
  }

  const rejected = [
    "",
    "   ",
    "acme plumbing",       // a typo'd name, not a domain
    "localhost",
    "192.168.1.10",
    "intranet.local",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "notadomain",          // single label
  ];
  for (const input of rejected) {
    it(`rejects ${JSON.stringify(input)} with an explanation`, () => {
      const r = checkClientDomain(input);
      expect(r.ok).toBe(false);
      expect(r.error).toBeTruthy();
    });
  }

  it("only accepts what the crawler's own URL policy would accept", () => {
    for (const [input] of accepted) {
      const r = checkClientDomain(input);
      expect(normalizeOrigin(r.domain).ok).toBe(true);
    }
  });
});
