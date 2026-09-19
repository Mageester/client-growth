// src/db/tenant.ts
var CrossWorkspaceError = class extends Error {
  static {
    __name(this, "CrossWorkspaceError");
  }
  constructor(detail) {
    super(`Cross-workspace write rejected: ${detail}`);
    this.name = "CrossWorkspaceError";
  }
};
async function existsInWorkspace(t, table2, id) {
  const row = await t.db.prepare(`SELECT 1 AS ok FROM ${table2} WHERE id = ? AND workspace_id = ?`).bind(id, t.workspaceId).first();
  return row !== null;
}
__name(existsInWorkspace, "existsInWorkspace");
