import type { Opportunity } from "@/core/schema";
import {
  DEFAULT_REPORT_THEME,
  isReportTheme,
  normalizeReportTheme,
  type ReportTheme,
} from "@/core/reportTheme";
import { normalizeAndValidateUrl } from "@/adapters/evidence/urlPolicy";
import * as repo from "@/db/repositories";
import type { SqlDb } from "@/db/sql";
import type { TenantScope } from "@/db/tenant";

/** A share remains readable for one month unless its owner revokes it first. */
export const PROPOSAL_SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PROPOSAL_SHARE_TTL_DAYS = 30;

/** Bound inline artwork before it can become part of a durable snapshot. */
export const MAX_PROPOSAL_LOGO_LENGTH = 512 * 1024;
const MAX_PUBLIC_LOGO_URL_LENGTH = 2_048;

export interface WorkspaceBranding {
  logo: string | null;
  reportTheme: ReportTheme;
  updatedAt: string | null;
}

export interface ProposalShareOpportunitySnapshot {
  id: string;
  title: string;
  detected: string;
  rationale: string;
  suggestedScope: string[];
  evidenceRefs: string[];
  priceMin: number;
  priceMax: number;
  confidence: number;
  serviceName: string | null;
}

/** Everything a public reader needs. It contains no live tenant identifiers. */
export interface ProposalShareSnapshot {
  agencyName: string;
  logo: string | null;
  preparedBy: string;
  clientName: string;
  clientDomain: string;
  proposalMd: string;
  opportunity: ProposalShareOpportunitySnapshot;
}

export interface ProposalShareCreated {
  shareId: string;
  /** Returned to the owner exactly once; only its digest is persisted. */
  token: string;
  createdAt: string;
  expiresAt: string;
  snapshot: ProposalShareSnapshot;
}

export interface ProposalSharePublic {
  shareId: string;
  createdAt: string;
  expiresAt: string;
  snapshot: ProposalShareSnapshot;
}

export interface ProposalShareSummary {
  shareId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export type ProposalShareErrorCode =
  | "not-found"
  | "draft-required"
  | "not-owner"
  | "invalid-branding"
  | "unavailable";

export class ProposalShareError extends Error {
  readonly code: ProposalShareErrorCode;

  constructor(code: ProposalShareErrorCode, message: string) {
    super(message);
    this.name = "ProposalShareError";
    this.code = code;
  }
}

export function isProposalShareError(value: unknown): value is ProposalShareError {
  return value instanceof ProposalShareError;
}

type LogoValidation =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * Validate a logo without resolving or fetching it. Inline PNG/JPEG data URLs
 * are preferred; external artwork is restricted to a public HTTPS origin and
 * is only fetched by the viewer's browser after the share is opened.
 */
export function validateLogo(input: unknown): LogoValidation {
  if (input === undefined || input === null || input === "") {
    return { ok: true, value: null };
  }
  if (typeof input !== "string") {
    return { ok: false, error: "Logo must be a PNG or JPEG image." };
  }

  const value = input.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > MAX_PROPOSAL_LOGO_LENGTH) {
    return { ok: false, error: "Logo is too large. Use a PNG or JPEG under 512 KB." };
  }

  const dataUrl = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (dataUrl) {
    const payload = dataUrl[2] ?? "";
    if (!payload || payload.length % 4 === 1) {
      return { ok: false, error: "Logo data is not valid base64 PNG or JPEG data." };
    }
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(payload), (character) => character.charCodeAt(0));
    } catch {
      return { ok: false, error: "Logo data is not valid base64 PNG or JPEG data." };
    }
    const isPng = dataUrl[1]?.toLowerCase() === "image/png";
    const signature = isPng
      ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      : [0xff, 0xd8, 0xff];
    if (!signature.every((byte, index) => bytes[index] === byte)) {
      return { ok: false, error: "Logo data does not contain a valid PNG or JPEG image." };
    }
    return { ok: true, value };
  }

  if (value.length > MAX_PUBLIC_LOGO_URL_LENGTH) {
    return { ok: false, error: "Logo URL is too long." };
  }
  const policy = normalizeAndValidateUrl(value);
  if (!policy.ok || policy.url.protocol !== "https:") {
    return { ok: false, error: "Logo URL must use a public HTTPS origin." };
  }
  return { ok: true, value: policy.url.toString() };
}

interface WorkspaceBrandingRow {
  logo: string | null;
  report_theme?: string | null;
  updated_at: string;
}

async function readWorkspaceBranding(t: TenantScope): Promise<{
  branding: WorkspaceBranding;
  hasReportThemeColumn: boolean;
}> {
  const columns = await t.db
    .prepare("PRAGMA table_info(workspace_branding)")
    .all<{ name: string }>();
  const hasReportThemeColumn = columns.some((column) => column.name === "report_theme");
  const row = await t.db
    .prepare(
      hasReportThemeColumn
        ? "SELECT logo, report_theme, updated_at FROM workspace_branding WHERE workspace_id = ?"
        : "SELECT logo, updated_at FROM workspace_branding WHERE workspace_id = ?",
    )
    .bind(t.workspaceId)
    .first<WorkspaceBrandingRow>();
  return {
    branding: {
      logo: row?.logo ?? null,
      reportTheme: normalizeReportTheme(row?.report_theme),
      updatedAt: row?.updated_at ?? null,
    },
    hasReportThemeColumn,
  };
}

export async function getWorkspaceBranding(t: TenantScope): Promise<WorkspaceBranding> {
  return (await readWorkspaceBranding(t)).branding;
}

export async function saveWorkspaceBranding(
  t: TenantScope,
  input: { logo?: unknown; reportTheme?: unknown },
): Promise<WorkspaceBranding> {
  const { branding: current, hasReportThemeColumn } = await readWorkspaceBranding(t);
  const checkedLogo = input.logo === undefined
    ? { ok: true as const, value: current.logo }
    : validateLogo(input.logo);
  if (!checkedLogo.ok) throw new ProposalShareError("invalid-branding", checkedLogo.error);
  const reportTheme = input.reportTheme === undefined
    ? current.reportTheme
    : isReportTheme(input.reportTheme)
      ? input.reportTheme
      : null;
  if (!reportTheme) {
    throw new ProposalShareError("invalid-branding", "Choose one of the available report styles.");
  }
  if (!hasReportThemeColumn) {
    if (input.reportTheme !== undefined && reportTheme !== DEFAULT_REPORT_THEME) {
      throw new ProposalShareError(
        "invalid-branding",
        "Report styles are not available until the reports update is complete.",
      );
    }
    const updatedAt = new Date().toISOString();
    await t.db
      .prepare(
        `INSERT INTO workspace_branding (workspace_id, logo, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET
           logo = excluded.logo,
           updated_at = excluded.updated_at`,
      )
      .bind(t.workspaceId, checkedLogo.value, updatedAt)
      .run();
    return { logo: checkedLogo.value, reportTheme: DEFAULT_REPORT_THEME, updatedAt };
  }
  const updatedAt = new Date().toISOString();
  await t.db
    .prepare(
      `INSERT INTO workspace_branding (workspace_id, logo, report_theme, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         logo = excluded.logo,
         report_theme = excluded.report_theme,
         updated_at = excluded.updated_at`,
    )
    .bind(t.workspaceId, checkedLogo.value, reportTheme, updatedAt)
    .run();
  return { logo: checkedLogo.value, reportTheme, updatedAt };
}

interface WorkspaceOwnerRow {
  name: string;
  owner_user_id: string;
}

async function requireOwner(t: TenantScope, userId: string): Promise<WorkspaceOwnerRow> {
  const workspace = await t.db
    .prepare("SELECT name, owner_user_id FROM workspaces WHERE id = ?")
    .bind(t.workspaceId)
    .first<WorkspaceOwnerRow>();
  if (!workspace) throw new ProposalShareError("not-found", "Workspace not found.");
  if (!userId || workspace.owner_user_id !== userId) {
    throw new ProposalShareError("not-owner", "Only the workspace owner can manage share links.");
  }
  return workspace;
}

function assertValidDate(value: Date): number {
  const time = value.getTime();
  if (!Number.isFinite(time)) throw new RangeError("now must be a valid date");
  return time;
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

function buildSnapshot(input: {
  agencyName: string;
  logo: string | null;
  preparedBy: string;
  client: { name: string; domain: string };
  opportunity: Opportunity;
  serviceName: string | null;
}): ProposalShareSnapshot {
  return {
    agencyName: input.agencyName,
    logo: input.logo,
    preparedBy: input.preparedBy.trim() || "Axiom Orbit",
    clientName: input.client.name,
    clientDomain: input.client.domain,
    proposalMd: input.opportunity.proposalMd ?? "",
    opportunity: {
      id: input.opportunity.id,
      title: input.opportunity.title,
      detected: input.opportunity.detected,
      rationale: input.opportunity.rationale,
      suggestedScope: [...input.opportunity.suggestedScope],
      evidenceRefs: [...input.opportunity.evidenceRefs],
      priceMin: input.opportunity.priceMin,
      priceMax: input.opportunity.priceMax,
      confidence: input.opportunity.confidence,
      serviceName: input.serviceName,
    },
  };
}

export async function createProposalShare(
  t: TenantScope,
  opportunityId: string,
  input: { createdByUserId: string; preparedBy: string; now?: Date },
): Promise<ProposalShareCreated> {
  const workspace = await requireOwner(t, input.createdByUserId);
  const now = input.now ?? new Date();
  const nowMs = assertValidDate(now);
  const createdAt = now.toISOString();
  const expiresAt = new Date(nowMs + PROPOSAL_SHARE_TTL_MS).toISOString();
  const opportunity = await repo.getOpportunity(t, opportunityId);
  if (!opportunity) throw new ProposalShareError("not-found", "Opportunity not found.");
  if (
    opportunity.status !== "proposal_prepared" ||
    opportunity.billableStatus !== "billable" ||
    !opportunity.proposalMd?.trim()
  ) {
    throw new ProposalShareError(
      "draft-required",
      "Only a saved proposal draft can be shared. Prepare and save the proposal first.",
    );
  }

  const [client, service, branding] = await Promise.all([
    repo.getClient(t, opportunity.clientId),
    repo.getService(t, opportunity.suggestedServiceId),
    getWorkspaceBranding(t),
  ]);
  if (!client) throw new ProposalShareError("not-found", "Client not found.");
  const snapshot = buildSnapshot({
    agencyName: workspace.name,
    logo: branding.logo,
    preparedBy: input.preparedBy,
    client,
    opportunity,
    serviceName: service?.name ?? null,
  });

  // A duplicate token is cryptographically implausible, but retrying keeps the
  // unique digest constraint a clear invariant even under a mocked RNG.
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const shareId = crypto.randomUUID();
    const inserted = await t.db
      .prepare(
        `INSERT INTO proposal_shares
           (id, workspace_id, opportunity_id, token_hash, snapshot, created_by_user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        shareId,
        t.workspaceId,
        opportunity.id,
        tokenHash,
        JSON.stringify(snapshot),
        input.createdByUserId,
        createdAt,
        expiresAt,
      )
      .run();
    if (inserted.rowsAffected === 1) {
      return { shareId, token, createdAt, expiresAt, snapshot };
    }
  }
  throw new ProposalShareError("unavailable", "The share link could not be created. Try again.");
}

interface ProposalShareRow {
  id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  snapshot: string;
}

function parseSnapshot(value: string): ProposalShareSnapshot | null {
  try {
    const parsed = JSON.parse(value) as ProposalShareSnapshot;
    if (
      !parsed ||
      typeof parsed.agencyName !== "string" ||
      typeof parsed.preparedBy !== "string" ||
      typeof parsed.clientName !== "string" ||
      typeof parsed.clientDomain !== "string" ||
      typeof parsed.proposalMd !== "string" ||
      (parsed.logo !== null && typeof parsed.logo !== "string") ||
      !parsed.opportunity ||
      typeof parsed.opportunity.title !== "string" ||
      !Array.isArray(parsed.opportunity.suggestedScope) ||
      !Array.isArray(parsed.opportunity.evidenceRefs)
    ) {
      return null;
    }
    const logo = validateLogo(parsed.logo);
    if (!logo.ok) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Public lookup deliberately accepts a bare DB handle and reads only the
 * share row. It never resolves workspace, client, service or opportunity data.
 */
export async function getProposalShareByToken(
  db: SqlDb,
  token: string,
  now = new Date(),
): Promise<ProposalSharePublic | null> {
  if (!token || token.length > 128) return null;
  const nowMs = assertValidDate(now);
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT id, created_at, expires_at, revoked_at, snapshot
       FROM proposal_shares
       WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
       LIMIT 1`,
    )
    .bind(tokenHash, new Date(nowMs).toISOString())
    .first<ProposalShareRow>();
  if (!row) return null;
  const snapshot = parseSnapshot(row.snapshot);
  if (!snapshot) return null;
  return {
    shareId: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    snapshot,
  };
}

export async function listProposalShares(
  t: TenantScope,
  opportunityId: string,
): Promise<ProposalShareSummary[]> {
  const rows = await t.db
    .prepare(
      `SELECT id, created_at, expires_at, revoked_at
       FROM proposal_shares
       WHERE workspace_id = ? AND opportunity_id = ?
       ORDER BY created_at DESC, id DESC`,
    )
    .bind(t.workspaceId, opportunityId)
    .all<ProposalShareSummary & { id: string; created_at: string; expires_at: string; revoked_at: string | null }>();
  return rows.map((row) => ({
    shareId: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }));
}

export async function countActiveProposalShares(
  t: TenantScope,
  opportunityId: string,
  now = new Date(),
): Promise<number> {
  assertValidDate(now);
  const row = await t.db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM proposal_shares
       WHERE workspace_id = ? AND opportunity_id = ?
         AND revoked_at IS NULL AND expires_at > ?`,
    )
    .bind(t.workspaceId, opportunityId, now.toISOString())
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function revokeProposalShares(
  t: TenantScope,
  opportunityId: string,
  input: { actingUserId: string; now?: Date },
): Promise<number> {
  await requireOwner(t, input.actingUserId);
  const now = input.now ?? new Date();
  assertValidDate(now);
  const result = await t.db
    .prepare(
      `UPDATE proposal_shares
       SET revoked_at = ?
       WHERE workspace_id = ? AND opportunity_id = ? AND revoked_at IS NULL`,
    )
    .bind(now.toISOString(), t.workspaceId, opportunityId)
    .run();
  return result.rowsAffected;
}
