import { beforeEach, describe, expect, it, vi } from "vitest";

const authApi = vi.hoisted(() => ({
  signUpEmail: vi.fn(),
  sendVerificationEmail: vi.fn(),
  signInEmail: vi.fn(),
}));

vi.mock("../app/lib/auth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/lib/auth.server")>();
  return { ...actual, getAuth: vi.fn(() => ({ api: authApi })) };
});

import { canDeliverEmail, resolveMailTransport } from "../app/lib/resend.server";
import * as login from "../app/routes/login";
import * as signup from "../app/routes/signup";

const BASE = {
  DB: {},
  BETTER_AUTH_SECRET: "x".repeat(40),
  BETTER_AUTH_URL: "https://app.example.com",
  SIGNUP_MODE: "open",
};

function form(url: string, fields: Record<string, string>) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("resolving an email transport", () => {
  it("reports nothing deliverable when neither Resend nor the dev transport is set", () => {
    const transport = resolveMailTransport({});
    expect(transport.kind).toBe("none");
    if (transport.kind !== "none") return;
    expect(transport.reason).toMatch(/RESEND_API_KEY/);
    expect(canDeliverEmail({})).toBe(false);
  });

  it("uses Resend when it is fully configured", () => {
    const transport = resolveMailTransport({
      RESEND_API_KEY: "re_test",
      RESEND_FROM_EMAIL: "Axiom <auth@example.com>",
    });
    expect(transport.kind).toBe("resend");
  });

  it("reports a half-configured Resend as undeliverable, not as a crash", () => {
    // The likeliest production mistake: the sender address is a plain var and
    // the API key is an encrypted secret, so exactly one of them goes missing.
    // Whoever hits it is signing up, and deserves a message rather than a 500.
    for (const env of [
      { RESEND_API_KEY: "re_test" },
      { RESEND_FROM_EMAIL: "Axiom <auth@example.com>" },
    ]) {
      const transport = resolveMailTransport(env);
      expect(transport.kind, JSON.stringify(env)).toBe("none");
      if (transport.kind !== "none") continue;
      expect(transport.reason).toMatch(/RESEND_API_KEY/);
      expect(transport.reason).toMatch(/RESEND_FROM_EMAIL/);
    }
    expect(canDeliverEmail({ RESEND_API_KEY: "re_test" })).toBe(false);
  });

  it("takes the console transport ahead of Resend when explicitly asked", () => {
    expect(
      resolveMailTransport({
        EMAIL_TRANSPORT: "console",
        RESEND_API_KEY: "re_test",
        RESEND_FROM_EMAIL: "Axiom <auth@example.com>",
      }).kind,
    ).toBe("console");
  });
});

describe("an environment that cannot send email", () => {
  it("creates no account at all, rather than one that can never be verified", async () => {
    const result = (await signup.action({
      request: form("https://app.example.com/signup", {
        email: "owner@agency.example",
        password: "correct-horse-battery",
        workspaceName: "Axiom Studio",
      }),
      context: { cloudflare: { env: BASE } },
    } as never)) as { error?: string };

    expect(result.error).toMatch(/unavailable/i);
    expect(result.error).toMatch(/nothing was created/i);
    expect(authApi.signUpEmail).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/no email transport/i));
  });

  it("does not tell a locked-out person a new verification link is on its way", async () => {
    const result = (await login.action({
      request: form("https://app.example.com/login", {
        intent: "resend-verification",
        email: "owner@agency.example",
      }),
      context: { cloudflare: { env: BASE } },
    } as never)) as { error?: string; verificationSent?: boolean };

    expect(result.verificationSent).toBeUndefined();
    expect(result.error).toMatch(/couldn|could not|try again/i);
    expect(authApi.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("lets both through again once a transport exists", async () => {
    authApi.signUpEmail.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    authApi.sendVerificationEmail.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const env = { ...BASE, EMAIL_TRANSPORT: "console" };
    await signup
      .action({
        request: form("https://app.example.com/signup", {
          email: "owner@agency.example",
          password: "correct-horse-battery",
          workspaceName: "Axiom Studio",
        }),
        context: { cloudflare: { env } },
      } as never)
      .catch((thrown: unknown) => thrown);
    expect(authApi.signUpEmail).toHaveBeenCalledTimes(1);

    const resent = (await login.action({
      request: form("https://app.example.com/login", {
        intent: "resend-verification",
        email: "owner@agency.example",
      }),
      context: { cloudflare: { env } },
    } as never)) as { verificationSent?: boolean };
    expect(resent.verificationSent).toBe(true);
  });
});
