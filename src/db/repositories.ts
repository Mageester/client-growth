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

/** Apply the canonical schema (idempotent). Used by tests and local seeding. */
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

export async function listServices(db: SqlDb): Promise<Service[]> {
  const rows = await db.prepare("SELECT * FROM services ORDER BY name").all<ServiceRow>();
  return rows.map(toService);
}

export async function getService(db: SqlDb, id: string): Promise<Service | null> {
  const row = await db.prepare("SELECT * FROM services WHERE id = ?").bind(id).first<ServiceRow>();
  return row ? toService(row) : null;
}

export async function upsertService(db: SqlDb, service: Service): Promise<void> {
  const s = ServiceSchema.parse(service);
  await db
    .prepare(
      `INSERT INTO services (id, name, description, price_min, price_max, tags, active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         price_min = excluded.price_min,
         price_max = excluded.price_max,
         tags = excluded.tags,
         active = excluded.active,
         updated_at = excluded.updated_at`,
    )
    .bind(
      s.id,
      s.name,
      s.description,
      s.priceMin,
      s.priceMax,
      JSON.stringify(s.tags),
      s.active ? 1 : 0,
      nowIso(),
    )
    .run();
}

export async function setServiceActive(db: SqlDb, id: string, active: boolean): Promise<void> {
  await db
    .prepare("UPDATE services SET active = ?, updated_at = ? WHERE id = ?")
    .bind(active ? 1 : 0, nowIso(), id)
    .run();
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

export async function listClients(db: SqlDb): Promise<Client[]> {
  const rows = await db.prepare("SELECT * FROM clients ORDER BY name").all<ClientRow>();
  return rows.map(toClient);
}

export async function getClient(db: SqlDb, id: string): Promise<Client | null> {
  const row = await db.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first<ClientRow>();
  return row ? toClient(row) : null;
}

export async function upsertClient(db: SqlDb, client: Client): Promise<void> {
  const c = ClientSchema.parse(client);
  await db
    .prepare(
      `INSERT INTO clients (id, name, domain, offerings, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         domain = excluded.domain,
         offerings = excluded.offerings,
         notes = excluded.notes,
         updated_at = excluded.updated_at`,
    )
    .bind(c.id, c.name, c.domain, JSON.stringify(c.offerings), c.notes, nowIso())
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

export async function listCoverage(db: SqlDb, clientId: string): Promise<Coverage[]> {
  const rows = await db
    .prepare("SELECT * FROM client_coverage WHERE client_id = ?")
    .bind(clientId)
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

export async function setCoverage(
  db: SqlDb,
  clientId: string,
  serviceId: string,
  note?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO client_coverage (client_id, service_id, note)
       VALUES (?, ?, ?)
       ON CONFLICT(client_id, service_id) DO UPDATE SET note = excluded.note`,
    )
    .bind(clientId, serviceId, note ?? null)
    .run();
}

export async function removeCoverage(
  db: SqlDb,
  clientId: string,
  serviceId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM client_coverage WHERE client_id = ? AND service_id = ?")
    .bind(clientId, serviceId)
    .run();
}

// ---------------------------------------------------------------------------
// evidence bundle cache
// ---------------------------------------------------------------------------
interface EvidenceRow {
  bundle: string;
}

export async function saveEvidence(db: SqlDb, bundle: EvidenceBundle): Promise<void> {
  const b = EvidenceBundleSchema.parse(bundle);
  await db
    .prepare(
      `INSERT INTO evidence_bundles (client_id, source, captured_at, bundle)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(b.clientId, b.source, b.capturedAt, JSON.stringify(b))
    .run();
}

export async function getLatestEvidence(
  db: SqlDb,
  clientId: string,
): Promise<EvidenceBundle | null> {
  const row = await db
    .prepare(
      `SELECT bundle FROM evidence_bundles
       WHERE client_id = ?
       ORDER BY captured_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(clientId)
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

export async function listOpportunities(db: SqlDb, clientId: string): Promise<Opportunity[]> {
  const rows = await db
    .prepare("SELECT * FROM opportunities WHERE client_id = ? ORDER BY confidence DESC, title")
    .bind(clientId)
    .all<OpportunityRow>();
  return rows.map(toOpportunity);
}

async function upsertOpportunity(db: SqlDb, opp: Opportunity): Promise<void> {
  const o = OpportunitySchema.parse(opp);
  await db
    .prepare(
      `INSERT INTO opportunities (
         id, dedupe_key, client_id, rule_id, title, detected, evidence_refs, rationale,
         suggested_service_id, suggested_scope, price_min, price_max, confidence,
         billable_status, status, snooze_until, proposal_md, verification,
         conversion_defect, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(client_id, dedupe_key) DO UPDATE SET
         title = excluded.title,
         detected = excluded.detected,
         evidence_refs = excluded.evidence_refs,
         rationale = excluded.rationale,
         suggested_service_id = excluded.suggested_service_id,
         suggested_scope = excluded.suggested_scope,
         price_min = excluded.price_min,
         price_max = excluded.price_max,
         confidence = excluded.confidence,
         billable_status = excluded.billable_status,
         status = excluded.status,
         snooze_until = excluded.snooze_until,
         proposal_md = excluded.proposal_md,
         verification = excluded.verification,
         conversion_defect = excluded.conversion_defect,
         updated_at = excluded.updated_at`,
    )
    .bind(
      o.id,
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
    )
    .run();
}

/**
 * Persist the reconciled output of a pipeline run. Rows the run did not touch
 * are left untouched (so decisions on stale candidates are preserved). The
 * pipeline has already merged prior status/proposal into these rows.
 */
export async function saveAnalysis(
  db: SqlDb,
  rows: Opportunity[],
): Promise<void> {
  for (const row of rows) {
    await upsertOpportunity(db, row);
  }
}

export async function setOpportunityStatus(
  db: SqlDb,
  id: string,
  status: Opportunity["status"],
  snoozeUntil?: string,
): Promise<void> {
  await db
    .prepare("UPDATE opportunities SET status = ?, snooze_until = ?, updated_at = ? WHERE id = ?")
    .bind(status, snoozeUntil ?? null, nowIso(), id)
    .run();
}

export async function setOpportunityProposal(
  db: SqlDb,
  id: string,
  proposalMd: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE opportunities SET proposal_md = ?, status = 'proposal_prepared', updated_at = ? WHERE id = ?",
    )
    .bind(proposalMd, nowIso(), id)
    .run();
}

export async function getOpportunity(db: SqlDb, id: string): Promise<Opportunity | null> {
  const row = await db
    .prepare("SELECT * FROM opportunities WHERE id = ?")
    .bind(id)
    .first<OpportunityRow>();
  return row ? toOpportunity(row) : null;
}
