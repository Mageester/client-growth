import { MAX_COMPETITORS_PER_CLIENT } from "@/core/competitorGaps";
import { CrossWorkspaceError, existsInWorkspace, type TenantScope } from "@/db/tenant";

/**
 * The competitors an agency has named for one client.
 *
 * Every read filters by workspace and every write sets it, like every other
 * tenant repository. The composite foreign key in migration 0020 enforces the
 * same thing at the database level, so a competitor row can never reference a
 * client in another workspace even if this file were wrong.
 */

export { MAX_COMPETITORS_PER_CLIENT } from "@/core/competitorGaps";

export interface Competitor {
  id: string;
  clientId: string;
  name: string;
  domain: string;
  createdAt: string;
}

interface CompetitorRow {
  id: string;
  client_id: string;
  name: string;
  domain: string;
  created_at: string;
}

export type CompetitorFailure =
  | "client-not-found"
  | "limit-reached"
  | "duplicate-domain"
  | "same-as-client";

export class CompetitorError extends Error {
  readonly reason: CompetitorFailure;
  constructor(reason: CompetitorFailure, message: string) {
    super(message);
    this.name = "CompetitorError";
    this.reason = reason;
  }
}

function toCompetitor(row: CompetitorRow): Competitor {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    domain: row.domain,
    createdAt: row.created_at,
  };
}

function newCompetitorId(): string {
  return `cmp_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export async function listCompetitors(
  t: TenantScope,
  clientId: string,
): Promise<Competitor[]> {
  const rows = await t.db
    .prepare(
      `SELECT id, client_id, name, domain, created_at
       FROM client_competitors
       WHERE workspace_id = ? AND client_id = ?
       ORDER BY created_at, id`,
    )
    .bind(t.workspaceId, clientId)
    .all<CompetitorRow>();
  return rows.map(toCompetitor);
}

export async function addCompetitor(
  t: TenantScope,
  input: { clientId: string; name: string; domain: string; clientDomain: string; now?: Date },
): Promise<Competitor> {
  if (!(await existsInWorkspace(t, "clients", input.clientId))) {
    throw new CrossWorkspaceError(`client ${input.clientId} is not in this workspace`);
  }

  const domain = input.domain.trim().toLowerCase();
  if (domain === input.clientDomain.trim().toLowerCase()) {
    throw new CompetitorError(
      "same-as-client",
      "That is the client's own website, not a competitor.",
    );
  }

  const existing = await listCompetitors(t, input.clientId);
  if (existing.length >= MAX_COMPETITORS_PER_CLIENT) {
    throw new CompetitorError(
      "limit-reached",
      `A client can have at most ${MAX_COMPETITORS_PER_CLIENT} competitors. Remove one first.`,
    );
  }
  if (existing.some((competitor) => competitor.domain === domain)) {
    throw new CompetitorError(
      "duplicate-domain",
      "That competitor is already on the list for this client.",
    );
  }

  const row: Competitor = {
    id: newCompetitorId(),
    clientId: input.clientId,
    name: input.name.trim(),
    domain,
    createdAt: (input.now ?? new Date()).toISOString(),
  };

  await t.db
    .prepare(
      `INSERT INTO client_competitors (id, workspace_id, client_id, name, domain, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.id, t.workspaceId, row.clientId, row.name, row.domain, row.createdAt)
    .run();

  return row;
}

export async function removeCompetitor(
  t: TenantScope,
  clientId: string,
  competitorId: string,
): Promise<boolean> {
  const result = await t.db
    .prepare(
      `DELETE FROM client_competitors
       WHERE id = ? AND client_id = ? AND workspace_id = ?`,
    )
    .bind(competitorId, clientId, t.workspaceId)
    .run();
  return result.rowsAffected > 0;
}
