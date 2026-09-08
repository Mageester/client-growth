import type {
  ClientReportPublicSnapshot,
  ClientReportStoredSnapshot,
} from "@/core/clientReport";
import { normalizeReportTheme } from "@/core/reportTheme";
import { normalizeAndValidateUrl } from "@/adapters/evidence/urlPolicy";
import * as repo from "@/db/repositories";
import type { SqlDb } from "@/db/sql";
import type { TenantScope } from "@/db/tenant";

/** A public report link remains readable for one month unless revoked first. */
export const CLIENT_REPORT_SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CLIENT_REPORT_SHARE_TTL_DAYS = 30;

const REPORTABLE_STATUSES = new Set(["new", "accepted", "proposal_prepared", "pitched"]);

export interface ClientReportRecord {
  reportId: string;
  workspaceId: string;
  clientId: string;
  createdByUserId: string;
  generatedAt: string;
  evidenceReviewedAt: string | null;
  snapshot: ClientReportStoredSnapshot;
}

export interface ClientReportShareCreated {
  shareId: string;
  reportId: string;
  /** Returned to the owner exactly once; only its SHA-256 digest is persisted. */
  token: string;
  createdAt: string;
  expiresAt: string;
  snapshot: ClientReportPublicSnapshot;
}

export interface ClientReportSharePublic {
  createdAt: string;
  expiresAt: string;
  snapshot: ClientReportPublicSnapshot;
}

export type ClientReportErrorCode =
  | "not-found"
  | "not-owner"
  | "invalid-snapshot"
  | "unavailable";

export class ClientReportError extends Error {
  readonly code: ClientReportErrorCode;

  constructor(code: ClientReportErrorCode, message: string) {
    super(message);
    this.name = "ClientReportError";
    this.code = code;
  }
}

export function isClientReportError(value: unknown): value is ClientReportError {
  return value instanceof ClientReportError;
}

interface ClientReportRow {
  id: string;
  workspace_id: string;
  client_id: string;
  created_by_user_id: string;
  generated_at: string;
  evidence_reviewed_at: string | null;
  snapshot: string;
}

interface ClientReportShareRow {
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  snapshot: string;
}

interface WorkspaceOwnerRow {
  owner_user_id: string;
}

interface OpportunityIntegrityRow {
  id: string;
  dedupe_key: string;
  rule_id: string;
  title: string;
  suggested_service_id: string;
  confidence: number;
  status: string;
  billable_status: string;
  price_min: number;
  price_max: number;
  detected: string;
  rationale: string;
  suggested_scope: string;
  evidence_refs: string;
  verification: string | null;
  conversion_defect: string | null;
}

function assertValidDate(value: Date): number {
  const time = value.getTime();
  if (!Number.isFinite(time)) throw new RangeError("now must be a valid date");
  return time;
}

function jsonOrNull(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseStoredSnapshot(value: string): ClientReportStoredSnapshot | null {
  try {
    const parsed = JSON.parse(value) as ClientReportStoredSnapshot;
    if (
      !parsed ||
      !parsed.public ||
      parsed.public.schemaVersion !== 1 ||
      typeof parsed.public.generatedAt !== "string" ||
      !parsed.public.agency ||
      typeof parsed.public.agency.name !== "string" ||
      (parsed.public.agency.logo !== null && typeof parsed.public.agency.logo !== "string") ||
      typeof parsed.public.preparedBy !== "string" ||
      (parsed.public.evidenceReviewedAt !== null && typeof parsed.public.evidenceReviewedAt !== "string") ||
      typeof parsed.public.notice !== "string" ||
      !parsed.public.executiveSummary ||
      typeof parsed.public.executiveSummary.recommendedProjectCount !== "number" ||
      !Array.isArray(parsed.public.limitations) ||
      !parsed.public.client ||
      typeof parsed.public.client.name !== "string" ||
      typeof parsed.public.client.domain !== "string" ||
      !Array.isArray(parsed.public.recommendedProjects) ||
      !Array.isArray(parsed.public.supportingProjects) ||
      !parsed.audit ||
      typeof parsed.audit.workspaceId !== "string" ||
      typeof parsed.audit.clientId !== "string" ||
      typeof parsed.audit.createdByUserId !== "string" ||
      !Array.isArray(parsed.audit.includedOpportunityIds) ||
      !Array.isArray(parsed.audit.includedOpportunities)
    ) {
      return null;
    }
    return {
      ...parsed,
      public: {
        ...parsed.public,
        agency: {
          ...parsed.public.agency,
          theme: normalizeReportTheme(parsed.public.agency.theme),
        },
      },
    };
  } catch {
    return null;
  }
}

/** Re-project the stored document at the public boundary, dropping audit data
 * and any future/internal properties even if a row is malformed or upgraded. */
function publicProjection(snapshot: ClientReportStoredSnapshot): ClientReportPublicSnapshot {
  const safeUrl = (value: string | null): string | null => {
    if (!value) return null;
    const result = normalizeAndValidateUrl(value);
    return result.ok ? result.url.toString() : null;
  };
  const safeLogo = (value: string | null): string | null => {
    if (!value) return null;
    if (/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]*={0,2}$/i.test(value)) return value;
    return safeUrl(value);
  };
  const project = (value: ClientReportPublicSnapshot["recommendedProjects"][number]) => ({
    title: value.title,
    rationale: value.rationale,
    observed: value.observed,
    scope: [...value.scope],
    findings: value.findings.map((finding) => ({
      title: finding.title,
      observed: finding.observed,
      evidence: finding.evidence.map((evidence) => ({
        label: evidence.label,
        url: safeUrl(evidence.url),
        note: evidence.note,
      })),
    })),
    underlyingOpportunityValue: value.underlyingOpportunityValue
      ? { min: value.underlyingOpportunityValue.min, max: value.underlyingOpportunityValue.max }
      : null,
    packagePrice: value.packagePrice
      ? { amount: value.packagePrice.amount, currency: "USD" as const }
      : null,
  });
  const value = snapshot.public;
  return {
    schemaVersion: 1,
    agency: {
      name: value.agency.name,
      logo: safeLogo(value.agency.logo),
      theme: normalizeReportTheme(value.agency.theme),
    },
    client: { name: value.client.name, domain: value.client.domain },
    preparedBy: value.preparedBy,
    generatedAt: value.generatedAt,
    evidenceReviewedAt: value.evidenceReviewedAt,
    notice: value.notice,
    executiveSummary: {
      recommendedProjectCount: value.executiveSummary.recommendedProjectCount,
      strongestCommercialArea: value.executiveSummary.strongestCommercialArea,
      underlyingOpportunityValue: value.executiveSummary.underlyingOpportunityValue
        ? {
            min: value.executiveSummary.underlyingOpportunityValue.min,
            max: value.executiveSummary.underlyingOpportunityValue.max,
          }
        : null,
    },
    recommendedProjects: value.recommendedProjects.map(project),
    supportingProjects: value.supportingProjects.map(project),
    agencyNote: value.agencyNote,
    nextStep: value.nextStep,
    limitations: [...value.limitations],
  };
}

function toRecord(row: ClientReportRow): ClientReportRecord | null {
  const snapshot = parseStoredSnapshot(row.snapshot);
  if (!snapshot) return null;
  return {
    reportId: row.id,
    workspaceId: row.workspace_id,
    clientId: row.client_id,
    createdByUserId: row.created_by_user_id,
    generatedAt: row.generated_at,
    evidenceReviewedAt: row.evidence_reviewed_at,
    snapshot,
  };
}

async function requireOwner(t: TenantScope, userId: string): Promise<void> {
  const workspace = await t.db
    .prepare("SELECT owner_user_id FROM workspaces WHERE id = ?")
    .bind(t.workspaceId)
    .first<WorkspaceOwnerRow>();
  if (!workspace) throw new ClientReportError("not-found", "Workspace not found.");
  if (!userId || workspace.owner_user_id !== userId) {
    throw new ClientReportError("not-owner", "Only the workspace owner can manage share links.");
  }
}

async function assertSnapshotIntegrity(
  t: TenantScope,
  clientId: string,
  createdByUserId: string,
  snapshot: ClientReportStoredSnapshot,
): Promise<void> {
  if (
    snapshot.audit.workspaceId !== t.workspaceId ||
    snapshot.audit.clientId !== clientId ||
    snapshot.audit.createdByUserId !== createdByUserId
  ) {
    throw new ClientReportError(
      "invalid-snapshot",
      "The report snapshot does not belong to this workspace and client.",
    );
  }

  const ids = snapshot.audit.includedOpportunityIds;
  const detailIds = snapshot.audit.includedOpportunities.map((opportunity) => opportunity.id);
  if (
    ids.length === 0 ||
    new Set(ids).size !== ids.length ||
    ids.length !== detailIds.length ||
    new Set(detailIds).size !== detailIds.length ||
    ids.some((id) => !detailIds.includes(id))
  ) {
    throw new ClientReportError("invalid-snapshot", "The report snapshot has invalid opportunity provenance.");
  }

  const placeholders = ids.map(() => "?").join(", ");
  const rows = await t.db
    .prepare(
      `SELECT id, title, status, billable_status, price_min, price_max, detected,
              dedupe_key, rule_id, suggested_service_id, confidence,
              rationale, suggested_scope, evidence_refs, verification, conversion_defect
       FROM opportunities
       WHERE workspace_id = ? AND client_id = ? AND id IN (${placeholders})`,
    )
    .bind(t.workspaceId, clientId, ...ids)
    .all<OpportunityIntegrityRow>();
  const persistedIds = new Set(rows.map((row) => row.id));
  if (persistedIds.size !== ids.length || ids.some((id) => !persistedIds.has(id))) {
    throw new ClientReportError(
      "invalid-snapshot",
      "The report includes an opportunity that is not available for this client.",
    );
  }

  const detailById = new Map(
    snapshot.audit.includedOpportunities.map((opportunity) => [opportunity.id, opportunity]),
  );
  const reportable = rows.every((row) => {
    if (row.billable_status !== "billable" || !REPORTABLE_STATUSES.has(row.status)) return false;
    if (!row.verification) return true;
    try {
      return (JSON.parse(row.verification) as { conclusion?: unknown }).conclusion === "absent";
    } catch {
      return false;
    }
  });
  if (!reportable) {
    throw new ClientReportError(
      "invalid-snapshot",
      "An included opportunity is no longer eligible for a client report.",
    );
  }
  const unchanged = rows.every((row) => {
    const detail = detailById.get(row.id);
    if (!detail) return false;
    return (
      row.dedupe_key === detail.dedupeKey &&
      row.rule_id === detail.ruleId &&
      row.title === detail.title &&
      row.suggested_service_id === detail.suggestedServiceId &&
      row.confidence === detail.confidence &&
      row.status === detail.status &&
      row.billable_status === detail.billableStatus &&
      row.price_min === detail.priceMin &&
      row.price_max === detail.priceMax &&
      row.detected === detail.detected &&
      row.rationale === detail.rationale &&
      row.suggested_scope === JSON.stringify(detail.suggestedScope) &&
      row.evidence_refs === JSON.stringify(detail.evidenceRefs) &&
      row.verification === jsonOrNull(detail.verification) &&
      row.conversion_defect === jsonOrNull(detail.conversionDefect)
    );
  });
  if (!unchanged) {
    throw new ClientReportError(
      "invalid-snapshot",
      "An included opportunity changed while the report was being prepared. Review it again before generating.",
    );
  }
}

export async function createClientReport(
  t: TenantScope,
  input: {
    clientId: string;
    createdByUserId: string;
    snapshot: ClientReportStoredSnapshot;
  },
): Promise<ClientReportRecord> {
  const client = await repo.getClient(t, input.clientId);
  if (!client) throw new ClientReportError("not-found", "Client not found.");
  await assertSnapshotIntegrity(t, input.clientId, input.createdByUserId, input.snapshot);

  const reportId = `report_${crypto.randomUUID().replace(/-/g, "")}`;
  const generatedAt = input.snapshot.public.generatedAt;
  const evidenceReviewedAt = input.snapshot.public.evidenceReviewedAt;
  const inserted = await t.db
    .prepare(
      `INSERT INTO client_report_snapshots
         (id, workspace_id, client_id, created_by_user_id, generated_at, evidence_reviewed_at, snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      reportId,
      t.workspaceId,
      client.id,
      input.createdByUserId,
      generatedAt,
      evidenceReviewedAt,
      JSON.stringify(input.snapshot),
    )
    .run();
  if (inserted.rowsAffected !== 1) {
    throw new ClientReportError("unavailable", "The report could not be saved. Try again.");
  }

  return {
    reportId,
    workspaceId: t.workspaceId,
    clientId: client.id,
    createdByUserId: input.createdByUserId,
    generatedAt,
    evidenceReviewedAt,
    snapshot: input.snapshot,
  };
}

export async function getClientReportById(
  t: TenantScope,
  reportId: string,
): Promise<ClientReportRecord | null> {
  const row = await t.db
    .prepare(
      `SELECT id, workspace_id, client_id, created_by_user_id, generated_at,
              evidence_reviewed_at, snapshot
       FROM client_report_snapshots
       WHERE id = ? AND workspace_id = ?
       LIMIT 1`,
    )
    .bind(reportId, t.workspaceId)
    .first<ClientReportRow>();
  return row ? toRecord(row) : null;
}

export async function createClientReportShare(
  t: TenantScope,
  reportId: string,
  input: { actingUserId: string; now?: Date },
): Promise<ClientReportShareCreated> {
  await requireOwner(t, input.actingUserId);
  const report = await getClientReportById(t, reportId);
  if (!report) throw new ClientReportError("not-found", "Report not found.");

  const now = input.now ?? new Date();
  const nowMs = assertValidDate(now);
  const createdAt = now.toISOString();
  const expiresAt = new Date(nowMs + CLIENT_REPORT_SHARE_TTL_MS).toISOString();

  for (let attempt = 0; attempt < 3; attempt++) {
    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const shareId = `report_share_${crypto.randomUUID().replace(/-/g, "")}`;
    const inserted = await t.db
      .prepare(
        `INSERT INTO client_report_shares
           (id, workspace_id, report_id, token_hash, created_by_user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        shareId,
        t.workspaceId,
        report.reportId,
        tokenHash,
        input.actingUserId,
        createdAt,
        expiresAt,
      )
      .run();
    if (inserted.rowsAffected === 1) {
      return {
        shareId,
        reportId: report.reportId,
        token,
        createdAt,
        expiresAt,
        snapshot: report.snapshot.public,
      };
    }
  }
  throw new ClientReportError("unavailable", "The report share link could not be created. Try again.");
}

/** Bare-handle lookup: the public route never resolves live tenant data. */
export async function getClientReportShareByToken(
  db: SqlDb,
  token: string,
  now = new Date(),
): Promise<ClientReportSharePublic | null> {
  if (!token || token.length > 128) return null;
  const nowMs = assertValidDate(now);
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.created_at, s.expires_at, s.revoked_at, r.snapshot
       FROM client_report_shares s
       JOIN client_report_snapshots r
         ON r.workspace_id = s.workspace_id AND r.id = s.report_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
       LIMIT 1`,
    )
    .bind(tokenHash, new Date(nowMs).toISOString())
    .first<ClientReportShareRow>();
  if (!row) return null;
  const parsed = parseStoredSnapshot(row.snapshot);
  if (!parsed) return null;
  try {
    return {
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      snapshot: publicProjection(parsed),
    };
  } catch {
    return null;
  }
}

export async function revokeClientReportShares(
  t: TenantScope,
  reportId: string,
  input: { actingUserId: string; now?: Date },
): Promise<number> {
  await requireOwner(t, input.actingUserId);
  const report = await getClientReportById(t, reportId);
  if (!report) throw new ClientReportError("not-found", "Report not found.");
  const now = input.now ?? new Date();
  assertValidDate(now);
  const result = await t.db
    .prepare(
      `UPDATE client_report_shares
       SET revoked_at = ?
       WHERE workspace_id = ? AND report_id = ? AND revoked_at IS NULL`,
    )
    .bind(now.toISOString(), t.workspaceId, report.reportId)
    .run();
  return result.rowsAffected;
}
