import { describe, expect, it } from "vitest";

import {
  runWithWorkerExecutionContext,
  waitUntilInCurrentWorker,
} from "../app/lib/workerContext.server";
import {
  createResendPasswordResetSender,
  createResendTeamInvitationSender,
  getResendConfig,
  RESEND_EMAILS_URL,
} from "../app/lib/resend.server";

describe("Worker background task context", () => {
  it("registers Better Auth background work with the active Worker context", async () => {
    const registered: Promise<unknown>[] = [];
    const context = {
      waitUntil(promise: Promise<unknown>) {
        registered.push(promise);
      },
    };

    const result = await runWithWorkerExecutionContext(context, async () => {
      waitUntilInCurrentWorker(Promise.resolve("delivered"));
      return "response";
    });

    expect(result).toBe("response");
    expect(registered).toHaveLength(1);
    await expect(registered[0]).resolves.toBe("delivered");
  });

  it("handles a rejected task safely when no Worker context is active", async () => {
    const rejected = Promise.reject(new Error("delivery failed"));

    waitUntilInCurrentWorker(rejected);

    await expect(rejected).rejects.toThrow("delivery failed");
  });
});

describe("Resend password-reset adapter", () => {
  const testUser = (email: string) => ({
    id: "user-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    email,
    emailVerified: false,
    name: "Test User",
  });

  it("requires both transport settings or disables the transport", () => {
    expect(getResendConfig({})).toBeNull();
    expect(() => getResendConfig({ RESEND_API_KEY: "key-only" })).toThrow(
      "configuration is incomplete",
    );
    expect(() => getResendConfig({ RESEND_FROM_EMAIL: "from-only@example.com" })).toThrow(
      "configuration is incomplete",
    );

    expect(
      getResendConfig({
        RESEND_API_KEY: "  re_test_key  ",
        RESEND_FROM_EMAIL: "  Axiom Orbit <auth@example.com>  ",
      }),
    ).toEqual({
      apiKey: "re_test_key",
      from: "Axiom Orbit <auth@example.com>",
    });
  });

  it("sends the generated reset URL as a plain-text Resend message", async () => {
    const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return new Response(null, { status: 202 });
    };
    const sender = createResendPasswordResetSender(
      { apiKey: "re_test_key", from: "Axiom Orbit <auth@example.com>" },
      fetcher,
    );

    await sender({
      user: testUser("owner@example.com"),
      url: "http://localhost:8787/api/auth/reset-password/token-123?callbackURL=fixed",
      token: "token-123",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(RESEND_EMAILS_URL);
    expect(calls[0]?.init?.method).toBe("POST");
    const requestHeaders = new Headers(calls[0]?.init?.headers);
    expect(requestHeaders.get("authorization")).toBe("Bearer re_test_key");
    expect(requestHeaders.get("content-type")).toBe("application/json");
    expect(requestHeaders.get("idempotency-key")).toBe("password-reset/token-123");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      from: string;
      to: string[];
      subject: string;
      text: string;
    };
    expect(body).toEqual({
      from: "Axiom Orbit <auth@example.com>",
      to: ["owner@example.com"],
      subject: "Reset your Axiom Orbit password",
      text: expect.stringContaining(
        "http://localhost:8787/api/auth/reset-password/token-123?callbackURL=fixed",
      ),
    });
    expect(body.text).toContain("expires in 1 hour");
    expect(body.text).toContain("used once");
  });

  it("sanitizes provider and network failures", async () => {
    const message = {
      user: testUser("owner@example.com"),
      url: "https://app.example.com/api/auth/reset-password/token-123?callbackURL=fixed",
      token: "token-123",
    };
    const providerFailure = createResendPasswordResetSender(
      { apiKey: "re_test_key", from: "auth@example.com" },
      async () => new Response("provider secret body", { status: 429 }),
    );
    const providerError = await providerFailure(message).catch((error: unknown) => error);
    expect(providerError).toBeInstanceOf(Error);
    expect((providerError as Error).message).toBe("Password reset email delivery failed");
    expect((providerError as Error).message).not.toContain("provider secret body");

    const networkFailure = createResendPasswordResetSender(
      { apiKey: "re_test_key", from: "auth@example.com" },
      async () => {
        throw new Error("provider key should not escape");
      },
    );
    const networkError = await networkFailure(message).catch((error: unknown) => error);
    expect((networkError as Error).message).toBe("Password reset email delivery failed");
    expect((networkError as Error).message).not.toContain("provider key");
  });
});

describe("Resend team-invitation adapter", () => {
  it("sends a single-use invitation link with an idempotent provider key", async () => {
    const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const sender = createResendTeamInvitationSender(
      { apiKey: "re_test_key", from: "Axiom Orbit <auth@example.com>" },
      async (input, init) => {
        calls.push({ input, init });
        return new Response(null, { status: 202 });
      },
    );

    await sender({
      email: "new@example.com",
      workspaceName: "Axiom Studio",
      role: "member",
      url: "https://app.example.com/invite/token-123",
      token: "token-123",
      expiresAt: "2026-09-11T12:00:00.000Z",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(RESEND_EMAILS_URL);
    const requestHeaders = new Headers(calls[0]?.init?.headers);
    expect(requestHeaders.get("authorization")).toBe("Bearer re_test_key");
    expect(requestHeaders.get("idempotency-key")).toBe("team-invitation/token-123");
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      from: string;
      to: string[];
      subject: string;
      text: string;
    };
    expect(body).toEqual({
      from: "Axiom Orbit <auth@example.com>",
      to: ["new@example.com"],
      subject: "Join Axiom Studio on Axiom Orbit",
      text: expect.stringContaining("https://app.example.com/invite/token-123"),
    });
    expect(body.text).toContain("can be accepted once");
    expect(body.text).toContain("2026-09-11T12:00:00.000Z");
  });
});
