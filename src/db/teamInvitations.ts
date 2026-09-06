import type { SqlDb } from "@/db/sql";

export const TEAM_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const TEAM_INVITATION_ROLES = ["member"] as const;
export type TeamInvitationRole = (typeof TEAM_INVITATION_ROLES)[number];
export type WorkspaceMemberRole = "owner" | TeamInvitationRole;

export interface WorkspaceMember {
  userId: string;
  email: string;
  name: string;
  role: WorkspaceMemberRole;
  createdAt: string;
}

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  invitedEmail: string;
  role: TeamInvitationRole;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  invitedByUserId: string;
  createdAt: string;
}

export interface CreatedWorkspaceInvitation extends WorkspaceInvitation {
  token: string;
}

export type InvitationFailureReason =
  | "invalid"
  | "expired"
  | "revoked"
  | "already_used"
  | "email_mismatch"
  | "email_unverified"
  | "already_member";

export type AcceptInvitationResult =
  | { ok: true; workspaceId: string; role: TeamInvitationRole }
  | { ok: false; reason: InvitationFailureReason };

export class TeamInvitationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_email"
      | "invalid_role"
      | "already_pending"
      | "already_member"
      | "not_owner",
  ) {
    super(message);
    this.name = "TeamInvitationError";
  }
}

interface WorkspaceInvitationRow {
  id: string;
  workspace_id: string;
  invited_email: string;
  role: string;
  token_hash: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_user_id: string | null;
  revoked_at: string | null;
  invited_by_user_id: string;
  created_at: string;
}

interface WorkspaceMemberRow {
  user_id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toInvitation(row: WorkspaceInvitationRow): WorkspaceInvitation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    invitedEmail: row.invited_email,
    role: row.role as TeamInvitationRole,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    invitedByUserId: row.invited_by_user_id,
    createdAt: row.created_at,
  };
}

function newInvitationId(): string {
  return `inv_${crypto.randomUUID().replace(/-/g, "")}`;
}

function newInvitationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function listWorkspaceMembers(db: SqlDb, workspaceId: string): Promise<WorkspaceMember[]> {
  const rows = await db
    .prepare(
      `SELECT m.user_id, COALESCE(u.email, '') AS email, COALESCE(u.name, '') AS name,
              m.role, m.created_at
       FROM workspace_members m
       LEFT JOIN user u ON u.id = m.user_id
       WHERE m.workspace_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.created_at, m.user_id`,
    )
    .bind(workspaceId)
    .all<WorkspaceMemberRow>();
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role as WorkspaceMemberRole,
    createdAt: row.created_at,
  }));
}

export async function listPendingWorkspaceInvitations(
  db: SqlDb,
  workspaceId: string,
  now = new Date(),
): Promise<WorkspaceInvitation[]> {
  const rows = await db
    .prepare(
      `SELECT id, workspace_id, invited_email, role, token_hash, expires_at,
              accepted_at, accepted_by_user_id, revoked_at, invited_by_user_id, created_at
       FROM workspace_invitations
       WHERE workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC`,
    )
    .bind(workspaceId, now.toISOString())
    .all<WorkspaceInvitationRow>();
  return rows.map(toInvitation);
}

/**
 * Whether ANY workspace currently has a live invitation out to this address.
 *
 * Deliberately unscoped by workspace: the signup gate runs before the person
 * has an account, let alone a tenant, so there is no scope to run it in. It
 * returns a boolean about the address the caller is signing up with and
 * nothing else — never which workspace invited them, by whom, or how many.
 */
export async function hasPendingInvitationForEmail(
  db: SqlDb,
  email: string,
  now = new Date(),
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS present FROM workspace_invitations
       WHERE invited_email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
       LIMIT 1`,
    )
    .bind(normalizeInvitationEmail(email), now.toISOString())
    .first<{ present: number }>();
  return row?.present === 1;
}

export async function getWorkspaceInvitationByToken(
  db: SqlDb,
  token: string,
): Promise<WorkspaceInvitation | null> {
  const tokenHash = await hashInvitationToken(token);
  const row = await db
    .prepare(
      `SELECT id, workspace_id, invited_email, role, token_hash, expires_at,
              accepted_at, accepted_by_user_id, revoked_at, invited_by_user_id, created_at
       FROM workspace_invitations WHERE token_hash = ? LIMIT 1`,
    )
    .bind(tokenHash)
    .first<WorkspaceInvitationRow>();
  return row ? toInvitation(row) : null;
}

export async function createWorkspaceInvitation(
  db: SqlDb,
  input: {
    id?: string;
    workspaceId: string;
    invitedEmail: string;
    role?: TeamInvitationRole;
    invitedByUserId: string;
    now?: Date;
    expiresAt?: Date;
  },
): Promise<CreatedWorkspaceInvitation> {
  const invitedEmail = normalizeInvitationEmail(input.invitedEmail);
  if (!EMAIL_RE.test(invitedEmail)) {
    throw new TeamInvitationError("Enter a valid recipient email address.", "invalid_email");
  }
  const role = input.role ?? "member";
  if (!TEAM_INVITATION_ROLES.includes(role)) {
    throw new TeamInvitationError("That team role is not available.", "invalid_role");
  }

  const workspace = await db
    .prepare("SELECT owner_user_id FROM workspaces WHERE id = ? LIMIT 1")
    .bind(input.workspaceId)
    .first<{ owner_user_id: string }>();
  if (!workspace || workspace.owner_user_id !== input.invitedByUserId) {
    throw new TeamInvitationError(
      "Only the workspace owner can create invitations.",
      "not_owner",
    );
  }

  const member = await db
    .prepare(
      `SELECT 1 AS present FROM workspace_members m
       JOIN user u ON u.id = m.user_id
       WHERE m.workspace_id = ? AND lower(u.email) = ? LIMIT 1`,
    )
    .bind(input.workspaceId, invitedEmail)
    .first<{ present: number }>();
  if (member) throw new TeamInvitationError("That person is already a workspace member.", "already_member");

  const now = input.now ?? new Date();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + TEAM_INVITATION_TTL_MS);
  const duplicate = await db
    .prepare(
      `SELECT 1 AS present FROM workspace_invitations
       WHERE workspace_id = ? AND invited_email = ? AND accepted_at IS NULL
         AND revoked_at IS NULL AND expires_at > ? LIMIT 1`,
    )
    .bind(input.workspaceId, invitedEmail, now.toISOString())
    .first<{ present: number }>();
  if (duplicate) {
    throw new TeamInvitationError(
      "A pending invitation already exists for that address.",
      "already_pending",
    );
  }

  const token = newInvitationToken();
  const row: WorkspaceInvitationRow = {
    id: input.id ?? newInvitationId(),
    workspace_id: input.workspaceId,
    invited_email: invitedEmail,
    role,
    token_hash: await hashInvitationToken(token),
    expires_at: expiresAt.toISOString(),
    accepted_at: null,
    accepted_by_user_id: null,
    revoked_at: null,
    invited_by_user_id: input.invitedByUserId,
    created_at: now.toISOString(),
  };

  await db
    .prepare(
      `INSERT INTO workspace_invitations
       (id, workspace_id, invited_email, role, token_hash, expires_at, accepted_at,
        accepted_by_user_id, revoked_at, invited_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.workspace_id,
      row.invited_email,
      row.role,
      row.token_hash,
      row.expires_at,
      row.accepted_at,
      row.accepted_by_user_id,
      row.revoked_at,
      row.invited_by_user_id,
      row.created_at,
    )
    .run();

  return { ...toInvitation(row), token };
}

export async function revokeWorkspaceInvitation(
  db: SqlDb,
  workspaceId: string,
  invitationId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE workspace_invitations SET revoked_at = ?
       WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    )
    .bind(new Date().toISOString(), invitationId, workspaceId)
    .run();
  return result.rowsAffected > 0;
}

export async function acceptWorkspaceInvitation(
  db: SqlDb,
  input: {
    token: string;
    userId: string;
    email: string;
    emailVerified: boolean;
    now?: Date;
  },
): Promise<AcceptInvitationResult> {
  if (!input.emailVerified) return { ok: false, reason: "email_unverified" };

  const tokenHash = await hashInvitationToken(input.token);
  const row = await db
    .prepare(
      `SELECT id, workspace_id, invited_email, role, token_hash, expires_at,
              accepted_at, accepted_by_user_id, revoked_at, invited_by_user_id, created_at
       FROM workspace_invitations WHERE token_hash = ? LIMIT 1`,
    )
    .bind(tokenHash)
    .first<WorkspaceInvitationRow>();
  if (!row) return { ok: false, reason: "invalid" };

  const now = input.now ?? new Date();
  if (row.accepted_at) return { ok: false, reason: "already_used" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  if (row.expires_at <= now.toISOString()) return { ok: false, reason: "expired" };
  if (normalizeInvitationEmail(row.invited_email) !== normalizeInvitationEmail(input.email)) {
    return { ok: false, reason: "email_mismatch" };
  }

  const existingMembership = await db
    .prepare("SELECT 1 AS present FROM workspace_members WHERE user_id = ? LIMIT 1")
    .bind(input.userId)
    .first<{ present: number }>();
  if (existingMembership) return { ok: false, reason: "already_member" };

  // The conditional update and acceptance trigger run as one SQLite/D1
  // statement: the trigger inserts membership before the claim can commit.
  // This makes a token single-use even when two requests race to accept it.
  let claimed;
  try {
    claimed = await db
      .prepare(
        `UPDATE workspace_invitations SET accepted_at = ?, accepted_by_user_id = ?
         WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      )
      .bind(now.toISOString(), input.userId, row.id, now.toISOString())
      .run();
  } catch {
    // The acceptance trigger rejects a race with another membership for this
    // user and rolls the token update back in the same database statement.
    return { ok: false, reason: "already_member" };
  }
  if (claimed.rowsAffected !== 1) return { ok: false, reason: "already_used" };

  return { ok: true, workspaceId: row.workspace_id, role: row.role as TeamInvitationRole };
}
