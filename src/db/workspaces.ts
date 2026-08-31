import { z } from "zod";

import type { SqlDb } from "@/db/sql";

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

export function newWorkspaceId(): string {
  return `ws_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
