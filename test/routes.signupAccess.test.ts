import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

const authApi = vi.hoisted(() => ({ signUpEmail: vi.fn() }));

vi.mock("../app/lib/auth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/lib/auth.server")>();
  return { ...actual, getAuth: vi.fn(() => ({ api: authApi })) };
});

import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import * as repo from "@/db/repositories";
import {
  acceptWorkspaceInvitation,
  createWorkspaceInvitation,
  revokeWorkspaceInvitation,
} from "@/db/teamInvitations";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { __setSessionResolver } from "../app/lib/session.server";
import { loader as rootLoader, publicSignupCtaLabel } from "../app/root";
import * as signup from "../app/routes/signup";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let db: NodeSqliteDb;

const NOW = new Date("2026-09-06T12:00:00.000Z");
const FAR_FUTURE = new Date("2099-01-01T00:00:00.000Z");

function contextFor(env: Record<string, unknown>) {
  return {
    cloudflare: {
      env: {
        DB: db,
        BETTER_AUTH_SECRET: "x".repeat(40),
        BETTER_AUTH_URL: "https://app.example.com",
        // Delivery itself is covered by email.transport.test.ts; these suites
        // only need an environment that is capable of sending.
        EMAIL_TRANSPORT: "console",
        ...env,
      },
    },
  };
}

function signupRequest(email: string, fields: Record<string, string> = {}) {
  return new Request("https://app.example.com/signup", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      email,
      password: "correct-horse-battery",
      workspaceName: "Axiom Studio",
      ...fields,
    }),
  });
}

function acceptedSignup() {
  authApi.signUpEmail.mockResolvedValueOnce(
    new Response(JSON.stringify({ token: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

async function run(
  email: string,
  env: Record<string, unknown>,
  fields: Record<string, string> = {},
): Promise<unknown> {
  try {
    return await signup.action({
      request: signupRequest(email, fields),
      context: contextFor(env),
    } as never);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

async function checkPilotAccess(email: string, env: Record<string, unknown>): Promise<unknown> {
  return signup.action({
    request: signupRequest(email, { intent: "check-access", password: "", workspaceName: "" }),
    context: contextFor(env),
  } as never);
}

function renderSignup(loaderData: {
  returnTo?: string;
  publicSignup: boolean;
  invitationSignup?: boolean;
  allowlistSignup?: boolean;
}, actionData?: unknown) {
  return renderToStaticMarkup(
    createElement(
      RouterProvider,
      {
        router: createMemoryRouter(
          [{ path: "/signup", element: createElement(signup.default, { loaderData, actionData } as never) }],
          { initialEntries: ["/signup"] },
        ),
      },
    ),
  );
}

async function loadSignup(returnTo: string | undefined, env: Record<string, unknown>) {
  const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
  return (await signup.loader({
    request: new Request(`https://app.example.com/signup${query}`),
    context: contextFor(env),
  } as never)) as {
    returnTo?: string;
    publicSignup: boolean;
    invitationSignup?: boolean;
    allowlistSignup?: boolean;
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = nodeSqliteDb(":memory:");
  // Invitations reference the Better Auth user table, so the auth migration is
  // part of the fixture rather than only the domain schema.
  await db.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  await repo.applySchema(db);
  db.raw
    .prepare(
      `INSERT INTO user (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .run("u_a", "Owner", "owner@agency.example", NOW.toISOString(), NOW.toISOString());
  await createWorkspaceForOwner(db, { id: "ws_a", name: "A", ownerUserId: "u_a" });
  // Nobody is signed in on the signup page; the real resolver would need a full
  // auth instance, which this suite deliberately mocks away.
  __setSessionResolver(async () => null);
});

afterEach(() => {
  __setSessionResolver(null);
  db.close();
});

describe("signup admission at the route", () => {
  it("never reaches the auth provider when the gate is shut", async () => {
    const result = (await run("stranger@example.com", {})) as { error?: string };

    expect(result.error).toMatch(/invitation/i);
    // The point of the gate is that no account, and therefore no workspace and
    // no analysis allowance, is created at all.
    expect(authApi.signUpEmail).not.toHaveBeenCalled();
  });

  it("lets an allowlisted address through", async () => {
    acceptedSignup();
    const response = (await run("owner@agency.example", {
      SIGNUP_ALLOWLIST: "@agency.example",
    })) as Response;

    expect(response.status).toBe(302);
    expect(authApi.signUpEmail).toHaveBeenCalledTimes(1);
  });

  it("lets a colleague with a live invitation through, and only them", async () => {
    await createWorkspaceInvitation(db, {
      workspaceId: "ws_a",
      invitedEmail: "colleague@agency.example",
      invitedByUserId: "u_a",
      now: NOW,
      expiresAt: FAR_FUTURE,
    });

    acceptedSignup();
    const invited = (await run("colleague@agency.example", {})) as Response;
    expect(invited.status).toBe(302);

    const uninvited = (await run("nobody@agency.example", {})) as { error?: string };
    expect(uninvited.error).toMatch(/invitation/i);
    expect(authApi.signUpEmail).toHaveBeenCalledTimes(1);
  });

  it("stops honouring an invitation once it is revoked", async () => {
    const invitation = await createWorkspaceInvitation(db, {
      workspaceId: "ws_a",
      invitedEmail: "colleague@agency.example",
      invitedByUserId: "u_a",
      now: NOW,
      expiresAt: FAR_FUTURE,
    });
    await revokeWorkspaceInvitation(db, "ws_a", invitation.id);

    const result = (await run("colleague@agency.example", {})) as { error?: string };
    expect(result.error).toMatch(/invitation/i);
    expect(authApi.signUpEmail).not.toHaveBeenCalled();
  });

  it("opens to everyone only when the environment says open", async () => {
    acceptedSignup();
    const response = (await run("stranger@example.com", { SIGNUP_MODE: "open" })) as Response;
    expect(response.status).toBe(302);
    expect(authApi.signUpEmail).toHaveBeenCalledTimes(1);
  });

  it("names the closed signup page as pilot access while preserving the creation title", () => {
    expect(signup.meta({
      data: { publicSignup: false, invitationSignup: false, allowlistSignup: false },
    } as never)).toEqual([{ title: "Request pilot access · Axiom Orbit" }]);
    expect(signup.meta({
      data: { publicSignup: true, invitationSignup: false, allowlistSignup: false },
    } as never)).toEqual([{ title: "Create account · Axiom Orbit" }]);
  });

  it("tells the signup page which door it is showing", async () => {
    const closed = await loadSignup(undefined, {});
    expect(closed.publicSignup).toBe(false);

    const open = await loadSignup(undefined, { SIGNUP_MODE: "open" });
    expect(open.publicSignup).toBe(true);
  });

  it("does not treat an arbitrary invite return path as account access", async () => {
    const loaderData = await loadSignup("/invite/fake", {});

    expect(loaderData.invitationSignup).toBe(false);
    const html = renderSignup(loaderData);
    expect(html).not.toContain('name="workspaceName"');
    expect(html).not.toContain("Create account");
  });

  it("keeps a live invitation return path on the account form", async () => {
    const invitation = await createWorkspaceInvitation(db, {
      workspaceId: "ws_a",
      invitedEmail: "colleague@agency.example",
      invitedByUserId: "u_a",
      now: NOW,
      expiresAt: FAR_FUTURE,
    });
    const loaderData = await loadSignup(`/invite/${invitation.token}`, {});

    expect(loaderData.invitationSignup).toBe(true);
    const html = renderSignup(loaderData);
    expect(html).toContain(`name="returnTo" value="/invite/${invitation.token}"`);
    expect(html).toContain('name="workspaceName"');
    expect(html).toContain("Create account");
  });

  it("keeps the account form reachable for configured allowlist access", async () => {
    const loaderData = await loadSignup(undefined, {
      SIGNUP_ALLOWLIST: "owner@agency.example",
    });

    expect(loaderData.publicSignup).toBe(false);
    expect(loaderData.allowlistSignup).toBe(true);
    const html = renderSignup(loaderData);
    expect(html).toContain("Check pilot access");
    expect(html).not.toContain('name="workspaceName"');
    expect(html).not.toContain("Create account");
  });

  it("approves an allowlisted email without creating an account", async () => {
    const result = (await checkPilotAccess("owner@agency.example", {
      SIGNUP_ALLOWLIST: "owner@agency.example",
    })) as { accessChecked?: boolean; accessEmail?: string; error?: string };

    expect(result).toEqual({
      accessChecked: true,
      accessEmail: "owner@agency.example",
      returnTo: undefined,
    });
    expect(authApi.signUpEmail).not.toHaveBeenCalled();
  });

  it("rejects an unallowlisted email at the pilot access check", async () => {
    const result = (await checkPilotAccess("stranger@example.com", {
      SIGNUP_ALLOWLIST: "owner@agency.example",
    })) as { accessError?: string; accessChecked?: boolean };

    expect(result.accessError).toMatch(/not on the current pilot allowlist/i);
    expect(result.accessChecked).not.toBe(true);
    expect(authApi.signUpEmail).not.toHaveBeenCalled();
  });

  it("does not disclose a pending invitation during the pilot access check", async () => {
    await createWorkspaceInvitation(db, {
      workspaceId: "ws_a",
      invitedEmail: "invited@agency.example",
      invitedByUserId: "u_a",
      now: NOW,
      expiresAt: FAR_FUTURE,
    });

    const env = { SIGNUP_ALLOWLIST: "owner@agency.example" };
    const ordinary = await checkPilotAccess("stranger@example.com", env);
    const invited = await checkPilotAccess("invited@agency.example", env);

    expect(invited).toEqual(ordinary);
    expect(invited).toEqual({
      accessError: expect.stringMatching(/not on the current pilot allowlist/i),
      returnTo: undefined,
    });
    const loaderData = await loadSignup(undefined, env);
    const html = renderSignup(loaderData, invited);
    expect(html).toContain("Check pilot access");
    expect(html).not.toContain('name="workspaceName"');
    expect(html).not.toContain("Create account");
    expect(authApi.signUpEmail).not.toHaveBeenCalled();
  });

  it("keeps the closed explanation for a rejected check and reveals the form only after approval", async () => {
    const loaderData = await loadSignup(undefined, {
      SIGNUP_ALLOWLIST: "owner@agency.example",
    });
    const rejectedHtml = renderSignup(loaderData, {
      accessError: "That email is not on the current pilot allowlist.",
      returnTo: undefined,
    });
    expect(rejectedHtml).toContain("That email is not on the current pilot allowlist.");
    expect(rejectedHtml).toContain("Check pilot access");
    expect(rejectedHtml).not.toContain('name="workspaceName"');

    const approvedHtml = renderSignup(loaderData, {
      accessChecked: true,
      accessEmail: "owner@agency.example",
      returnTo: undefined,
    });
    expect(approvedHtml).toContain('name="workspaceName"');
    expect(approvedHtml).toContain("Create account");
    expect(approvedHtml).toContain('value="owner@agency.example"');
    expect(approvedHtml).not.toContain("Check pilot access");
  });

  it("still enforces the allowlist on a direct final signup POST", async () => {
    const result = (await run("stranger@example.com", {
      SIGNUP_ALLOWLIST: "owner@agency.example",
    })) as { error?: string };

    expect(result.error).toMatch(/not open for public sign-up|invitation|allowlist/i);
    expect(authApi.signUpEmail).not.toHaveBeenCalled();
  });

  it("does not preserve account-form access on a partial invited-email final POST", async () => {
    await createWorkspaceInvitation(db, {
      workspaceId: "ws_a",
      invitedEmail: "invited@agency.example",
      invitedByUserId: "u_a",
      now: NOW,
      expiresAt: FAR_FUTURE,
    });

    const env = { SIGNUP_ALLOWLIST: "owner@agency.example" };
    const fields = { password: "", workspaceName: "" };
    const outsider = await run("stranger@example.com", env, fields);
    const invited = await run("invited@agency.example", env, fields);

    expect(invited).toEqual(outsider);
    expect(invited).toEqual({ error: "Fill in every field." });
    expect(invited).not.toHaveProperty("accessChecked");
    expect(invited).not.toHaveProperty("accessEmail");

    const loaderData = await loadSignup(undefined, env);
    const html = renderSignup(loaderData, invited);
    expect(html).not.toContain('name="workspaceName"');
    expect(html).not.toContain("Create account");
    expect(authApi.signUpEmail).not.toHaveBeenCalled();
  });

  it("does not expose expired, revoked, or accepted invitation return paths", async () => {
    const expired = await createWorkspaceInvitation(db, {
      workspaceId: "ws_a",
      invitedEmail: "expired@agency.example",
      invitedByUserId: "u_a",
      now: NOW,
      expiresAt: new Date(NOW.getTime() - 1),
    });
    expect((await loadSignup(`/invite/${expired.token}`, {})).invitationSignup).toBe(false);

    const revoked = await createWorkspaceInvitation(db, {
      workspaceId: "ws_a",
      invitedEmail: "revoked@agency.example",
      invitedByUserId: "u_a",
      now: NOW,
    });
    await revokeWorkspaceInvitation(db, "ws_a", revoked.id);
    expect((await loadSignup(`/invite/${revoked.token}`, {})).invitationSignup).toBe(false);

    db.raw
      .prepare(
        `INSERT INTO user (id, name, email, "emailVerified", "createdAt", "updatedAt")
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .run("u_b", "Colleague", "accepted@agency.example", NOW.toISOString(), NOW.toISOString());
    const accepted = await createWorkspaceInvitation(db, {
      workspaceId: "ws_a",
      invitedEmail: "accepted@agency.example",
      invitedByUserId: "u_a",
      now: NOW,
    });
    const acceptedResult = await acceptWorkspaceInvitation(db, {
      token: accepted.token,
      userId: "u_b",
      email: "accepted@agency.example",
      emailVerified: true,
      now: NOW,
    });
    expect(acceptedResult.ok).toBe(true);
    expect((await loadSignup(`/invite/${accepted.token}`, {})).invitationSignup).toBe(false);
  });

  it("does not offer self-serve account creation from the shared public topbar", async () => {
    __setSessionResolver(async () => null);
    try {
      const closed = (await rootLoader({
        request: new Request("https://app.example.com/signup"),
        context: contextFor({}),
      } as never)) as { publicSignup: boolean };
      expect(closed.publicSignup).toBe(false);

      const open = (await rootLoader({
        request: new Request("https://app.example.com/signup"),
        context: contextFor({ SIGNUP_MODE: "open" }),
      } as never)) as { publicSignup: boolean };
      expect(open.publicSignup).toBe(true);
    } finally {
      __setSessionResolver(null);
    }

    expect(publicSignupCtaLabel(false)).toBe("Request pilot access");
    expect(publicSignupCtaLabel(true)).toBe("Create account");

    const root = readFileSync(new URL("../app/root.tsx", import.meta.url), "utf8");
    const topbar = root.slice(root.indexOf("public-nav"), root.indexOf("public-nav") + 400);
    expect(topbar).toContain("publicSignupCtaLabel(publicSignup)");
    expect(topbar).not.toContain('"Create account"');
  });

  it("explains pilot access instead of presenting self-serve signup when the door is closed", () => {
    const html = renderSignup({ publicSignup: false });

    expect(html).toContain("Request pilot access");
    expect(html).toMatch(/invitation-only|pilot access/i);
    expect(html).not.toContain('name="workspaceName"');
    expect(html).not.toContain("Create account");
  });

});

/**
 * A closed door with no bell is not a pilot; it is a dead end.
 *
 * The audit walked the advertised path — home, "Request pilot access", signup —
 * and arrived at a page whose only action was "Already invited? Log in". A
 * visitor who is not invited, which is the entire audience of that CTA, had no
 * way to ask. So the closed page now carries one real action: a mailto that
 * Axiom controls, prefilled with the four things a reply needs.
 *
 * Deliberately not built: a lead form. A public write endpoint means a lead
 * table, a spam surface, and a rate limiter, to replace an email we would read
 * by hand either way. Invitation-only admission is unchanged.
 */
describe("the closed signup page can actually be acted on", () => {
  const pilotLink = (html: string): URL => {
    const match = html.match(/href="(mailto:[^"]+)"/);
    expect(match, "the closed signup page renders a mailto pilot action").not.toBeNull();
    // React escapes & in attributes; the URL parser needs it back.
    return new URL(match![1]!.replace(/&amp;/g, "&"));
  };

  it("offers a prefilled pilot request to an address Axiom controls", () => {
    const html = renderSignup({ publicSignup: false });
    const url = pilotLink(html);

    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe("hello@getaxiom.ca");
    expect(url.searchParams.get("subject")).toBe("Axiom Orbit agency pilot request");
    const body = url.searchParams.get("body") ?? "";
    expect(body).toContain("Agency name:");
    expect(body).toContain("Client sites managed:");
    expect(body).toContain("Current client-review process:");
    expect(body).toContain("What you want the review to help with:");
  });

  it("states the offer, the audience, and when a reply arrives", () => {
    const html = renderSignup({ publicSignup: false });

    expect(html).toContain("14-day assisted review");
    expect(html).toContain("up to ten client sites");
    expect(html).toContain("within two business days");
    // No price is published until Axiom knows the human effort fits one.
    expect(html).not.toMatch(/\$\d/);
  });

  it("leaves invitation-only admission and the account form exactly as they were", () => {
    const closed = renderSignup({ publicSignup: false });
    expect(closed).not.toContain('name="workspaceName"');
    expect(closed).toContain("Already invited? Log in");

    // An open or invited door is a different page, and gains no mail action.
    const open = renderSignup({ publicSignup: true });
    expect(open).toContain('name="workspaceName"');
    expect(open).not.toContain("mailto:hello@getaxiom.ca");
  });
});
