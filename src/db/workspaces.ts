import { z } from "zod";

import type { SqlBatchStatement, SqlDb } from "@/db/sql";

export const WorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ownerUserId: z.string().min(1),
  createdAt: z.string().min(1),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

interface WorkspaceRow {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
}

const toWorkspace = (r: WorkspaceRow): Workspace =>
  WorkspaceSchema.parse({
    id: r.id,
    name: r.name,
    ownerUserId: r.owner_user_id,
    createdAt: r.created_at,
  });

/**
 * Create a workspace and its single owner membership. Idempotent: if a
 * workspace already exists for `ownerUserId` it is returned unchanged (this is
 * what makes retrying onboarding after a partial signup failure safe).
 */
export async function createWorkspaceForOwner(
  db: SqlDb,
  input: { id: string; name: string; ownerUserId: string },
): Promise<Workspace> {
  const existing = await getWorkspaceForUser(db, input.ownerUserId);
  if (existing) return existing;

  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO workspaces (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)")
    .bind(input.id, input.name.trim() || "My Agency", input.ownerUserId, now)
    .run();
  await db
    .prepare(
      "INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
    )
    .bind(input.id, input.ownerUserId, now)
    .run();

  return WorkspaceSchema.parse({
    id: input.id,
    name: input.name.trim() || "My Agency",
    ownerUserId: input.ownerUserId,
    createdAt: now,
  });
}

/** The workspace this user belongs to (V0: at most one, as owner). */
export async function getWorkspaceForUser(db: SqlDb, userId: string): Promise<Workspace | null> {
  const row = await db
    .prepare(
      `SELECT w.* FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id
       WHERE m.user_id = ?
       ORDER BY w.created_at ASC
       LIMIT 1`,
    )
    .bind(userId)
    .first<WorkspaceRow>();
  return row ? toWorkspace(row) : null;
}

export async function getWorkspace(db: SqlDb, id: string): Promise<Workspace | null> {
  const row = await db.prepare("SELECT * FROM workspaces WHERE id = ?").bind(id).first<WorkspaceRow>();
  return row ? toWorkspace(row) : null;
}

export async function renameWorkspace(db: SqlDb, id: string, name: string): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const r = await db
    .prepare("UPDATE workspaces SET name = ? WHERE id = ?")
    .bind(trimmed, id)
    .run();
  return r.rowsAffected > 0;
}

export type ResetWorkspaceResult =
  | { ok: true; workspaceId: string }
  | { ok: false; error: string };

/**
 * Erase a workspace's PRODUCT state and restart it for onboarding, without
 * touching its identity or its history.
 *
 * Preserved: the workspaces row (and its id), the owner's workspace_members
 * row, every Better Auth row (user / session / account / verification /
 * rateLimit), and the append-only analysis_limit_reservations ledger — so a
 * reset can never buy a fresh analysis-limit budget.
 *
 * Removed: clients and everything hanging off them (coverage, evidence,
 * opportunities, analysis runs, competitors — monitoring state lives on the
 * client row), the service catalog, workspace branding, pending invitations,
 * proposal/report share links and snapshots, and any non-owner workspace
 * members.
 *
 * Authorization is enforced HERE, at the write boundary: the acting user must
 * be the workspace owner and must type the workspace's current name exactly.
 * The UI is not trusted.
 *
 * Every destructive statement runs in ONE atomic db.batch: if any statement
 * fails, the whole batch aborts and the workspace is left exactly as it was.
 */
export async function resetWorkspace(
  db: SqlDb,
  workspaceId: string,
  actingUserId: string,
  confirmationWorkspaceName: string,
): Promise<ResetWorkspaceResult> {
  const workspace = await db
    .prepare("SELECT id, name, owner_user_id FROM workspaces WHERE id = ?")
    .bind(workspaceId)
    .first<{ id: string; name: string; owner_user_id: string }>();

  if (!workspace) return { ok: false, error: "Workspace not found." };
  if (workspace.owner_user_id !== actingUserId) {
    return { ok: false, error: "Only the workspace owner can reset the workspace." };
  }
  if (confirmationWorkspaceName.trim() !== workspace.name) {
    return { ok: false, error: "Confirmation did not match the workspace name." };
  }

  // Child-first where rows reference rows (clients own their coverage,
  // evidence, opportunities, runs and competitors through composite foreign
  // keys), but every statement is listed explicitly and scoped to THIS
  // workspace id. analysis_limit_reservations is deliberately absent: it has
  // no client foreign key and is the workspace's usage history.
  const statements: SqlBatchStatement[] = [
    { sql: "DELETE FROM proposal_shares WHERE workspace_id = ?", params: [workspaceId] },
    { sql: "DELETE FROM client_report_shares WHERE workspace_id = ?", params: [workspaceId] },
    { sql: "DELETE FROM client_report_snapshots WHERE workspace_id = ?", params: [workspaceId] },
    { sql: "DELETE FROM workspace_invitations WHERE workspace_id = ?", params: [workspaceId] },
    { sql: "DELETE FROM client_competitors WHERE workspace_id = ?", params: [workspaceId] },
    { sql: "DELETE FROM analysis_runs WHERE workspace_id = ?", params: [workspaceId] },
    { sql: "DELETE FROM opportunities WHERE workspace_id = ?", params: [workspaceId] },
    { sql: "DELETE FROM evidence_bundles WHERE workspace_id = ?", params: [workspaceId] },
    { sql: "DELETE FROM client_coverage WHERE workspace_id = ?", params: [workspaceId] },
    { sql: "DELETE FROM clients WHERE workspace_id = ?", params: [workspaceId] },
    { sql: "DELETE FROM services WHERE workspace_id = ?", params: [workspaceId] },
    { sql: "DELETE FROM workspace_branding WHERE workspace_id = ?", params: [workspaceId] },
    {
      sql: "DELETE FROM workspace_members WHERE workspace_id = ? AND user_id <> ?",
      params: [workspaceId, actingUserId],
    },
  ];

  try {
    await db.batch(statements);
  } catch {
    // The batch is atomic on every supported backend, so a rejection here
    // means nothing was committed. Say so rather than implying a partial state.
    return { ok: false, error: "Reset could not be completed. Nothing was changed." };
  }

  return { ok: true, workspaceId: workspace.id };
}

export function newWorkspaceId(): string {
  return `ws_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
