import type { Client } from "@/core/schema";
import type { SqlValue } from "@/db/sql";
import type { TenantScope } from "@/db/tenant";

/** Returned when a concurrent write makes an import's duplicate check stale. */
export class ClientImportConflictError extends Error {
  constructor() {
    super("A client with one of those domains was added while the import was being confirmed.");
    this.name = "ClientImportConflictError";
  }
}

/**
 * Insert a batch as one statement with insert-only semantics.
 *
 * The CTE's all-or-nothing predicates make a stale duplicate check safe: if a
 * domain appeared in this workspace after preview, the SELECT yields no rows,
 * so SQLite writes none of the batch. A primary-key collision likewise aborts
 * the statement instead of updating an existing row. The rows travel through
 * one JSON binding so the statement stays below D1's 100-bind limit even at
 * the maximum 50-row import size.
 */
export async function insertClientsAtomically(
  t: TenantScope,
  clients: readonly Client[],
): Promise<number> {
  if (clients.length === 0) return 0;

  const sql = `
    WITH incoming(client_id, client_name, client_domain, client_offerings, client_notes) AS (
      SELECT
        json_extract(value, '$.id'),
        json_extract(value, '$.name'),
        json_extract(value, '$.domain'),
        json_extract(value, '$.offerings'),
        json_extract(value, '$.notes')
        FROM json_each(?)
    )
    INSERT INTO clients (id, workspace_id, name, domain, offerings, notes, updated_at)
    SELECT incoming.client_id, ?, incoming.client_name, incoming.client_domain,
           incoming.client_offerings, incoming.client_notes, ?
      FROM incoming
     WHERE NOT EXISTS (
             SELECT 1
               FROM clients existing
              WHERE existing.workspace_id = ?
                AND lower(existing.domain) IN (
                      SELECT lower(client_domain) FROM incoming
                    )
           )
       AND (SELECT COUNT(*) FROM incoming) =
           (SELECT COUNT(DISTINCT lower(client_domain)) FROM incoming)
  `;
  const now = new Date().toISOString();
  const payload = JSON.stringify(
    clients.map((client) => ({
      id: client.id,
      name: client.name,
      domain: client.domain,
      offerings: JSON.stringify(client.offerings),
      notes: client.notes,
    })),
  );
  const bindings: SqlValue[] = [payload, t.workspaceId, now, t.workspaceId];

  let result: { rowsAffected: number };
  try {
    result = await t.db.prepare(sql).bind(...bindings).run();
  } catch (error) {
    // SQLite aborts the complete INSERT statement on a primary-key collision;
    // expose that as the same retryable conflict as a stale domain check.
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : String(error);
    if (/unique constraint failed/i.test(message)) {
      throw new ClientImportConflictError();
    }
    throw error;
  }
  if (result.rowsAffected !== clients.length) throw new ClientImportConflictError();
  return result.rowsAffected;
}
