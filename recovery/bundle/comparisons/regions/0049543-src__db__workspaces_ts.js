// src/db/workspaces.ts
var WorkspaceSchema = external_exports.object({
  id: external_exports.string().min(1),
  name: external_exports.string().min(1),
  ownerUserId: external_exports.string().min(1),
  createdAt: external_exports.string().min(1)
});
async function ownerEmailsForWorkspaces(db, workspaceIds) {
  const ids = [...new Set(workspaceIds)].filter((id) => id.length > 0);
  const result = /* @__PURE__ */ new Map();
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await db.prepare(
    `SELECT w.id AS workspace_id, u.email AS email
       FROM workspaces w
       LEFT JOIN "user" u ON u.id = w.owner_user_id
       WHERE w.id IN (${placeholders})`
  ).bind(...ids).all();
  for (const row of rows) result.set(row.workspace_id, row.email ?? null);
  return result;
}
__name(ownerEmailsForWorkspaces, "ownerEmailsForWorkspaces");
