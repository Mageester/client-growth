import {
  ClientSchema,
  CoverageSchema,
  EvidenceBundleSchema,
  OpportunitySchema,
  ServiceSchema,
  type Client,
  type Coverage,
  type EvidenceBundle,
  type Opportunity,
  type Service,
} from "@/core/schema";
import { SCHEMA_SQL } from "@/db/schema";
import type { SqlDb } from "@/db/sql";
import { CrossWorkspaceError, existsInWorkspace, type TenantScope } from "@/db/tenant";

/** Apply the canonical application schema (idempotent). Tests / local seeding. */
export function applySchema(db: SqlDb): Promise<void> {
  return db.exec(SCHEMA_SQL);
}

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// services
// ---------------------------------------------------------------------------
interface ServiceRow {
  id: string;
  name: string;
  description: string;
  price_min: number;
  price_max: number;
  tags: string;
  active: number;
}

function toService(row: ServiceRow): Service {
  return ServiceSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    priceMin: row.price_min,
    priceMax: row.price_max,
    tags: JSON.parse(row.tags) as string[],
    active: row.active === 1,
  });
}

export async function listServices(t: TenantScope): Promise<Service[]> {
  const rows = await t.db
    .prepare("SELECT * FROM services WHERE workspace_id = ? ORDER BY name")
    .bind(t.workspaceId)
    .all<ServiceRow>();
  return rows.map(toService);
}

export async function getService(t: TenantScope, id: string): Promise<Service | null> {
  const row = await t.db
    .prepare("SELECT * FROM services WHERE id = ? AND workspace_id = ?")
    .bind(id, t.workspaceId)
    .first<ServiceRow>();
  return row ? toService(row) : null;
}

/** Insert or update a service in this workspace. Throws if `id` belongs elsewhere. */
export async function upsertService(t: TenantScope, service: Service): Promise<void> {
  const s = ServiceSchema.parse(service);
  const owner = await t.db
    .prepare("SELECT workspace_id FROM services WHERE id = ?")
    .bind(s.id)
    .first<{ workspace_id: string }>();
  if (owner && owner.workspace_id !== t.workspaceId) {
    throw new CrossWorkspaceError(`service ${s.id} belongs to another workspace`);
  }
  await t.db
    .prepare(
      `INSERT INTO services (id, workspace_id, name, description, price_min, price_max, tags, active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, description = excluded.description,
         price_min = excluded.price_min, price_max = excluded.price_max,
         tags = excluded.tags, active = excluded.active, updated_at = excluded.updated_at
       WHERE services.workspace_id = ?`,
    )
    .bind(
      s.id,
      t.workspaceId,
      s.name,
      s.description,
      s.priceMin,
      s.priceMax,
      JSON.stringify(s.tags),
      s.active ? 1 : 0,
      nowIso(),
      t.workspaceId,
    )
    .run();
}

export async function setServiceActive(
  t: TenantScope,
  id: string,
  active: boolean,
): Promise<boolean> {
  const r = await t.db
    .prepare("UPDATE services SET active = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
    .bind(active ? 1 : 0, nowIso(), id, t.workspaceId)
    .run();
  return r.rowsAffected > 0;
}

// ---------------------------------------------------------------------------
// clients
// ---------------------------------------------------------------------------
interface ClientRow {
  id: string;
  name: string;
  domain: string;
  offerings: string;
  notes: string;
}

function toClient(row: ClientRow): Client {
  return ClientSchema.parse({
    id: row.id,
    name: row.name,
    domain: row.domain,
    offerings: JSON.parse(row.offerings) as string[],
    notes: row.notes,
  });
}

export async function listClients(t: TenantScope): Promise<Client[]> {
  const rows = await t.db
    .prepare("SELECT * FROM clients WHERE workspace_id = ? ORDER BY name")
    .bind(t.workspaceId)
    .all<ClientRow>();
  return rows.map(toClient);
}

export async function getClient(t: TenantScope, id: string): Promise<Client | null> {
  const row = await t.db
    .prepare("SELECT * FROM clients WHERE id = ? AND workspace_id = ?")
    .bind(id, t.workspaceId)
    .first<ClientRow>();
  return row ? toClient(row) : null;
}

export async function upsertClient(t: TenantScope, client: Client): Promise<void> {
  const c = ClientSchema.parse(client);
  const owner = await t.db
    .prepare("SELECT workspace_id FROM clients WHERE id = ?")
    .bind(c.id)
    .first<{ workspace_id: string }>();
  if (owner && owner.workspace_id !== t.workspaceId) {
    throw new CrossWorkspaceError(`client ${c.id} belongs to another workspace`);
  }
  await t.db
    .prepare(
      `INSERT INTO clients (id, workspace_id, name, domain, offerings, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, domain = excluded.domain, offerings = excluded.offerings,
         notes = excluded.notes, updated_at = excluded.updated_at
       WHERE clients.workspace_id = ?`,
    )
    .bind(
      c.id,
      t.workspaceId,
      c.name,
      c.domain,
      JSON.stringify(c.offerings),
      c.notes,
      nowIso(),
      t.workspaceId,
    )
    .run();
}

// ---------------------------------------------------------------------------
// coverage
// ---------------------------------------------------------------------------
interface CoverageRow {
  client_id: string;
  service_id: string;
  note: string | null;
}

export async function listCoverage(t: TenantScope, clientId: string): Promise<Coverage[]> {
  const rows = await t.db
    .prepare("SELECT * FROM client_coverage WHERE client_id = ? AND workspace_id = ?")
    .bind(clientId, t.workspaceId)
    .all<CoverageRow>();
  return rows.map((r) =>
    CoverageSchema.parse({
      clientId: r.client_id,
      serviceId: r.service_id,
      covered: true,
      note: r.note ?? undefined,
    }),
  );
}

/** Returns false when the client or service is not in this workspace. */
export async function setCoverage(
  t: TenantScope,
  clientId: string,
  serviceId: string,
  note?: string,
): Promise<boolean> {
  if (!(await existsInWorkspace(t, "clients", clientId))) return false;
  if (!(await existsInWorkspace(t, "services", serviceId))) return false;
  await t.db
    .prepare(
      `INSERT INTO client_coverage (workspace_id, client_id, service_id, note)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(client_id, service_id) DO UPDATE SET note = excluded.note`,
    )
    .bind(t.workspaceId, clientId, serviceId, note ?? null)
    .run();
  return true;
}

export async function removeCoverage(
  t: TenantScope,
  clientId: string,
  serviceId: string,
): Promise<boolean> {
  const r = await t.db
    .prepare(
      "DELETE FROM client_coverage WHERE client_id = ? AND service_id = ? AND workspace_id = ?",
    )
    .bind(clientId, serviceId, t.workspaceId)
    .run();
  return r.rowsAffected > 0;
}

// ---------------------------------------------------------------------------
// evidence bundle cache
// ---------------------------------------------------------------------------
interface EvidenceRow {
  bundle: string;
}

export async function saveEvidence(t: TenantScope, bundle: EvidenceBundle): Promise<void> {
  const b = EvidenceBundleSchema.parse(bundle);
  if (!(await existsInWorkspace(t, "clients", b.clientId))) {
    throw new CrossWorkspaceError(`evidence for client ${b.clientId} not in this workspace`);
  }
  await t.db
    .prepare(
      `INSERT INTO evidence_bundles (workspace_id, client_id, source, captured_at, bundle)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(t.workspaceId, b.clientId, b.source, b.capturedAt, JSON.stringify(b))
    .run();
}

export async function getLatestEvidence(
  t: TenantScope,
  clientId: string,
): Promise<EvidenceBundle | null> {
  const row = await t.db
    .prepare(
      `SELECT bundle FROM evidence_bundles
       WHERE client_id = ? AND workspace_id = ?
       ORDER BY captured_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(clientId, t.workspaceId)
    .first<EvidenceRow>();
  return row ? EvidenceBundleSchema.parse(JSON.parse(row.bundle)) : null;
}

// ---------------------------------------------------------------------------
// opportunities (+ persisted agency decisions)
// ---------------------------------------------------------------------------
interface OpportunityRow {
  id: string;
  dedupe_key: string;
  client_id: string;
  rule_id: string;
  title: string;
  detected: string;
  evidence_refs: string;
  rationale: string;
  suggested_service_id: string;
  suggested_scope: string;
  price_min: number;
  price_max: number;
  confidence: number;
  billable_status: string;
  status: string;
  snooze_until: string | null;
  proposal_md: string | null;
  verification: string | null;
  conversion_defect: string | null;
  updated_at: string;
}

function toOpportunity(row: OpportunityRow): Opportunity {
  return OpportunitySchema.parse({
    id: row.id,
    dedupeKey: row.dedupe_key,
    clientId: row.client_id,
    ruleId: row.rule_id,
    title: row.title,
    detected: row.detected,
    evidenceRefs: JSON.parse(row.evidence_refs) as string[],
    rationale: row.rationale,
    suggestedServiceId: row.suggested_service_id,
    suggestedScope: JSON.parse(row.suggested_scope) as string[],
    verification: row.verification ? JSON.parse(row.verification) : undefined,
    conversionDefect: row.conversion_defect ? JSON.parse(row.conversion_defect) : undefined,
    priceMin: row.price_min,
    priceMax: row.price_max,
    confidence: row.confidence,
    billableStatus: row.billable_status,
    status: row.status,
    snoozeUntil: row.snooze_until ?? undefined,
    proposalMd: row.proposal_md ?? undefined,
    updatedAt: row.updated_at,
  });
}

export async function listOpportunities(
  t: TenantScope,
  clientId: string,
): Promise<Opportunity[]> {
  const rows = await t.db
    .prepare(
      "SELECT * FROM opportunities WHERE client_id = ? AND workspace_id = ? ORDER BY confidence DESC, title",
    )
    .bind(clientId, t.workspaceId)
    .all<OpportunityRow>();
  return rows.map(toOpportunity);
}

export async function getOpportunity(t: TenantScope, id: string): Promise<Opportunity | null> {
  const row = await t.db
    .prepare("SELECT * FROM opportunities WHERE id = ? AND workspace_id = ?")
    .bind(id, t.workspaceId)
    .first<OpportunityRow>();
  return row ? toOpportunity(row) : null;
}

async function upsertOpportunity(t: TenantScope, opp: Opportunity): Promise<void> {
  const o = OpportunitySchema.parse(opp);
  await t.db
    .prepare(
      `INSERT INTO opportunities (
         id, workspace_id, dedupe_key, client_id, rule_id, title, detected, evidence_refs, rationale,
         suggested_service_id, suggested_scope, price_min, price_max, confidence,
         billable_status, status, snooze_until, proposal_md, verification,
         conversion_defect, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(client_id, dedupe_key) DO UPDATE SET
         title = excluded.title, detected = excluded.detected,
         evidence_refs = excluded.evidence_refs, rationale = excluded.rationale,
         suggested_service_id = excluded.suggested_service_id,
         suggested_scope = excluded.suggested_scope,
         price_min = excluded.price_min, price_max = excluded.price_max,
         confidence = excluded.confidence, billable_status = excluded.billable_status,
         status = excluded.status, snooze_until = excluded.snooze_until,
         proposal_md = excluded.proposal_md, verification = excluded.verification,
         conversion_defect = excluded.conversion_defect, updated_at = excluded.updated_at
       WHERE opportunities.workspace_id = ?`,
    )
    .bind(
      o.id,
      t.workspaceId,
      o.dedupeKey,
      o.clientId,
      o.ruleId,
      o.title,
      o.detected,
      JSON.stringify(o.evidenceRefs),
      o.rationale,
      o.suggestedServiceId,
      JSON.stringify(o.suggestedScope),
      o.priceMin,
      o.priceMax,
      o.confidence,
      o.billableStatus,
      o.status,
      o.snoozeUntil ?? null,
      o.proposalMd ?? null,
      o.verification ? JSON.stringify(o.verification) : null,
      o.conversionDefect ? JSON.stringify(o.conversionDefect) : null,
      o.updatedAt,
      t.workspaceId,
    )
    .run();
}

/**
 * Persist the reconciled output of a pipeline run into this workspace. Rejects
 * the whole batch if any row references a client/service outside the workspace
 * (defence in depth on top of the composite foreign keys).
 */
export async function saveAnalysis(t: TenantScope, rows: Opportunity[]): Promise<void> {
  for (const row of rows) {
    if (!(await existsInWorkspace(t, "clients", row.clientId))) {
      throw new CrossWorkspaceError(`opportunity for client ${row.clientId} not in this workspace`);
    }
    if (!(await existsInWorkspace(t, "services", row.suggestedServiceId))) {
      throw new CrossWorkspaceError(
        `opportunity maps to service ${row.suggestedServiceId} not in this workspace`,
      );
    }
  }
  for (const row of rows) await upsertOpportunity(t, row);
}

export async function setOpportunityStatus(
  t: TenantScope,
  id: string,
  status: Opportunity["status"],
  snoozeUntil?: string,
): Promise<boolean> {
  const r = await t.db
    .prepare(
      "UPDATE opportunities SET status = ?, snooze_until = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
    )
    .bind(status, snoozeUntil ?? null, nowIso(), id, t.workspaceId)
    .run();
  return r.rowsAffected > 0;
}

export async function setOpportunityProposal(
  t: TenantScope,
  id: string,
  proposalMd: string,
): Promise<boolean> {
  const r = await t.db
    .prepare(
      "UPDATE opportunities SET proposal_md = ?, status = 'proposal_prepared', updated_at = ? WHERE id = ? AND workspace_id = ?",
    )
    .bind(proposalMd, nowIso(), id, t.workspaceId)
    .run();
  return r.rowsAffected > 0;
}
