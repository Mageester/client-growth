import { describe, expect, it } from "vitest";

import { buildAuthOptions } from "../app/lib/authOptions";
import {
  createResendVerificationEmailSender,
  RESEND_EMAILS_URL,
} from "../app/lib/resend.server";
import { headers, makeTestAuth } from "./helpers/testAuth";

describe("email verification auth policy", () => {
  it("requires email verification before email-password sign-in", () => {
    const options = buildAuthOptions({
      database: {} as never,
      secret: "test-secret-".padEnd(48, "x"),
      baseURL: "http://localhost:8787",
    });

    expect(options.emailAndPassword?.requireEmailVerification).toBe(true);
  });

  it("sends a verification URL through Resend without exposing provider details", async () => {
    const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const sender = createResendVerificationEmailSender(
      { apiKey: "re_test_key", from: "Axiom Orbit <auth@example.com>" },
      async (input, init) => {
        calls.push({ input, init });
        return new Response(null, { status: 202 });
      },
    );

    await sender({
      user: {
        id: "user-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        email: "owner@example.com",
        emailVerified: false,
        name: "Test User",
      },
      url: "http://localhost:8787/api/auth/verify-email?token=token-123&callbackURL=%2Flogin",
      token: "token-123",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(RESEND_EMAILS_URL);
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer re_test_key");
    expect(headers.get("idempotency-key")).toBe("email-verification/token-123");

    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      from: string;
      to: string[];
      subject: string;
      text: string;
    };
    expect(body.from).toBe("Axiom Orbit <auth@example.com>");
    expect(body.to).toEqual(["owner@example.com"]);
    expect(body.subject).toBe("Verify your Axiom Orbit email");
    expect(body.text).toContain("token-123");
    expect(body.text).toContain("expires in 1 hour");
  });

  it("sanitizes verification provider and network failures", async () => {
    const message = {
      user: {
        id: "user-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        email: "owner@example.com",
        emailVerified: false,
        name: "Test User",
      },
      url: "https://app.example.com/api/auth/verify-email?token=token-123",
      token: "token-123",
    };
    const providerFailure = createResendVerificationEmailSender(
      { apiKey: "re_test_key", from: "auth@example.com" },
      async () => new Response("provider secret body", { status: 429 }),
    );
    const providerError = await providerFailure(message).catch((error: unknown) => error);
    expect(providerError).toBeInstanceOf(Error);
    expect((providerError as Error).message).toBe("Verification email delivery failed");
    expect((providerError as Error).message).not.toContain("provider secret body");

    const networkFailure = createResendVerificationEmailSender(
      { apiKey: "re_test_key", from: "auth@example.com" },
      async () => {
        throw new Error("provider key should not escape");
      },
    );
    const networkError = await networkFailure(message).catch((error: unknown) => error);
    expect((networkError as Error).message).toBe("Verification email delivery failed");
    expect((networkError as Error).message).not.toContain("provider key");
  });

  it("wires the verification sender for signup and unverified sign-in", async () => {
    const sender = async () => undefined;
    const options = buildAuthOptions({
      database: {} as never,
      secret: "test-secret-".padEnd(48, "x"),
      baseURL: "http://localhost:8787",
      sendVerificationEmail: sender,
    });

    expect(options.emailVerification?.sendVerificationEmail).toBe(sender);
    expect(options.emailVerification?.sendOnSignUp).toBe(true);
    expect(options.emailVerification?.sendOnSignIn).toBe(true);
    expect(options.emailVerification?.expiresIn).toBe(60 * 60);
  });

  it("blocks an unverified sign-in until the emailed token is used", async () => {
    const links: { url: string; token: string }[] = [];
    const { auth } = makeTestAuth({
      sendVerificationEmail: async ({ url, token }) => {
        links.push({ url, token });
      },
    });

    const signup = await auth.api.signUpEmail({
      body: {
        email: "owner@example.com",
        password: "correct-horse-battery",
        name: "Owner",
        callbackURL: "http://localhost:8787/login?verified=success",
      },
      asResponse: true,
    });

    expect(signup.status).toBe(200);
    expect(signup.headers.get("set-cookie") ?? "").toBe("");
    expect(links).toHaveLength(1);
    expect(links[0]!.url).toContain("/verify-email?token=");
    expect(links[0]!.url).toContain("callbackURL=http%3A%2F%2Flocalhost%3A8787%2Flogin");

    const blocked = await auth.api.signInEmail({
      body: { email: "owner@example.com", password: "correct-horse-battery" },
      asResponse: true,
    });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual(
      expect.objectContaining({ code: "EMAIL_NOT_VERIFIED" }),
    );
    expect(links).toHaveLength(2);

    const verified = await auth.api.verifyEmail({
      query: { token: links[0]!.token },
      asResponse: true,
    });
    expect(verified.status).toBe(200);

    const replay = await auth.api.verifyEmail({
      query: { token: links[0]!.token },
      asResponse: true,
    });
    // Better Auth treats a second verification as an idempotent success, so
    // the message must not promise single-use behavior to the recipient.
    expect(replay.ok).toBe(true);

    const signedIn = await auth.api.signInEmail({
      body: { email: "owner@example.com", password: "correct-horse-battery" },
      asResponse: true,
    });
    expect(signedIn.status).toBe(200);
    expect(
      await auth.api.getSession({ headers: headers(signedIn.headers.get("set-cookie") ?? "") }),
    ).not.toBeNull();
  });
});
