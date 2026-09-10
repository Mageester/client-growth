import { beforeEach, describe, expect, it, vi } from "vitest";

const authApi = vi.hoisted(() => ({
  sendVerificationEmail: vi.fn(),
  signInEmail: vi.fn(),
}));

vi.mock("../app/lib/auth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/lib/auth.server")>();
  return { ...actual, getAuth: vi.fn(() => ({ api: authApi })) };
});

import { readFileSync } from "node:fs";

import * as login from "../app/routes/login";
import { requestReturnTo, safeReturnTo } from "../app/lib/return-to";
import { requireSession, __setSessionResolver } from "../app/lib/session.server";

const context = {
  cloudflare: {
    env: {
      DB: {},
      BETTER_AUTH_SECRET: "x".repeat(40),
      BETTER_AUTH_URL: "https://app.example.com",
      // Delivery itself is covered by email.transport.test.ts; these suites
      // only need an environment that is capable of sending.
      EMAIL_TRANSPORT: "console",
    },
  },
};

function form(fields: Record<string, string>) {
  return new Request("https://app.example.com/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("login verification callback return path", () => {
  it("keeps the invite path on automatic and manual verification sends", async () => {
    authApi.signInEmail.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "EMAIL_NOT_VERIFIED" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    const blocked = await login.action({
      request: form({
        email: "recipient@example.com",
        password: "correct-horse-battery",
        returnTo: "/invite/token-123",
      }),
      context,
    } as never);
    expect(blocked).toEqual({
      error: "Verify your email before logging in.",
      verificationRequired: true,
      email: "recipient@example.com",
      returnTo: "/invite/token-123",
    });
    expect(authApi.signInEmail.mock.calls[0]?.[0].body.callbackURL).toBe(
      "https://app.example.com/login?verified=success&returnTo=%2Finvite%2Ftoken-123",
    );

    authApi.sendVerificationEmail.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await login.action({
      request: form({
        intent: "resend-verification",
        email: "recipient@example.com",
        returnTo: "/invite/token-123",
      }),
      context,
    } as never);
    expect(authApi.sendVerificationEmail.mock.calls[0]?.[0].body.callbackURL).toBe(
      "https://app.example.com/login?verified=success&returnTo=%2Finvite%2Ftoken-123",
    );
  });
});

/**
 * Signing back in has to put you where you were.
 *
 * The audit opened a private report deep link while logged out and was sent to
 * a bare `/login`. After signing in it landed on Home, with no way back except
 * to find the report again — and client detail had no list of saved reports to
 * find it in. Two defects compounding: the guard threw away the destination,
 * and nothing else remembered it.
 *
 * The sanitizer is the interesting half. A return target is attacker-supplied
 * text in a query string; it must resolve to a path on THIS origin or to
 * nothing at all. `//evil.example` is the one that catches people out — it
 * starts with a slash and is a protocol-relative absolute URL.
 */
describe("protected routes carry the destination through login", () => {
  it("sends an anonymous visitor to login with the exact path and query", () => {
    expect(requestReturnTo(new Request("https://orbit.example/reports/report-1?view=summary"))).toBe(
      "/reports/report-1?view=summary",
    );

    const target = requestReturnTo(new Request("https://orbit.example/reports/report-1?view=summary"));
    expect(`/login?returnTo=${encodeURIComponent(target)}`).toBe(
      "/login?returnTo=%2Freports%2Freport-1%3Fview%3Dsummary",
    );
  });

  it("keeps a same-origin path, with its query and fragment", () => {
    expect(safeReturnTo("/reports/report-1?view=summary")).toBe("/reports/report-1?view=summary");
    expect(safeReturnTo("/clients/cli_a#history")).toBe("/clients/cli_a#history");
    expect(safeReturnTo("  /opportunities  ")).toBe("/opportunities");
  });

  it("refuses anything that could leave this origin", () => {
    for (const hostile of [
      "https://evil.example",
      "//evil.example",
      "//evil.example/reports/report-1",
      "http://orbit.example.evil.example/",
      "javascript:alert(1)",
      "\\\\evil.example",
      "",
      "   ",
      "reports/report-1",
    ]) {
      expect(safeReturnTo(hostile), hostile).toBeUndefined();
    }
    expect(safeReturnTo(null)).toBeUndefined();
    expect(safeReturnTo(undefined)).toBeUndefined();
  });

  it("is the sanitizer both login and signup use, not two copies of one", () => {
    const loginSource = readFileSync(new URL("../app/routes/login.tsx", import.meta.url), "utf8");
    const signupSource = readFileSync(new URL("../app/routes/signup.tsx", import.meta.url), "utf8");
    const guardSource = readFileSync(
      new URL("../app/lib/session.server.ts", import.meta.url),
      "utf8",
    );

    for (const source of [loginSource, signupSource, guardSource]) {
      expect(source).toContain("return-to");
      expect(source).not.toContain("function safeReturnTo");
    }
    // The guard is what makes the destination survive at all.
    expect(guardSource).toContain("requestReturnTo");
  });
});

it("redirects the guard's caller to login with the destination attached", async () => {
  __setSessionResolver(async () => null);
  try {
    const thrown = await requireSession(
      new Request("https://orbit.example/reports/report-1?view=summary"),
      { cloudflare: { env: {} } } as never,
    ).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("location")).toBe(
      "/login?returnTo=%2Freports%2Freport-1%3Fview%3Dsummary",
    );
  } finally {
    __setSessionResolver(null);
  }
});
