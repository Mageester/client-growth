import { beforeEach, describe, expect, it, vi } from "vitest";

const authApi = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock("../app/lib/auth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/lib/auth.server")>();
  return {
    ...actual,
    getAuth: vi.fn(() => ({ api: authApi })),
  };
});

import * as forgotPassword from "../app/routes/forgot-password";
import * as login from "../app/routes/login";
import * as resetPassword from "../app/routes/reset-password";

const env = {
  DB: {},
  BETTER_AUTH_SECRET: "x".repeat(40),
  BETTER_AUTH_URL: "https://app.example.com",
};
const context = { cloudflare: { env } };

function formRequest(fields: Record<string, string>, url = "https://app.example.com/forgot-password") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "203.0.113.10" },
    body: new URLSearchParams(fields),
  });
}

async function thrownResponse(action: Promise<unknown>): Promise<Response> {
  try {
    await action;
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
  throw new Error("Expected the route action to redirect");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("forgot-password route", () => {
  it("uses the trusted callback and ignores a user-supplied redirect", async () => {
    authApi.requestPasswordReset.mockResolvedValue(new Response(null, { status: 200 }));

    const result = await forgotPassword.action({
      request: formRequest({
        email: "owner@example.com",
        redirectTo: "https://evil.example/steal-token",
      }),
      context,
    } as never);

    expect(result).toEqual({ submitted: true });
    expect(authApi.requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          email: "owner@example.com",
          redirectTo: "https://app.example.com/reset-password",
        },
        asResponse: true,
      }),
    );
    expect(authApi.requestPasswordReset.mock.calls[0]?.[0].headers).toBeInstanceOf(Headers);
  });

  it("maps provider-disabled, rate-limit, and thrown failures to one generic error", async () => {
    const responses = [new Response(null, { status: 400 }), new Response(null, { status: 429 })];
    const outcomes: unknown[] = [];
    for (const response of responses) {
      authApi.requestPasswordReset.mockResolvedValueOnce(response);
      outcomes.push(
        await forgotPassword.action({
          request: formRequest({ email: "owner@example.com" }),
          context,
        } as never),
      );
    }
    authApi.requestPasswordReset.mockRejectedValueOnce(new Error("provider detail"));
    outcomes.push(
      await forgotPassword.action({
        request: formRequest({ email: "owner@example.com" }),
        context,
      } as never),
    );

    expect(outcomes).toEqual([
      { error: "We couldn’t start the password reset. Please try again later." },
      { error: "We couldn’t start the password reset. Please try again later." },
      { error: "We couldn’t start the password reset. Please try again later." },
    ]);
    expect(outcomes.join(" ")).not.toContain("provider detail");
  });
});

describe("reset-password route", () => {
  it("renders the same safe state for missing and callback-error tokens", async () => {
    await expect(
      resetPassword.loader({
        request: new Request("https://app.example.com/reset-password"),
        context,
      } as never),
    ).resolves.toEqual({ token: "", invalid: true });
    await expect(
      resetPassword.loader({
        request: new Request("https://app.example.com/reset-password?error=INVALID_TOKEN&token=secret"),
        context,
      } as never),
    ).resolves.toEqual({ token: "", invalid: true });
    await expect(
      resetPassword.loader({
        request: new Request("https://app.example.com/reset-password?token=token-123"),
        context,
      } as never),
    ).resolves.toEqual({ token: "token-123", invalid: false });
  });

  it("rejects local password mistakes without consuming a token", async () => {
    const result = await resetPassword.action({
      request: formRequest(
        { token: "token-123", newPassword: "new-correct-password", confirmPassword: "different" },
        "https://app.example.com/reset-password?token=token-123",
      ),
      context,
    } as never);

    expect(result).toEqual({ error: "The passwords do not match." });
    expect(authApi.resetPassword).not.toHaveBeenCalled();
  });

  it("rejects passwords outside the configured boundaries without consuming a token", async () => {
    const tooShort = await resetPassword.action({
      request: formRequest(
        { token: "token-123", newPassword: "short!!", confirmPassword: "short!!" },
        "https://app.example.com/reset-password?token=token-123",
      ),
      context,
    } as never);
    const tooLongPassword = "x".repeat(129);
    const tooLong = await resetPassword.action({
      request: formRequest(
        { token: "token-123", newPassword: tooLongPassword, confirmPassword: tooLongPassword },
        "https://app.example.com/reset-password?token=token-123",
      ),
      context,
    } as never);

    expect(tooShort).toEqual({ error: "Use a password between 8 and 128 characters." });
    expect(tooLong).toEqual({ error: "Use a password between 8 and 128 characters." });
    expect(authApi.resetPassword).not.toHaveBeenCalled();
  });

  it("maps invalid reset responses to one safe error and redirects successful resets to login", async () => {
    authApi.resetPassword.mockResolvedValueOnce(new Response(null, { status: 400 }));
    const invalid = await resetPassword.action({
      request: formRequest(
        { token: "token-123", newPassword: "new-correct-password", confirmPassword: "new-correct-password" },
        "https://app.example.com/reset-password?token=token-123",
      ),
      context,
    } as never);
    expect(invalid).toEqual({ error: "That reset link is invalid or expired. Request a new one." });

    authApi.resetPassword.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const redirectResponse = await thrownResponse(
      resetPassword.action({
        request: formRequest(
          { token: "token-123", newPassword: "new-correct-password", confirmPassword: "new-correct-password" },
          "https://app.example.com/reset-password?token=token-123",
        ),
        context,
      } as never),
    );
    expect(redirectResponse.status).toBe(302);
    expect(redirectResponse.headers.get("location")).toBe("/login?reset=success");
    expect(redirectResponse.headers.get("location")).not.toContain("token-123");
  });

  it("sets cache and referrer protections on the reset page", () => {
    const responseHeaders = resetPassword.headers({} as never);
    expect(responseHeaders).toEqual({
      "Cache-Control": "no-store, private",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
    });
  });
});

describe("login password-reset affordance", () => {
  it("links to forgot-password and displays only the fixed success message", () => {
    const defaultMarkup = JSON.stringify(
      login.default({ loaderData: { resetSuccess: false }, actionData: undefined } as never),
    );
    expect(defaultMarkup).toContain("/forgot-password");

    const successMarkup = JSON.stringify(
      login.default({ loaderData: { resetSuccess: true }, actionData: undefined } as never),
    );
    expect(successMarkup).toContain("Password reset successfully");

    const arbitraryMarkup = JSON.stringify(
      login.default({ loaderData: { resetSuccess: false }, actionData: undefined } as never),
    );
    expect(arbitraryMarkup).not.toContain("Password reset successfully");
  });
});
