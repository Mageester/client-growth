import { beforeEach, describe, expect, it, vi } from "vitest";

const authApi = vi.hoisted(() => ({
  sendVerificationEmail: vi.fn(),
  signInEmail: vi.fn(),
}));

vi.mock("../app/lib/auth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/lib/auth.server")>();
  return { ...actual, getAuth: vi.fn(() => ({ api: authApi })) };
});

import * as login from "../app/routes/login";

const context = {
  cloudflare: {
    env: {
      DB: {},
      BETTER_AUTH_SECRET: "x".repeat(40),
      BETTER_AUTH_URL: "https://app.example.com",
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
