import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authApi = vi.hoisted(() => ({ signUpEmail: vi.fn() }));

vi.mock("../app/lib/auth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/lib/auth.server")>();
  return { ...actual, getAuth: vi.fn(() => ({ api: authApi })) };
});

import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import * as repo from "@/db/repositories";
import { createWorkspaceInvitation, revokeWorkspaceInvitation } from "@/db/teamInvitations";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { __setSessionResolver } from "../app/lib/session.server";
import * as signup from "../app/routes/signup";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let db: NodeSqliteDb;

const NOW = new Date("2026-09-06T12:00:00.000Z");

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

function signupRequest(email: string) {
  return new Request("https://app.example.com/signup", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      email,
      password: "correct-horse-battery",
      workspaceName: "Axiom Studio",
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

async function run(email: string, env: Record<string, unknown>): Promise<unknown> {
  try {
    return await signup.action({
      request: signupRequest(email),
      context: contextFor(env),
    } as never);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
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

  it("tells the signup page which door it is showing", async () => {
    const closed = (await signup.loader({
      request: new Request("https://app.example.com/signup"),
      context: contextFor({}),
    } as never)) as { publicSignup: boolean };
    expect(closed.publicSignup).toBe(false);

    const open = (await signup.loader({
      request: new Request("https://app.example.com/signup"),
      context: contextFor({ SIGNUP_MODE: "open" }),
    } as never)) as { publicSignup: boolean };
    expect(open.publicSignup).toBe(true);
  });
});
