import type { TenantScope } from "@/db/tenant";

export type DeleteClientResult =
  | { status: "deleted" }
  | { status: "not_found" }
  | { status: "confirmation_mismatch" };

/**
 * Delete one client and all rows owned by it.
 *
 * The lookup and delete are both constrained by the caller's workspace. The
 * exact name is checked here, at the write boundary, so a client cannot be
 * removed by a forged form post that skips the confirmation UI. The database
 * schema owns dependent-row cleanup through its client foreign keys. The
 * workspace-level analysis admission ledger deliberately has no client foreign
 * key, so its history survives this deletion and cannot be used to bypass a
 * daily limit by recreating a client.
 */
export async function deleteClient(
  t: TenantScope,
  clientId: string,
  confirmation: string,
): Promise<DeleteClientResult> {
  const client = await t.db
    .prepare("SELECT name FROM clients WHERE id = ? AND workspace_id = ?")
    .bind(clientId, t.workspaceId)
    .first<{ name: string }>();

  if (!client) return { status: "not_found" };
  if (confirmation.trim() !== client.name) return { status: "confirmation_mismatch" };

  const deleted = await t.db
    .prepare("DELETE FROM clients WHERE id = ? AND workspace_id = ? AND name = ?")
    .bind(clientId, t.workspaceId, client.name)
    .run();

  return deleted.rowsAffected > 0 ? { status: "deleted" } : { status: "not_found" };
}
