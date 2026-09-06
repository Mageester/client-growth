import { beforeEach, describe, expect, it, vi } from "vitest";

const authApi = vi.hoisted(() => ({ signUpEmail: vi.fn() }));

vi.mock("../app/lib/auth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/lib/auth.server")>();
  return { ...actual, getAuth: vi.fn(() => ({ api: authApi })) };
});

import * as signup from "../app/routes/signup";

const context = {
  cloudflare: {
    env: {
      DB: {},
      BETTER_AUTH_SECRET: "x".repeat(40),
      BETTER_AUTH_URL: "https://app.example.com",
      // Delivery itself is covered by email.transport.test.ts; these suites
      // only need an environment that is capable of sending.
      EMAIL_TRANSPORT: "console",
      // Admission is covered by routes.signupAccess.test.ts; this suite is
      // about the invite return path surviving verification.
      SIGNUP_MODE: "open",
    },
  },
};

function request() {
  return new Request("https://app.example.com/signup?returnTo=%2Finvite%2Ftoken-123", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      email: "new@example.com",
      password: "correct-horse-battery",
      workspaceName: "Axiom Studio",
      returnTo: "/invite/token-123",
    }),
  });
}

async function thrownResponse(action: Promise<unknown>): Promise<Response> {
  try {
    await action;
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
  throw new Error("Expected a redirect response");
}

beforeEach(() => vi.clearAllMocks());

describe("signup invitation return path", () => {
  it("preserves the invite through verification and the subsequent login", async () => {
    authApi.signUpEmail.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await thrownResponse(
      signup.action({ request: request(), context } as never),
    );
    expect(response.headers.get("location")).toBe(
      "/login?verify=sent&returnTo=%2Finvite%2Ftoken-123",
    );
    expect(authApi.signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          email: "new@example.com",
          password: "correct-horse-battery",
          name: "Axiom Studio",
          callbackURL:
            "https://app.example.com/login?verified=success&returnTo=%2Finvite%2Ftoken-123",
        },
        asResponse: true,
      }),
    );
  });
});
