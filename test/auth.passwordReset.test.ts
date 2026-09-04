import { describe, expect, it } from "vitest";

import type { PasswordResetSender } from "../app/lib/resend.server";
import { headers, makeTestAuth, signUp, signUpVerified } from "./helpers/testAuth";

const RESET_MESSAGE = "If this email exists in our system, check your email for the reset link";

function captureResetLinks() {
  const links: { url: string; token: string }[] = [];
  const sender: PasswordResetSender = async ({ url, token }) => {
    links.push({ url, token });
  };
  return { links, sender };
}

describe("Better Auth password reset", () => {
  it("uses the same request response for known and unknown emails", async () => {
    const { links, sender } = captureResetLinks();
    const { auth } = makeTestAuth({ sendResetPassword: sender });
    await signUp(auth, "known@example.com", "old-correct-password");

    const known = await auth.api.requestPasswordReset({
      body: {
        email: "known@example.com",
        redirectTo: "http://localhost:8787/reset-password",
      },
      asResponse: true,
    });
    const unknown = await auth.api.requestPasswordReset({
      body: {
        email: "unknown@example.com",
        redirectTo: "http://localhost:8787/reset-password",
      },
      asResponse: true,
    });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual({ status: true, message: RESET_MESSAGE });
    expect(await unknown.json()).toEqual({ status: true, message: RESET_MESSAGE });
    expect(links).toHaveLength(1);
    expect(new URL(links[0]!.url).searchParams.get("callbackURL")).toBe(
      "http://localhost:8787/reset-password",
    );
  });

  it("does not expose a known-account delivery failure differently", async () => {
    const backgroundTasks: Promise<unknown>[] = [];
    const sender: PasswordResetSender = async () => {
      throw new Error("Password reset email delivery failed");
    };
    const { auth } = makeTestAuth({
      sendResetPassword: sender,
      backgroundTaskHandler: (promise) => backgroundTasks.push(promise),
    });
    await signUp(auth, "known@example.com", "old-correct-password");

    const known = await auth.api.requestPasswordReset({
      body: { email: "known@example.com", redirectTo: "http://localhost:8787/reset-password" },
      asResponse: true,
    });
    const unknown = await auth.api.requestPasswordReset({
      body: { email: "unknown@example.com", redirectTo: "http://localhost:8787/reset-password" },
      asResponse: true,
    });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    expect(backgroundTasks).toHaveLength(1);
    await Promise.all(backgroundTasks);
  });

  it("resets the password once, invalidates every old session, and rejects the old password", async () => {
    const { links, sender } = captureResetLinks();
    const { auth, raw } = makeTestAuth({ sendResetPassword: sender });
    const first = await signUpVerified(auth, raw, "owner@example.com", "old-correct-password");
    const secondSignIn = await auth.api.signInEmail({
      body: { email: "owner@example.com", password: "old-correct-password" },
      asResponse: true,
    });
    const secondCookie = secondSignIn.headers.get("set-cookie") ?? "";
    expect(secondCookie).not.toBe("");

    await auth.api.requestPasswordReset({
      body: {
        email: "owner@example.com",
        redirectTo: "http://localhost:8787/reset-password",
      },
    });
    const token = links[0]!.token;

    const reset = await auth.api.resetPassword({
      body: { newPassword: "new-correct-password", token },
      asResponse: true,
    });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({ status: true });
    expect(await auth.api.getSession({ headers: headers(first.cookie) })).toBeNull();
    expect(await auth.api.getSession({ headers: headers(secondCookie) })).toBeNull();

    await expect(
      auth.api.signInEmail({
        body: { email: "owner@example.com", password: "old-correct-password" },
      }),
    ).rejects.toBeDefined();
    const newSignIn = await auth.api.signInEmail({
      body: { email: "owner@example.com", password: "new-correct-password" },
      asResponse: true,
    });
    expect(newSignIn.status).toBe(200);

    await expect(
      auth.api.resetPassword({
        body: { newPassword: "another-correct-password", token },
      }),
    ).rejects.toBeDefined();
  });

  it("rejects an expired token without changing the password", async () => {
    const { links, sender } = captureResetLinks();
    const { auth, raw } = makeTestAuth({
      sendResetPassword: sender,
      resetPasswordTokenExpiresIn: -1,
    });
    await signUpVerified(auth, raw, "expired@example.com", "old-correct-password");

    await auth.api.requestPasswordReset({
      body: {
        email: "expired@example.com",
        redirectTo: "http://localhost:8787/reset-password",
      },
    });

    await expect(
      auth.api.resetPassword({
        body: { newPassword: "new-correct-password", token: links[0]!.token },
      }),
    ).rejects.toBeDefined();
    await expect(
      auth.api.signInEmail({
        body: { email: "expired@example.com", password: "old-correct-password" },
      }),
    ).resolves.toBeDefined();
  });

  it("rejects malformed tokens and password values safely", async () => {
    const { auth } = makeTestAuth({
      sendResetPassword: captureResetLinks().sender,
    });

    await expect(
      auth.api.resetPassword({
        body: { newPassword: "new-correct-password", token: "not-a-real-token" },
      }),
    ).rejects.toBeDefined();
    await expect(
      auth.api.resetPassword({
        body: { newPassword: "short", token: "" },
      }),
    ).rejects.toBeDefined();
  });
});
