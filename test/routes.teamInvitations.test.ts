import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SCHEMA_SQL } from "@/db/schema";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { createWorkspaceInvitation } from "@/db/teamInvitations";
import { __setSessionResolver } from "../app/lib/session.server";
import { d1LikeOver } from "./helpers/testAuth";
import * as inviteRoute from "../app/routes/invite.$token";
import * as settings from "../app/routes/settings";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let raw: Database.Database;
let ctx: { cloudflare: { env: Record<string, unknown> } };

function formRequest(fields: Record<string, string>, url = "http://localhost/settings") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

function sqlDbOver(db: Database.Database) {
  const statement = (sql: string, bound: unknown[]) => ({
    bind: (...values: unknown[]) => statement(sql, values),
    all: async () => db.prepare(sql).all(...(bound as never[])),
    first: async () => db.prepare(sql).get(...(bound as never[])) ?? null,
    run: async () => ({ rowsAffected: db.prepare(sql).run(...(bound as never[])).changes }),
  });
  return {
    prepare: (sql: string) => statement(sql, []),
    exec: async (sql: string) => void db.exec(sql),
  };
}

async function call(fn: (args: unknown) => unknown, args: unknown): Promise<unknown> {
  try {
    return await fn(args);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
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

function addUser(id: string, email: string, name = id): void {
  const timestamp = "2026-09-04T12:00:00.000Z";
  raw
    .prepare(
      `INSERT INTO user (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .run(id, name, email, timestamp, timestamp);
}

function asUser(userId: string, email: string, emailVerified = true): void {
  __setSessionResolver(async () => ({
    userId,
    user: { id: userId, email, name: userId, emailVerified },
  }));
}

beforeEach(async () => {
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  raw.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  raw.exec(SCHEMA_SQL);
  addUser("owner", "owner@example.com", "Owner");
  addUser("member", "member@example.com", "Member");
  addUser("recipient", "recipient@example.com", "Recipient");
  await createWorkspaceForOwner(
    sqlDbOver(raw) as never,
    { id: "ws_a", name: "Axiom Studio", ownerUserId: "owner" },
  );
  raw
    .prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
    )
    .run("ws_a", "member", "member", "2026-09-04T12:00:00.000Z");
  ctx = {
    cloudflare: {
      env: {
        DB: d1LikeOver(raw),
        BETTER_AUTH_SECRET: "x".repeat(40),
        BETTER_AUTH_URL: "http://localhost:8787",
      },
    },
  };
});

afterEach(() => {
  __setSessionResolver(null);
  vi.unstubAllGlobals();
  raw.close();
});

describe("settings team management", () => {
  it("lets the owner create an invitation and exposes members and pending invites", async () => {
    asUser("owner", "owner@example.com");
    const created = (await settings.action({
      request: formRequest({ intent: "create-invitation", email: "New.Person@example.com", role: "member" }),
      context: ctx,
    } as never)) as {
      ok: boolean;
      invitationLink: string;
      invitedEmail: string;
      invitationEmailSent: boolean;
    };

    expect(created.ok).toBe(true);
    expect(created.invitedEmail).toBe("new.person@example.com");
    expect(created.invitationLink).toMatch(/^http:\/\/localhost:8787\/invite\/[0-9a-f]{64}$/);
    expect(created.invitationEmailSent).toBe(false);

    const loaded = (await settings.loader({ request: new Request("http://localhost/settings"), context: ctx } as never)) as {
      isOwner: boolean;
      members: Array<{ email: string; role: string }>;
      invitations: Array<{ invitedEmail: string; role: string }>;
    };
    expect(loaded.isOwner).toBe(true);
    expect(loaded.members.map((member) => `${member.email}:${member.role}`)).toEqual([
      "owner@example.com:owner",
      "member@example.com:member",
    ]);
    expect(loaded.invitations).toEqual([
      expect.objectContaining({ invitedEmail: "new.person@example.com", role: "member" }),
    ]);
  });

  it("keeps invitation creation and revocation owner-only", async () => {
    asUser("member", "member@example.com");
    expect(
      await settings.action({
        request: formRequest({ intent: "create-invitation", email: "other@example.com" }),
        context: ctx,
      } as never),
    ).toEqual({ error: "Only the workspace owner can manage invitations." });

    asUser("owner", "owner@example.com");
    const invitation = await createWorkspaceInvitation(sqlDbOver(raw) as never, {
      workspaceId: "ws_a",
      invitedEmail: "other@example.com",
      invitedByUserId: "owner",
    });
    const revoked = await settings.action({
      request: formRequest({ intent: "revoke-invitation", invitationId: invitation.id }),
      context: ctx,
    } as never);
    expect(revoked).toEqual({ ok: true, invitationRevoked: true });

    asUser("member", "member@example.com");
    expect(
      await settings.action({
        request: formRequest({ intent: "revoke-invitation", invitationId: invitation.id }),
        context: ctx,
      } as never),
    ).toEqual({ error: "Only the workspace owner can manage invitations." });
  });

  it("uses the configured Resend transport without sending in tests unless configured", async () => {
    const outbound = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", outbound);
    ctx.cloudflare.env.RESEND_API_KEY = "test-key";
    ctx.cloudflare.env.RESEND_FROM_EMAIL = "Axiom Orbit <auth@example.com>";
    asUser("owner", "owner@example.com");

    const result = (await settings.action({
      request: formRequest({ intent: "create-invitation", email: "mail@example.com" }),
      context: ctx,
    } as never)) as { ok: boolean; invitationEmailSent: boolean };
    expect(result).toEqual(expect.objectContaining({ ok: true, invitationEmailSent: true }));
    expect(outbound).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("team invitation acceptance route", () => {
  it("prevents invitation tokens from being cached or sent as referrers", () => {
    expect(inviteRoute.headers({})).toEqual({
      "Cache-Control": "no-store, private",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
    });
  });

  it("requires a signed-in verified matching recipient and accepts once", async () => {
    const invitation = await createWorkspaceInvitation(sqlDbOver(raw) as never, {
      id: "inv_route",
      workspaceId: "ws_a",
      invitedEmail: "recipient@example.com",
      invitedByUserId: "owner",
    });

    asUser("recipient", "recipient@example.com", false);
    const unverified = await inviteRoute.action({
      request: new Request("http://localhost/invite/" + invitation.token, { method: "POST" }),
      context: ctx as never,
      params: { token: invitation.token },
    } as never);
    expect(unverified).toEqual({ error: "Verify your email before accepting this invitation." });

    asUser("recipient", "other@example.com", true);
    const mismatch = await inviteRoute.action({
      request: new Request("http://localhost/invite/" + invitation.token, { method: "POST" }),
      context: ctx as never,
      params: { token: invitation.token },
    } as never);
    expect(mismatch).toEqual({ error: "This invitation was sent to a different email address." });

    asUser("recipient", "recipient@example.com", true);
    const accepted = await thrownResponse(
      inviteRoute.action({
        request: new Request("http://localhost/invite/" + invitation.token, { method: "POST" }),
        context: ctx as never,
        params: { token: invitation.token },
      } as never),
    );
    expect(accepted.status).toBe(302);
    expect(accepted.headers.get("location")).toBe("/");

    const replay = await inviteRoute.action({
      request: new Request("http://localhost/invite/" + invitation.token, { method: "POST" }),
      context: ctx as never,
      params: { token: invitation.token },
    } as never);
    expect(replay).toEqual({ error: "This invitation has already been accepted." });
  });

  it("redirects an anonymous visitor back to the invitation after login", async () => {
    const invitation = await createWorkspaceInvitation(sqlDbOver(raw) as never, {
      workspaceId: "ws_a",
      invitedEmail: "recipient@example.com",
      invitedByUserId: "owner",
    });
    __setSessionResolver(async () => null);

    const response = await call(inviteRoute.action as never, {
      request: new Request("http://localhost/invite/" + invitation.token, { method: "POST" }),
      context: ctx,
      params: { token: invitation.token },
    });
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("location")).toBe(
      `/login?returnTo=%2Finvite%2F${invitation.token}`,
    );
  });
});
