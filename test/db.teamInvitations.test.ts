import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWorkspaceForOwner } from "@/db/workspaces";
import {
  acceptWorkspaceInvitation,
  createWorkspaceInvitation,
  getWorkspaceInvitationByToken,
  listPendingWorkspaceInvitations,
  listWorkspaceMembers,
  revokeWorkspaceInvitation,
} from "@/db/teamInvitations";
import { nodeSqliteDb, type NodeSqliteDb } from "@/db/nodeSqlite";
import { SCHEMA_SQL } from "@/db/schema";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let db: NodeSqliteDb;
const now = new Date("2026-09-04T12:00:00.000Z");

function addUser(id: string, email: string, name = id): void {
  db.raw
    .prepare(
      `INSERT INTO user (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .run(id, name, email, now.toISOString(), now.toISOString());
}

beforeEach(async () => {
  db = nodeSqliteDb(":memory:");
  await db.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  await db.exec(SCHEMA_SQL);
  addUser("owner", "owner@example.com", "Owner");
  addUser("owner-b", "owner-b@example.com", "Owner B");
  addUser("member", "member@example.com", "Member");
  await createWorkspaceForOwner(db, { id: "ws_a", name: "Axiom Studio", ownerUserId: "owner" });
  await createWorkspaceForOwner(db, { id: "ws_b", name: "Second Studio", ownerUserId: "owner-b" });
});

afterEach(() => db.close());

describe("workspace team invitations", () => {
  it("normalizes recipient addresses, stores only a token digest, and lists pending invites", async () => {
    const invite = await createWorkspaceInvitation(db, {
      id: "inv_1",
      workspaceId: "ws_a",
      invitedEmail: "  New.Person@Example.com ",
      invitedByUserId: "owner",
      now,
    });

    expect(invite.invitedEmail).toBe("new.person@example.com");
    expect(invite.role).toBe("member");
    expect(invite.token).toMatch(/^[0-9a-f]{64}$/);
    expect(invite.expiresAt).toBe("2026-09-11T12:00:00.000Z");
    const stored = db
      .raw
      .prepare("SELECT token_hash, invited_email FROM workspace_invitations WHERE id = ?")
      .get("inv_1") as { token_hash: string; invited_email: string };
    expect(stored.invited_email).toBe("new.person@example.com");
    expect(stored.token_hash).not.toBe(invite.token);
    expect(stored.token_hash).toHaveLength(64);
    expect(await listPendingWorkspaceInvitations(db, "ws_a", now)).toHaveLength(1);
    expect((await getWorkspaceInvitationByToken(db, invite.token))?.id).toBe("inv_1");
  });

  it("rejects invalid recipients, existing members, and duplicate active invites", async () => {
    await expect(
      createWorkspaceInvitation(db, {
        workspaceId: "ws_a",
        invitedEmail: "not-an-email",
        invitedByUserId: "owner",
        now,
      }),
    ).rejects.toMatchObject({ code: "invalid_email" });

    await expect(
      createWorkspaceInvitation(db, {
        workspaceId: "ws_a",
        invitedEmail: "owner@example.com",
        invitedByUserId: "owner",
        now,
      }),
    ).rejects.toMatchObject({ code: "already_member" });

    await createWorkspaceInvitation(db, {
      id: "inv_duplicate",
      workspaceId: "ws_a",
      invitedEmail: "new@example.com",
      invitedByUserId: "owner",
      now,
    });
    await expect(
      createWorkspaceInvitation(db, {
        workspaceId: "ws_a",
        invitedEmail: "NEW@example.com",
        invitedByUserId: "owner",
        now,
      }),
    ).rejects.toMatchObject({ code: "already_pending" });
  });

  it("requires a verified matching recipient and consumes an invitation once", async () => {
    const invite = await createWorkspaceInvitation(db, {
      id: "inv_accept",
      workspaceId: "ws_a",
      invitedEmail: "new@example.com",
      invitedByUserId: "owner",
      now,
    });

    expect(
      await acceptWorkspaceInvitation(db, {
        token: invite.token,
        userId: "new-user",
        email: "new@example.com",
        emailVerified: false,
        now,
      }),
    ).toEqual({ ok: false, reason: "email_unverified" });
    expect(
      await acceptWorkspaceInvitation(db, {
        token: invite.token,
        userId: "new-user",
        email: "other@example.com",
        emailVerified: true,
        now,
      }),
    ).toEqual({ ok: false, reason: "email_mismatch" });

    const accepted = await acceptWorkspaceInvitation(db, {
      token: invite.token,
      userId: "new-user",
      email: "NEW@example.com",
      emailVerified: true,
      now,
    });
    expect(accepted).toEqual({ ok: true, workspaceId: "ws_a", role: "member" });
    expect(
      await acceptWorkspaceInvitation(db, {
        token: invite.token,
        userId: "another-user",
        email: "new@example.com",
        emailVerified: true,
        now,
      }),
    ).toEqual({ ok: false, reason: "already_used" });

    const member = await db
      .prepare("SELECT workspace_id, user_id, role FROM workspace_members WHERE user_id = ?")
      .bind("new-user")
      .first<{ workspace_id: string; user_id: string; role: string }>();
    expect(member).toEqual({ workspace_id: "ws_a", user_id: "new-user", role: "member" });
    expect((await listWorkspaceMembers(db, "ws_a")).map((item) => item.role)).toEqual([
      "owner",
      "member",
    ]);
  });

  it("does not accept expired or revoked invitations", async () => {
    const expired = await createWorkspaceInvitation(db, {
      id: "inv_expired",
      workspaceId: "ws_a",
      invitedEmail: "expired@example.com",
      invitedByUserId: "owner",
      now: new Date("2026-08-01T00:00:00.000Z"),
      expiresAt: new Date("2026-08-02T00:00:00.000Z"),
    });
    expect(
      await acceptWorkspaceInvitation(db, {
        token: expired.token,
        userId: "expired-user",
        email: "expired@example.com",
        emailVerified: true,
        now,
      }),
    ).toEqual({ ok: false, reason: "expired" });

    const revoked = await createWorkspaceInvitation(db, {
      id: "inv_revoked",
      workspaceId: "ws_a",
      invitedEmail: "revoked@example.com",
      invitedByUserId: "owner",
      now,
    });
    expect(await revokeWorkspaceInvitation(db, "ws_a", revoked.id)).toBe(true);
    expect(await listPendingWorkspaceInvitations(db, "ws_a", now)).toHaveLength(0);
    expect(
      await acceptWorkspaceInvitation(db, {
        token: revoked.token,
        userId: "revoked-user",
        email: "revoked@example.com",
        emailVerified: true,
        now,
      }),
    ).toEqual({ ok: false, reason: "revoked" });
  });

  it("keeps concurrent accepts atomic when one verified user has two invitations", async () => {
    const first = await createWorkspaceInvitation(db, {
      id: "inv_race_a",
      workspaceId: "ws_a",
      invitedEmail: "race@example.com",
      invitedByUserId: "owner",
      now,
    });
    const second = await createWorkspaceInvitation(db, {
      id: "inv_race_b",
      workspaceId: "ws_b",
      invitedEmail: "race@example.com",
      invitedByUserId: "owner-b",
      now,
    });

    const results = await Promise.all([
      acceptWorkspaceInvitation(db, {
        token: first.token,
        userId: "race-user",
        email: "race@example.com",
        emailVerified: true,
        now,
      }),
      acceptWorkspaceInvitation(db, {
        token: second.token,
        userId: "race-user",
        email: "race@example.com",
        emailVerified: true,
        now,
      }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    const membershipCount = await db
      .prepare("SELECT COUNT(*) AS count FROM workspace_members WHERE user_id = ?")
      .bind("race-user")
      .first<{ count: number }>();
    expect(membershipCount?.count).toBe(1);
    const acceptedCount = await db
      .prepare("SELECT COUNT(*) AS count FROM workspace_invitations WHERE accepted_by_user_id = ?")
      .bind("race-user")
      .first<{ count: number }>();
    expect(acceptedCount?.count).toBe(1);
  });
});
