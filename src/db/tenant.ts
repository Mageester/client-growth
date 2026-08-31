import type { SqlDb } from "@/db/sql";

/**
 * A database handle bound to exactly one workspace. Every tenant repository
 * function takes this instead of a bare SqlDb, so it is a compile error to run
 * a tenant query without a workspace scope. `workspaceId` is only ever produced
 * from a resolved session (app/lib/session.server.ts) or a test literal.
 */
export interface TenantScope {
  db: SqlDb;
  workspaceId: string;
}

/**
 * Thrown by a write when the caller's scope tried to persist a row that
 * references another workspace's client or service (e.g. `saveEvidence(A, …B…)`).
 * Routes translate this to a 404. The database composite foreign keys are the
 * second line of defence.
 */
export class CrossWorkspaceError extends Error {
  constructor(detail: string) {
    super(`Cross-workspace write rejected: ${detail}`);
    this.name = "CrossWorkspaceError";
  }
}

/** Does `id` exist in this workspace for the given table? */
export async function existsInWorkspace(
  t: TenantScope,
  table: "clients" | "services",
  id: string,
): Promise<boolean> {
  const row = await t.db
    .prepare(`SELECT 1 AS ok FROM ${table} WHERE id = ? AND workspace_id = ?`)
    .bind(id, t.workspaceId)
    .first<{ ok: number }>();
  return row !== null;
}
