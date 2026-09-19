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
import { ANALYSIS_OUTCOMES, type AnalysisOutcome } from "@/core/analysisOutcome";
import { InsightSnapshotSchema, type InsightSnapshot } from "@/core/insightSchema";
import {
  insightAccountingStatement,
  insightSnapshotStatements,
  normalizeInsightAccountingPersistence,
  type InsightAccountingPersistenceInput,
} from "@/db/insights";
import { parseOfferingLabels } from "@/core/offeringDrift";
import {
  ExternalBusinessClaimSchema,
  validateExternalBusinessClaimProvenance,
  type ExternalBusinessClaim,
} from "@/core/externalBusinessEvidence";
import { SCHEMA_SQL } from "@/db/schema";
import type { SqlDb, SqlValue } from "@/db/sql";
import { CrossWorkspaceError, existsInWorkspace, type TenantScope } from "@/db/tenant";

/** Apply the canonical application schema (idempotent). Tests / local seeding. */
export function applySchema(db: SqlDb): Promise<void> {
  return db.exec(SCHEMA_SQL);
}

const nowIso = () => new Date().toISOString();

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function canonicalAccounting(accounting: InsightSnapshot["accounting"]): InsightSnapshot["accounting"] {
  return {
    ...accounting,
    detectors: [...accounting.detectors].sort((left, right) => {
      const leftJson = stableJson(left);
      const rightJson = stableJson(right);
      return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
    }),
    categories: [...accounting.categories].sort((left, right) => left.category.localeCompare(right.category)),
  };
}

function canonicalPersistence(record: ReturnType<typeof normalizeInsightAccountingPersistence>) {
  return {
    accounting: canonicalAccounting(record.accounting),
    shadowDrafts: record.shadowDrafts,
    criticDecisions: record.criticDecisions,
    stageDurations: record.stageDurations,
  };
}

async function completionFingerprint(
  input: SaveAnalysisCompletionInput,
  persistence: ReturnType<typeof normalizeInsightAccountingPersistence>,
): Promise<string> {
  const opportunities = [...input.opportunities].sort((left, right) => {
    const leftJson = stableJson(left);
    const rightJson = stableJson(right);
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
  });
  const canonicalSnapshot = {
    ...input.insightSnapshot,
    accounting: canonicalAccounting(input.insightSnapshot.accounting),
  };
  const canonical = stableJson({
    evidence: input.evidence,
    insightSnapshot: canonicalSnapshot,
    opportunities,
    run: input.run,
    accounting: canonicalPersistence(persistence),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

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

/**
 * Validate and ownership-check the complete reviewed draft before writing any
 * row, then persist it through the database's transactional batch boundary.
 */
export async function upsertServicesAtomic(
  t: TenantScope,
  services: readonly Service[],
): Promise<void> {
  const parsed = services.map((service) => ServiceSchema.parse(service));
  const owners = await Promise.all(
    parsed.map((service) =>
      t.db
        .prepare("SELECT workspace_id FROM services WHERE id = ?")
        .bind(service.id)
        .first<{ workspace_id: string }>(),
    ),
  );
  for (let index = 0; index < parsed.length; index++) {
    const owner = owners[index];
    if (owner && owner.workspace_id !== t.workspaceId) {
      throw new CrossWorkspaceError(`service ${parsed[index]!.id} belongs to another workspace`);
    }
  }
  if (parsed.length === 0) return;

  const updatedAt = nowIso();
  await t.db.batch(
    parsed.map((service) => ({
      sql: `INSERT INTO services (id, workspace_id, name, description, price_min, price_max, tags, active, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name, description = excluded.description,
              price_min = excluded.price_min, price_max = excluded.price_max,
              tags = excluded.tags, active = excluded.active, updated_at = excluded.updated_at
            WHERE services.workspace_id = ?`,
      params: [
        service.id,
        t.workspaceId,
        service.name,
        service.description,
        service.priceMin,
        service.priceMax,
        JSON.stringify(service.tags),
        service.active ? 1 : 0,
        updatedAt,
        t.workspaceId,
      ],
    })),
  );
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
  average_job_value: number | null;
  notes: string;
}

function toClient(row: ClientRow): Client {
  return ClientSchema.parse({
    id: row.id,
    name: row.name,
    domain: row.domain,
    offerings: JSON.parse(row.offerings) as string[],
    averageJobValue: row.average_job_value ?? undefined,
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
      `INSERT INTO clients (id, workspace_id, name, domain, offerings, average_job_value, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, domain = excluded.domain, offerings = excluded.offerings,
         average_job_value = excluded.average_job_value,
         notes = excluded.notes, updated_at = excluded.updated_at
       WHERE clients.workspace_id = ?`,
    )
    .bind(
      c.id,
      t.workspaceId,
      c.name,
      c.domain,
      JSON.stringify(c.offerings),
      c.averageJobValue ?? null,
      c.notes,
      nowIso(),
      t.workspaceId,
    )
    .run();
}

// ---------------------------------------------------------------------------
// owner-authorized external business evidence
// ---------------------------------------------------------------------------
interface ExternalBusinessClaimRow {
  id: string;
  workspace_id: string;
  client_id: string;
  provider: string;
  source_record_id: string;
  source_url: string;
  authorization: string;
  raw_service_label: string;
  source_field: string;
  observed_at: string;
  retrieved_at: string;
  source_hash: string;
  source_version: string | null;
  normalized_label: string;
  semantic_state: string;
  semantic_reason: string;
}

function toExternalBusinessClaim(row: ExternalBusinessClaimRow): ExternalBusinessClaim {
  return ExternalBusinessClaimSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    clientId: row.client_id,
    provider: row.provider,
    sourceRecordId: row.source_record_id,
    sourceUrl: row.source_url,
    authorization: row.authorization,
    rawServiceLabel: row.raw_service_label,
    sourceField: row.source_field,
    observedAt: row.observed_at,
    retrievedAt: row.retrieved_at,
    sourceHash: row.source_hash,
    sourceVersion: row.source_version ?? undefined,
    normalizedLabel: row.normalized_label,
    semanticState: row.semantic_state,
    semanticReason: row.semantic_reason,
  });
}

/** Save provenance rows only; this never creates or updates an opportunity. */
export async function saveExternalBusinessClaims(
  t: TenantScope,
  claims: ExternalBusinessClaim[],
): Promise<void> {
  for (const raw of claims) {
    const claim = ExternalBusinessClaimSchema.parse(raw);
    validateExternalBusinessClaimProvenance(claim);
    if (claim.workspaceId !== t.workspaceId) {
      throw new CrossWorkspaceError(`external claim ${claim.id} belongs to another workspace`);
    }
    if (!(await existsInWorkspace(t, "clients", claim.clientId))) {
      throw new CrossWorkspaceError(`external claim client ${claim.clientId} not in this workspace`);
    }
    const existing = await t.db
      .prepare("SELECT * FROM external_business_claims WHERE id = ?")
      .bind(claim.id)
      .first<ExternalBusinessClaimRow>();
    if (existing && existing.workspace_id !== t.workspaceId) {
      throw new CrossWorkspaceError(`external claim ${claim.id} belongs to another workspace`);
    }
    if (existing) {
      const persisted = toExternalBusinessClaim(existing);
      if (JSON.stringify(persisted) === JSON.stringify(claim)) continue;
      throw new Error(`external claim ID collision for ${claim.id}`);
    }
    await t.db
      .prepare(
        `INSERT INTO external_business_claims (
           id, workspace_id, client_id, provider, source_record_id, source_url,
           authorization, raw_service_label, source_field, observed_at, retrieved_at,
           source_hash, source_version, normalized_label, semantic_state, semantic_reason
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        claim.id,
        claim.workspaceId,
        claim.clientId,
        claim.provider,
        claim.sourceRecordId,
        claim.sourceUrl,
        claim.authorization,
        claim.rawServiceLabel,
        claim.sourceField,
        claim.observedAt,
        claim.retrievedAt,
        claim.sourceHash,
        claim.sourceVersion ?? null,
        claim.normalizedLabel,
        claim.semanticState,
        claim.semanticReason,
      )
      .run();
  }
}

export async function listExternalBusinessClaims(
  t: TenantScope,
  clientId: string,
): Promise<ExternalBusinessClaim[]> {
  const rows = await t.db
    .prepare(
      `SELECT * FROM external_business_claims
       WHERE client_id = ? AND workspace_id = ?
       ORDER BY retrieved_at DESC, id ASC`,
    )
    .bind(clientId, t.workspaceId)
    .all<ExternalBusinessClaimRow>();
  return rows.map(toExternalBusinessClaim);
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

/**
 * Mark a service covered for this client and reconcile any existing findings
 * that map to it. Coverage is authoritative: leaving an older finding marked
 * billable would let it leak into open counts until someone re-ran analysis.
 *
 * Returns false when the client or service is not in this workspace.
 */
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
  await t.db
    .prepare(
      `UPDATE opportunities
       SET billable_status = 'already_covered', status = 'already_covered',
           snooze_until = NULL, updated_at = ?
       WHERE workspace_id = ? AND client_id = ? AND suggested_service_id = ?
         -- Coverage is authoritative over open work only. Terminal commercial
         -- outcomes (sold/lost/dismissed) are history; resolved is the client's
         -- fix; superseded is bookkeeping. None may be rewritten here.
         AND status NOT IN ('sold', 'lost', 'dismissed', 'resolved', 'superseded')`,
    )
    .bind(nowIso(), t.workspaceId, clientId, serviceId)
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

/** Remove coverage and restore findings to the last durable review stage. */
export async function removeCoverageAndReopen(
  t: TenantScope,
  clientId: string,
  serviceId: string,
): Promise<{ removed: boolean; reopened: number }> {
  const now = nowIso();
  const [removed, reopened] = await t.db.batch([
    {
      sql: "DELETE FROM client_coverage WHERE client_id = ? AND service_id = ? AND workspace_id = ?",
      params: [clientId, serviceId, t.workspaceId],
    },
    {
      sql: `UPDATE opportunities
            SET billable_status = 'billable',
                status = CASE
                  WHEN dismissed_at IS NOT NULL THEN 'dismissed'
                  WHEN pitched_at IS NOT NULL THEN 'pitched'
                  WHEN proposal_prepared_at IS NOT NULL OR proposal_md IS NOT NULL
                    THEN 'proposal_prepared'
                  WHEN accepted_at IS NOT NULL THEN 'accepted'
                  ELSE 'new'
                END,
                snooze_until = NULL,
                updated_at = ?
            WHERE workspace_id = ? AND client_id = ? AND suggested_service_id = ?
              AND status = 'already_covered' AND billable_status = 'already_covered'`,
      params: [now, t.workspaceId, clientId, serviceId],
    },
  ]);
  return { removed: removed!.rowsAffected > 0, reopened: reopened!.rowsAffected };
}

// ---------------------------------------------------------------------------
// evidence bundle cache
// ---------------------------------------------------------------------------
interface EvidenceRow {
  bundle: string;
}

interface EvidenceByClientRow extends EvidenceRow {
  client_id: string;
}

function evidenceStatement(
  t: TenantScope,
  bundle: EvidenceBundle,
): { sql: string; params: SqlValue[] } {
  return {
    sql: `INSERT INTO evidence_bundles (workspace_id, client_id, source, captured_at, bundle)
          VALUES (?, ?, ?, ?, ?)`,
    params: [
      t.workspaceId,
      bundle.clientId,
      bundle.source,
      bundle.capturedAt,
      JSON.stringify(bundle),
    ],
  };
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

export const LATEST_EVIDENCE_BY_CLIENT_SQL = `SELECT client_id, bundle
       FROM (
         SELECT client_id, bundle,
                ROW_NUMBER() OVER (
                  PARTITION BY client_id
                  ORDER BY captured_at DESC, id DESC
                ) AS evidence_rank
         FROM evidence_bundles
         WHERE workspace_id = ?
       ) AS latest_evidence
       WHERE evidence_rank = 1
       ORDER BY client_id ASC`;

/** Latest evidence for every client in one tenant-scoped query. */
export async function latestEvidenceByClient(
  t: TenantScope,
): Promise<Map<string, EvidenceBundle>> {
  const rows = await t.db
    .prepare(LATEST_EVIDENCE_BY_CLIENT_SQL)
    .bind(t.workspaceId)
    .all<EvidenceByClientRow>();
  const latest = new Map<string, EvidenceBundle>();
  for (const row of rows) {
    latest.set(row.client_id, EvidenceBundleSchema.parse(JSON.parse(row.bundle)));
  }
  return latest;
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
  suppressed_evidence_refs: string;
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
  sold_amount: number | null;
  sold_at: string | null;
  accepted_at: string | null;
  proposal_prepared_at: string | null;
  pitched_at: string | null;
  lost_at: string | null;
  dismissed_at: string | null;
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
    suppressedEvidenceRefs: JSON.parse(row.suppressed_evidence_refs) as string[],
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
    soldAmount: row.sold_amount ?? undefined,
    soldAt: row.sold_at ?? undefined,
    acceptedAt: row.accepted_at ?? undefined,
    proposalPreparedAt: row.proposal_prepared_at ?? undefined,
    pitchedAt: row.pitched_at ?? undefined,
    lostAt: row.lost_at ?? undefined,
    dismissedAt: row.dismissed_at ?? undefined,
    updatedAt: row.updated_at,
  });
}

export async function listOpportunities(
  t: TenantScope,
  clientId: string,
): Promise<Opportunity[]> {
  const rows = await t.db
    .prepare(
      "SELECT * FROM opportunities WHERE client_id = ? AND workspace_id = ? AND status <> 'superseded' ORDER BY confidence DESC, title",
    )
    .bind(clientId, t.workspaceId)
    .all<OpportunityRow>();
  return rows.map(toOpportunity);
}

/**
 * Every opportunity in the workspace, grouped by client, in one query.
 *
 * The portfolio surfaces need all of them at once; asking per client turned the
 * feed into one round trip per client, which on D1 is the difference between a
 * fast page and a visibly slow one as a portfolio grows.
 */
export async function listOpportunitiesByClient(
  t: TenantScope,
): Promise<Map<string, Opportunity[]>> {
  const rows = await t.db
    .prepare(
      "SELECT * FROM opportunities WHERE workspace_id = ? AND status <> 'superseded' ORDER BY client_id, confidence DESC, title",
    )
    .bind(t.workspaceId)
    .all<OpportunityRow>();
  const grouped = new Map<string, Opportunity[]>();
  for (const row of rows) {
    const list = grouped.get(row.client_id);
    if (list) list.push(toOpportunity(row));
    else grouped.set(row.client_id, [toOpportunity(row)]);
  }
  return grouped;
}

export async function getOpportunity(t: TenantScope, id: string): Promise<Opportunity | null> {
  const row = await t.db
    .prepare("SELECT * FROM opportunities WHERE id = ? AND workspace_id = ? AND status <> 'superseded'")
    .bind(id, t.workspaceId)
    .first<OpportunityRow>();
  return row ? toOpportunity(row) : null;
}

async function upsertOpportunity(t: TenantScope, opp: Opportunity): Promise<void> {
  const o = OpportunitySchema.parse(opp);
  await t.db
    .prepare(
      `INSERT INTO opportunities (
         id, workspace_id, dedupe_key, client_id, rule_id, title, detected, evidence_refs, suppressed_evidence_refs, rationale,
         suggested_service_id, suggested_scope, price_min, price_max, confidence,
         billable_status, status, snooze_until, proposal_md, verification,
         conversion_defect, sold_amount, sold_at,
         accepted_at, proposal_prepared_at, pitched_at, lost_at, dismissed_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(client_id, dedupe_key) DO UPDATE SET
         title = excluded.title, detected = excluded.detected,
         evidence_refs = excluded.evidence_refs,
         suppressed_evidence_refs = excluded.suppressed_evidence_refs,
         rationale = excluded.rationale,
         suggested_service_id = excluded.suggested_service_id,
         suggested_scope = excluded.suggested_scope,
         price_min = excluded.price_min, price_max = excluded.price_max,
         confidence = excluded.confidence, billable_status = excluded.billable_status,
         status = excluded.status, snooze_until = excluded.snooze_until,
         proposal_md = excluded.proposal_md, verification = excluded.verification,
         conversion_defect = excluded.conversion_defect,
         sold_amount = excluded.sold_amount, sold_at = excluded.sold_at,
         accepted_at = excluded.accepted_at,
         proposal_prepared_at = excluded.proposal_prepared_at,
         pitched_at = excluded.pitched_at,
         lost_at = excluded.lost_at,
         dismissed_at = excluded.dismissed_at,
         updated_at = excluded.updated_at
       WHERE opportunities.workspace_id = ? AND opportunities.status <> 'superseded'`,
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
      JSON.stringify(o.suppressedEvidenceRefs),
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
      o.soldAmount ?? null,
      o.soldAt ?? null,
      o.acceptedAt ?? null,
      o.proposalPreparedAt ?? null,
      o.pitchedAt ?? null,
      o.lostAt ?? null,
      o.dismissedAt ?? null,
      o.updatedAt,
      t.workspaceId,
    )
    .run();
}

function opportunityStatement(
  t: TenantScope,
  opportunity: Opportunity,
): { sql: string; params: SqlValue[] } {
  const o = OpportunitySchema.parse(opportunity);
  return {
    sql: `INSERT INTO opportunities (
             id, workspace_id, dedupe_key, client_id, rule_id, title, detected, evidence_refs, suppressed_evidence_refs, rationale,
             suggested_service_id, suggested_scope, price_min, price_max, confidence,
             billable_status, status, snooze_until, proposal_md, verification,
             conversion_defect, sold_amount, sold_at,
             accepted_at, proposal_prepared_at, pitched_at, lost_at, dismissed_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(client_id, dedupe_key) DO UPDATE SET
             title = excluded.title, detected = excluded.detected,
             evidence_refs = excluded.evidence_refs,
             suppressed_evidence_refs = excluded.suppressed_evidence_refs,
             rationale = excluded.rationale,
             suggested_service_id = excluded.suggested_service_id,
             suggested_scope = excluded.suggested_scope,
             price_min = excluded.price_min, price_max = excluded.price_max,
             confidence = excluded.confidence, billable_status = excluded.billable_status,
             status = excluded.status, snooze_until = excluded.snooze_until,
             proposal_md = excluded.proposal_md, verification = excluded.verification,
             conversion_defect = excluded.conversion_defect,
             sold_amount = excluded.sold_amount, sold_at = excluded.sold_at,
             accepted_at = excluded.accepted_at,
             proposal_prepared_at = excluded.proposal_prepared_at,
             pitched_at = excluded.pitched_at,
             lost_at = excluded.lost_at,
             dismissed_at = excluded.dismissed_at,
             updated_at = excluded.updated_at
           WHERE opportunities.workspace_id = ? AND opportunities.status <> 'superseded'`,
    params: [
      o.id,
      t.workspaceId,
      o.dedupeKey,
      o.clientId,
      o.ruleId,
      o.title,
      o.detected,
      JSON.stringify(o.evidenceRefs),
      JSON.stringify(o.suppressedEvidenceRefs),
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
      o.soldAmount ?? null,
      o.soldAt ?? null,
      o.acceptedAt ?? null,
      o.proposalPreparedAt ?? null,
      o.pitchedAt ?? null,
      o.lostAt ?? null,
      o.dismissedAt ?? null,
      o.updatedAt,
      t.workspaceId,
    ],
  };
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
      `UPDATE opportunities
       SET status = ?, snooze_until = ?,
           suppressed_evidence_refs = CASE WHEN ? = 'new' THEN '[]' ELSE suppressed_evidence_refs END,
           -- Moving a finding to any other state un-sells it. Leaving the
           -- amount behind would quietly inflate every win rate computed from
           -- this table with a sale the agency has taken back.
           sold_amount = CASE WHEN ? = 'sold' THEN sold_amount ELSE NULL END,
           sold_at = CASE WHEN ? = 'sold' THEN sold_at ELSE NULL END,
           updated_at = ?
       WHERE id = ? AND workspace_id = ? AND status <> 'superseded'`,
    )
    .bind(status, snoozeUntil ?? null, status, status, status, nowIso(), id, t.workspaceId)
    .run();
  return r.rowsAffected > 0;
}

/**
 * Record that the agency sold this work.
 *
 * The amount is optional: knowing a finding sold is the signal that matters,
 * and demanding a number would cost that fact whenever someone does not have
 * one to hand. Scoped like every other write, and refused on a superseded row.
 */
export async function recordOpportunitySale(
  t: TenantScope,
  id: string,
  input: { amount?: number; at?: string } = {},
): Promise<boolean> {
  const amount =
    typeof input.amount === "number" && Number.isFinite(input.amount) && input.amount >= 0
      ? input.amount
      : null;
  const now = nowIso();
  const r = await t.db
    .prepare(
      `UPDATE opportunities
       SET status = 'sold', snooze_until = NULL, sold_amount = ?, sold_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND status <> 'superseded'`,
    )
    .bind(amount, input.at ?? now, now, id, t.workspaceId)
    .run();
  return r.rowsAffected > 0;
}

/**
 * Attach a freshly generated proposal and move the opportunity into
 * `proposal_prepared`.
 *
 * Deliberately scoped to opportunities that are still open and billable. A
 * dismissed, actively snoozed or already-covered finding must not be silently
 * resurrected into the feed as a side effect of drafting — the agency's decision
 * wins until they explicitly reopen it or its snooze ends. The route guards this
 * too; this is defence in depth.
 */
export async function setOpportunityProposal(
  t: TenantScope,
  id: string,
  proposalMd: string,
): Promise<boolean> {
  const now = nowIso();
  const r = await t.db
    .prepare(
      `UPDATE opportunities SET proposal_md = ?, status = 'proposal_prepared',
         -- First proposal implies acceptance; both milestones are first-time
         -- stamps that an edit or re-review must never reset. Mirrors
         -- applyFunnelTransition's prepare-proposal action.
         accepted_at = COALESCE(accepted_at, ?),
         proposal_prepared_at = COALESCE(proposal_prepared_at, ?),
         updated_at = ?
       WHERE id = ? AND workspace_id = ?
         AND billable_status = 'billable'
         AND status <> 'superseded'
         AND (
           status IN ('new', 'proposal_prepared')
           OR (status = 'snoozed' AND snooze_until IS NOT NULL AND snooze_until <= ?)
         )`,
    )
    .bind(proposalMd, now, now, now, id, t.workspaceId, now)
    .run();
  return r.rowsAffected > 0;
}

/** Save an edited draft without touching the agency's decision on the finding. */
export async function saveOpportunityProposalText(
  t: TenantScope,
  id: string,
  proposalMd: string,
): Promise<boolean> {
  const r = await t.db
    .prepare(
      "UPDATE opportunities SET proposal_md = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND status <> 'superseded'",
    )
    .bind(proposalMd, nowIso(), id, t.workspaceId)
    .run();
  return r.rowsAffected > 0;
}

// ---------------------------------------------------------------------------
// analysis runs (truthful per-run outcome)
// ---------------------------------------------------------------------------
interface AnalysisRunRow {
  id: number;
  client_id: string;
  started_at: string;
  finished_at: string;
  source: string;
  outcome: string;
  summary: string;
  limitation: string | null;
  pages_read: number;
  pages_fetched: number;
  blocked_events: number;
  inconclusive_events: number;
  surfaced: number;
  stats: string;
  trigger: string;
  new_count: number;
  resolved_count: number;
  evaluator_calls: number;
  evaluator_rejections: number;
  evaluator_errors: number;
  crawl_exhaustive: number;
  suggested_offerings: string;
  offering_drift: string;
}

/** What started a run. Scheduled runs are the only ones nobody was watching. */
export const RUN_TRIGGERS = ["manual", "scheduled"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export interface AnalysisRun {
  id: number;
  clientId: string;
  startedAt: string;
  finishedAt: string;
  source: string;
  outcome: AnalysisOutcome;
  summary: string;
  limitation: string | null;
  pagesRead: number;
  pagesFetched: number;
  blockedEvents: number;
  inconclusiveEvents: number;
  surfaced: number;
  stats: Record<string, number>;
  trigger: RunTrigger;
  /** Findings this run surfaced that the client did not already have open. */
  newCount: number;
  /** Previously open findings this run confirmed are gone. */
  resolvedCount: number;
  evaluatorCalls: number;
  /** Judged and not surfaced — the commercial gate working as intended. */
  evaluatorRejections: number;
  /** Evaluator threw. Failed closed; the run is incomplete. */
  evaluatorErrors: number;
  /** Whether the crawl reached every discovered page without a limitation. */
  crawlExhaustive: boolean;
  /** Service labels suggested from the evidence in this run. */
  suggestedOfferings: string[];
  /** Labels first seen relative to the previous exhaustive baseline. */
  offeringDrift: string[];
}

export type NewAnalysisRun = Omit<
  AnalysisRun,
  "id" | "crawlExhaustive" | "suggestedOfferings" | "offeringDrift"
> & {
  crawlExhaustive?: boolean;
  suggestedOfferings?: string[];
  offeringDrift?: string[];
};

export interface SaveAnalysisCompletionInput {
  evidence: EvidenceBundle;
  insightSnapshot: InsightSnapshot;
  shadowDrafts?: readonly unknown[];
  criticDecisions?: readonly unknown[];
  stageDurations?: unknown;
  opportunities: Opportunity[];
  run: NewAnalysisRun;
}

function validateAnalysisRunInput(run: NewAnalysisRun): NewAnalysisRun {
  if (!run || typeof run !== "object") throw new TypeError("Analysis run input is required.");
  for (const field of ["clientId", "startedAt", "finishedAt", "source", "summary", "trigger"] as const) {
    const value = run[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`Analysis run ${field} must be a non-empty string.`);
    }
  }
  if (!(ANALYSIS_OUTCOMES as readonly string[]).includes(run.outcome)) {
    throw new TypeError(`Analysis run outcome ${String(run.outcome)} is invalid.`);
  }
  if (!RUN_TRIGGERS.includes(run.trigger)) {
    throw new TypeError(`Analysis run trigger ${String(run.trigger)} is invalid.`);
  }
  if (run.limitation !== null && typeof run.limitation !== "string") {
    throw new TypeError("Analysis run limitation must be a string or null.");
  }
  if (!run.stats || typeof run.stats !== "object" || Array.isArray(run.stats)) {
    throw new TypeError("Analysis run stats must be an object.");
  }
  for (const [key, value] of Object.entries(run.stats)) {
    if (!key || typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError("Analysis run stats must contain finite numeric values.");
    }
  }
  for (const field of [
    "pagesRead",
    "pagesFetched",
    "blockedEvents",
    "inconclusiveEvents",
    "surfaced",
    "newCount",
    "resolvedCount",
    "evaluatorCalls",
    "evaluatorRejections",
    "evaluatorErrors",
  ] as const) {
    if (!Number.isInteger(run[field]) || run[field] < 0) {
      throw new TypeError(`Analysis run ${field} must be a non-negative integer.`);
    }
  }
  if (run.crawlExhaustive !== undefined && typeof run.crawlExhaustive !== "boolean") {
    throw new TypeError("Analysis run crawlExhaustive must be a boolean.");
  }
  if (run.suggestedOfferings !== undefined && !Array.isArray(run.suggestedOfferings)) {
    throw new TypeError("Analysis run suggestedOfferings must be an array.");
  }
  if (run.offeringDrift !== undefined && !Array.isArray(run.offeringDrift)) {
    throw new TypeError("Analysis run offeringDrift must be an array.");
  }
  return {
    ...run,
    crawlExhaustive: run.crawlExhaustive ?? false,
    suggestedOfferings: run.suggestedOfferings ?? [],
    offeringDrift: run.offeringDrift ?? [],
  };
}

function analysisRunStatement(
  t: TenantScope,
  run: NewAnalysisRun,
): { sql: string; params: SqlValue[] } {
  const normalized = validateAnalysisRunInput(run);
  return {
    sql: `INSERT INTO analysis_runs (
             workspace_id, client_id, started_at, finished_at, source, outcome, summary, limitation,
             pages_read, pages_fetched, blocked_events, inconclusive_events, surfaced, stats,
             trigger, new_count, resolved_count, evaluator_calls, evaluator_rejections, evaluator_errors,
             crawl_exhaustive, suggested_offerings, offering_drift
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      t.workspaceId,
      normalized.clientId,
      normalized.startedAt,
      normalized.finishedAt,
      normalized.source,
      normalized.outcome,
      normalized.summary,
      normalized.limitation ?? null,
      normalized.pagesRead,
      normalized.pagesFetched,
      normalized.blockedEvents,
      normalized.inconclusiveEvents,
      normalized.surfaced,
      JSON.stringify(normalized.stats),
      normalized.trigger,
      normalized.newCount,
      normalized.resolvedCount,
      normalized.evaluatorCalls,
      normalized.evaluatorRejections,
      normalized.evaluatorErrors,
      normalized.crawlExhaustive ? 1 : 0,
      JSON.stringify(normalized.suggestedOfferings ?? []),
      JSON.stringify(normalized.offeringDrift ?? []),
    ],
  };
}

function linkCompletionReservationStatement(
  t: TenantScope,
  reservationId: number,
  run: NewAnalysisRun,
  fingerprint: string,
): { sql: string; params: SqlValue[] } {
  return {
    sql: `UPDATE analysis_limit_reservations
          SET analysis_run_id = (
            SELECT id FROM analysis_runs
            WHERE workspace_id = ? AND client_id = ? AND started_at = ?
            ORDER BY id DESC LIMIT 1
          ), completion_fingerprint = ?,
          client_id = CASE
            WHEN analysis_run_id IS NULL
              AND finished_at IS NULL
              AND failed = 0
              AND stage NOT IN ('completed', 'completed_with_limitations', 'failed', 'unavailable', 'blocked')
              AND EXISTS (
                SELECT 1 FROM analysis_runs
                WHERE workspace_id = ? AND client_id = ? AND started_at = ?
              )
            THEN client_id
            ELSE NULL
          END
          WHERE workspace_id = ? AND id = ? AND client_id = ?`,
    params: [
      t.workspaceId,
      run.clientId,
      run.startedAt,
      fingerprint,
      t.workspaceId,
      run.clientId,
      run.startedAt,
      t.workspaceId,
      reservationId,
      run.clientId,
    ],
  };
}

function assertCompletionIdentity(
  t: TenantScope,
  evidence: EvidenceBundle,
  snapshot: InsightSnapshot,
  opportunities: readonly Opportunity[],
  run: NewAnalysisRun,
): void {
  if (evidence.clientId !== run.clientId || snapshot.clientId !== run.clientId) {
    throw new CrossWorkspaceError("analysis completion inputs disagree on client identity");
  }
  if (snapshot.workspaceId !== t.workspaceId) {
    throw new CrossWorkspaceError(`insight snapshot belongs to workspace ${snapshot.workspaceId}`);
  }
  if (snapshot.evidence.some((row) => row.runId !== snapshot.runId)) {
    throw new Error("Insight snapshot evidence must use its accepted reservation runId.");
  }
  if (
    snapshot.diagnostics.some(
      (row) => row.workspaceId !== t.workspaceId || row.runId !== snapshot.runId || row.clientId !== run.clientId,
    ) ||
    snapshot.problems.some(
      (row) => row.workspaceId !== t.workspaceId || row.runId !== snapshot.runId || row.clientId !== run.clientId,
    )
  ) {
    throw new CrossWorkspaceError("insight snapshot child rows cross the completion identity boundary");
  }
  if (opportunities.some((row) => row.clientId !== run.clientId)) {
    throw new CrossWorkspaceError("opportunity rows cross the completion client boundary");
  }
}

/**
 * Persist the evidence, typed insight snapshot, accounting, opportunities and
 * run row in one idempotent D1 batch, then link the accepted reservation. The
 * reservation id is the run identity used by all recovered insight children.
 */
export async function saveAnalysisCompletion(
  t: TenantScope,
  input: SaveAnalysisCompletionInput,
): Promise<number> {
  const evidence = EvidenceBundleSchema.parse(input.evidence);
  const insightSnapshot = InsightSnapshotSchema.parse(input.insightSnapshot);
  const opportunities = input.opportunities.map((row) => OpportunitySchema.parse(row));
  const run = validateAnalysisRunInput(input.run);
  assertCompletionIdentity(t, evidence, insightSnapshot, opportunities, run);
  const persistence = normalizeInsightAccountingPersistence(insightSnapshot, {
    shadowDrafts: input.shadowDrafts,
    criticDecisions: input.criticDecisions,
    stageDurations: input.stageDurations,
  } satisfies InsightAccountingPersistenceInput);
  const fingerprint = await completionFingerprint(
    { ...input, evidence, insightSnapshot, opportunities, run },
    persistence,
  );
  const reservationId = Number(insightSnapshot.runId);
  if (
    !Number.isSafeInteger(reservationId) ||
    reservationId < 1 ||
    String(reservationId) !== insightSnapshot.runId
  ) {
    throw new RangeError("Analysis completion runId must be its positive reservation id.");
  }

  const reservation = await t.db
    .prepare(
      `SELECT client_id, analysis_run_id, stage, finished_at, failed, completion_fingerprint
         FROM analysis_limit_reservations
        WHERE workspace_id = ? AND id = ?`,
    )
    .bind(t.workspaceId, reservationId)
    .first<{
      client_id: string;
      analysis_run_id: number | null;
      stage: string;
      finished_at: string | null;
      failed: number;
      completion_fingerprint: string | null;
    }>();
  if (!reservation || reservation.client_id !== run.clientId) {
    throw new CrossWorkspaceError(
      `analysis completion reservation ${insightSnapshot.runId} is not owned by client ${run.clientId}`,
    );
  }
  if (reservation.analysis_run_id !== null) {
    if (reservation.completion_fingerprint !== fingerprint) {
      throw new Error("Analysis completion retry conflicts with its accepted completion fingerprint.");
    }
    const linkedRun = await t.db
      .prepare(
        `SELECT id FROM analysis_runs
           WHERE id = ? AND workspace_id = ? AND client_id = ?`,
      )
      .bind(reservation.analysis_run_id, t.workspaceId, run.clientId)
      .first<{ id: number }>();
    if (!linkedRun) throw new Error("Analysis completion reservation points to an unknown terminal run.");
    return Number(linkedRun.id);
  }
  if (reservation.finished_at !== null || reservation.failed !== 0) {
    throw new Error("Analysis completion reservation is already terminal without a linked run.");
  }
  if (!(await existsInWorkspace(t, "clients", run.clientId))) {
    throw new CrossWorkspaceError(`analysis run for client ${run.clientId} not in this workspace`);
  }
  for (const row of opportunities) {
    if (!(await existsInWorkspace(t, "services", row.suggestedServiceId))) {
      throw new CrossWorkspaceError(
        `opportunity maps to service ${row.suggestedServiceId} not in this workspace`,
      );
    }
  }

  const accountingStatement = insightAccountingStatement(insightSnapshot, persistence);
  const statements = [
    evidenceStatement(t, evidence),
    ...insightSnapshotStatements(insightSnapshot).map((statement) => ({
      ...statement,
      params: statement.params as SqlValue[],
    })),
    { ...accountingStatement, params: accountingStatement.params as SqlValue[] },
    ...opportunities.map((row) => opportunityStatement(t, row)),
    analysisRunStatement(t, run),
    linkCompletionReservationStatement(t, reservationId, run, fingerprint),
  ];
  let results;
  try {
    results = await t.db.batch(statements);
  } catch (error) {
    const linkedAfterFailure = await t.db
      .prepare(
        `SELECT analysis_run_id, completion_fingerprint
           FROM analysis_limit_reservations
          WHERE workspace_id = ? AND id = ? AND client_id = ?`,
      )
      .bind(t.workspaceId, reservationId, run.clientId)
      .first<{ analysis_run_id: number | null; completion_fingerprint: string | null }>();
    if (linkedAfterFailure?.analysis_run_id !== null && linkedAfterFailure?.analysis_run_id !== undefined) {
      if (linkedAfterFailure.completion_fingerprint === fingerprint) return Number(linkedAfterFailure.analysis_run_id);
      throw new Error("Analysis completion raced with a conflicting completion.", { cause: error });
    }
    throw error;
  }
  const analysisRunResult = results[results.length - 2];
  const insertedRunId = analysisRunResult?.lastRowId && analysisRunResult.lastRowId > 0
    ? analysisRunResult.lastRowId
    : null;
  const linked = await t.db
    .prepare(
      `SELECT analysis_run_id, completion_fingerprint
         FROM analysis_limit_reservations
        WHERE workspace_id = ? AND id = ? AND client_id = ?`,
    )
    .bind(t.workspaceId, reservationId, run.clientId)
    .first<{ analysis_run_id: number | null; completion_fingerprint: string | null }>();
  if (linked?.analysis_run_id !== null && linked?.analysis_run_id !== undefined) {
    if (linked.completion_fingerprint !== fingerprint) {
      throw new Error("Analysis completion link has a conflicting completion fingerprint.");
    }
    return Number(linked.analysis_run_id);
  }
  throw new Error(
    insertedRunId === null
      ? "Analysis completion was written but its terminal run id was unavailable."
      : "Analysis completion was written but its reservation link could not be persisted.",
  );
}

function toAnalysisRun(row: AnalysisRunRow): AnalysisRun {
  const outcome = (ANALYSIS_OUTCOMES as readonly string[]).includes(row.outcome)
    ? (row.outcome as AnalysisOutcome)
    : "inconclusive";
  let stats: Record<string, number> = {};
  try {
    const parsed: unknown = JSON.parse(row.stats);
    if (parsed && typeof parsed === "object") stats = parsed as Record<string, number>;
  } catch {
    // A malformed stats blob is diagnostic only — never fail a page render on it.
  }
  return {
    id: row.id,
    clientId: row.client_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    source: row.source,
    outcome,
    summary: row.summary,
    limitation: row.limitation,
    pagesRead: row.pages_read,
    pagesFetched: row.pages_fetched,
    blockedEvents: row.blocked_events,
    inconclusiveEvents: row.inconclusive_events,
    surfaced: row.surfaced,
    stats,
    trigger: (RUN_TRIGGERS as readonly string[]).includes(row.trigger)
      ? (row.trigger as RunTrigger)
      : "manual",
    newCount: Number(row.new_count) || 0,
    resolvedCount: Number(row.resolved_count) || 0,
    evaluatorCalls: Number(row.evaluator_calls) || 0,
    evaluatorRejections: Number(row.evaluator_rejections) || 0,
    evaluatorErrors: Number(row.evaluator_errors) || 0,
    crawlExhaustive: row.crawl_exhaustive === 1,
    suggestedOfferings: parseOfferingLabels(row.suggested_offerings),
    offeringDrift: parseOfferingLabels(row.offering_drift),
  };
}

export async function recordAnalysisRun(t: TenantScope, run: NewAnalysisRun): Promise<void> {
  if (!(await existsInWorkspace(t, "clients", run.clientId))) {
    throw new CrossWorkspaceError(`analysis run for client ${run.clientId} not in this workspace`);
  }
  await t.db
    .prepare(
      `INSERT INTO analysis_runs (
         workspace_id, client_id, started_at, finished_at, source, outcome, summary, limitation,
         pages_read, pages_fetched, blocked_events, inconclusive_events, surfaced, stats,
         trigger, new_count, resolved_count, evaluator_calls, evaluator_rejections, evaluator_errors,
         crawl_exhaustive, suggested_offerings, offering_drift
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      t.workspaceId,
      run.clientId,
      run.startedAt,
      run.finishedAt,
      run.source,
      run.outcome,
      run.summary,
      run.limitation ?? null,
      run.pagesRead,
      run.pagesFetched,
      run.blockedEvents,
      run.inconclusiveEvents,
      run.surfaced,
      JSON.stringify(run.stats),
      run.trigger,
      run.newCount,
      run.resolvedCount,
      run.evaluatorCalls,
      run.evaluatorRejections,
      run.evaluatorErrors,
      run.crawlExhaustive ? 1 : 0,
      JSON.stringify(run.suggestedOfferings ?? []),
      JSON.stringify(run.offeringDrift ?? []),
    )
    .run();
}

/** The most recent exhaustive snapshot, regardless of whether it was manual or scheduled. */
export async function getLatestExhaustiveAnalysisRun(
  t: TenantScope,
  clientId: string,
): Promise<AnalysisRun | null> {
  const row = await t.db
    .prepare(
      `SELECT * FROM analysis_runs
       WHERE client_id = ? AND workspace_id = ? AND crawl_exhaustive = 1
       ORDER BY finished_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(clientId, t.workspaceId)
    .first<AnalysisRunRow>();
  return row ? toAnalysisRun(row) : null;
}

export async function getLatestAnalysisRun(
  t: TenantScope,
  clientId: string,
): Promise<AnalysisRun | null> {
  const row = await t.db
    .prepare(
      `SELECT * FROM analysis_runs
       WHERE client_id = ? AND workspace_id = ?
       ORDER BY finished_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(clientId, t.workspaceId)
    .first<AnalysisRunRow>();
  return row ? toAnalysisRun(row) : null;
}

/** Most recent runs first. Used for the client's analysis history. */
export async function listAnalysisRuns(
  t: TenantScope,
  clientId: string,
  limit = 8,
): Promise<AnalysisRun[]> {
  const rows = await t.db
    .prepare(
      `SELECT * FROM analysis_runs
       WHERE client_id = ? AND workspace_id = ?
       ORDER BY finished_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(clientId, t.workspaceId, Math.max(1, Math.min(50, Math.floor(limit))))
    .all<AnalysisRunRow>();
  return rows.map(toAnalysisRun);
}

/**
 * Latest run per client in one query. The portfolio views need this for every
 * client at once; issuing one query per client turned the feed into an N+1.
 */
export async function latestAnalysisRunByClient(
  t: TenantScope,
): Promise<Map<string, AnalysisRun>> {
  const rows = await t.db
    .prepare(
      // Correlated on purpose: an uncorrelated MAX(finished_at) + MAX(id) pair
      // can name a row that has neither, which silently surfaces a stale run.
      `SELECT r.* FROM analysis_runs r
       WHERE r.workspace_id = ?
         AND r.id = (
           SELECT i.id FROM analysis_runs i
           WHERE i.workspace_id = r.workspace_id AND i.client_id = r.client_id
           ORDER BY i.finished_at DESC, i.id DESC
           LIMIT 1
         )`,
    )
    .bind(t.workspaceId)
    .all<AnalysisRunRow>();
  return new Map(rows.map((row) => [row.client_id, toAnalysisRun(row)]));
}
