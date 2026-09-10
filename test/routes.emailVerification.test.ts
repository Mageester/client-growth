import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authApi = vi.hoisted(() => ({
  sendVerificationEmail: vi.fn(),
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
}));

vi.mock("../app/lib/auth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/lib/auth.server")>();
  return {
    ...actual,
    getAuth: vi.fn(() => ({ api: authApi })),
  };
});

import * as login from "../app/routes/login";
import * as signup from "../app/routes/signup";
import { verificationEmailFromRequest } from "../app/lib/verification-email.server";

const env = {
  DB: {},
  BETTER_AUTH_SECRET: "x".repeat(40),
  BETTER_AUTH_URL: "https://app.example.com",
  // Delivery itself is covered by email.transport.test.ts; these suites
  // only need an environment that is capable of sending.
  EMAIL_TRANSPORT: "console",
  // Admission is covered by routes.signupAccess.test.ts.
  SIGNUP_MODE: "open",
};
const context = { cloudflare: { env } };

function formRequest(fields: Record<string, string>, url = "https://app.example.com/login") {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": "203.0.113.10",
    },
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

describe("email verification auth routes", () => {
  it("reads the short-lived recipient cookie and rejects malformed values", () => {
    expect(
      verificationEmailFromRequest(
        new Request("https://app.example.com/login?verify=sent", {
          headers: { cookie: "axiom_verify_email=owner%40example.com" },
        }),
      ),
    ).toBe("owner@example.com");
    expect(
      verificationEmailFromRequest(
        new Request("https://app.example.com/login", {
          headers: { cookie: "axiom_verify_email=not-an-email" },
        }),
      ),
    ).toBe("");
  });

  it("offers a safe resend after an existing unverified user is blocked", async () => {
    authApi.signInEmail.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "EMAIL_NOT_VERIFIED" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );

    const blocked = await login.action({
      request: formRequest({ email: "owner@example.com", password: "correct-horse-battery" }),
      context,
    } as never);

    expect(blocked).toEqual({
      error: "Verify your email before logging in.",
      verificationRequired: true,
      email: "owner@example.com",
    });
    expect(authApi.signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          email: "owner@example.com",
          password: "correct-horse-battery",
          callbackURL: "https://app.example.com/login?verified=success",
        },
        asResponse: true,
      }),
    );

    authApi.sendVerificationEmail.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const resent = await login.action({
      request: formRequest({ intent: "resend-verification", email: "owner@example.com" }),
      context,
    } as never);

    expect(resent).toEqual({ verificationSent: true, email: "owner@example.com" });
    expect(authApi.sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          email: "owner@example.com",
          callbackURL: "https://app.example.com/login?verified=success",
        },
        asResponse: true,
      }),
    );
  });

  it("defers workspace creation until a new account verifies its email", async () => {
    authApi.signUpEmail.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: null, user: { id: "user-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await thrownResponse(
      signup.action({
        request: formRequest(
          {
            email: "owner@example.com",
            password: "correct-horse-battery",
            workspaceName: "Axiom Studio",
          },
          "https://app.example.com/signup",
        ),
        context,
      } as never),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login?verify=sent");
    expect(response.headers.get("set-cookie")).toMatch(
      /^axiom_verify_email=owner%40example\.com; Path=\/login; Max-Age=600; HttpOnly; SameSite=Lax; Secure$/,
    );
    expect(authApi.signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          email: "owner@example.com",
          password: "correct-horse-battery",
          name: "Axiom Studio",
          callbackURL: "https://app.example.com/login?verified=success",
        },
        asResponse: true,
      }),
    );
  });

  it("renders a useful resend action for an unverified sign-in", () => {
    const markup = renderToStaticMarkup(
      createElement(
        RouterProvider,
        {
          router: createMemoryRouter([
            {
              path: "/login",
              element: createElement(login.default, {
                loaderData: {
                  resetSuccess: false,
                  verificationSent: false,
                  verificationSuccess: false,
                },
                actionData: {
                  error: "Verify your email before logging in.",
                  verificationRequired: true,
                  email: "owner@example.com",
                },
              } as never),
            },
          ], { initialEntries: ["/login"] }),
        },
      ),
    );

    expect(markup).toContain("Verify your email before logging in.");
    expect(markup).toContain("Resend verification email");
    expect(markup).toContain('name="intent"');
    expect(markup).toContain('value="resend-verification"');
    expect(markup).toContain('value="owner@example.com"');
  });

  it("preserves the attempted address after a wrong password", async () => {
    authApi.signInEmail.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const result = await login.action({
      request: formRequest({ email: "owner@example.com", password: "wrong-password" }),
      context,
    } as never);
    expect(result).toEqual({ error: "Incorrect email or password.", email: "owner@example.com" });
  });

  it("shows the verification recipient and a resend path after signup", () => {
    const markup = renderToStaticMarkup(
      createElement(
        RouterProvider,
        {
          router: createMemoryRouter([{
            path: "/login",
            element: createElement(login.default, {
              loaderData: {
                resetSuccess: false,
                verificationSent: true,
                verificationSuccess: false,
                verificationEmail: "owner@example.com",
              },
            } as never),
          }], { initialEntries: ["/login"] }),
        },
      ),
    );
    expect(markup).toContain("Check your email");
    expect(markup).toContain("owner@example.com");
    expect(markup).toContain("Resend verification email");
  });
});
