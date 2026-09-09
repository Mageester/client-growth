import type { TenantScope } from "@/db/tenant";

/** Paid catalog-generation requests one workspace may start in a UTC day. */
export const CATALOG_AI_WORKSPACE_DAILY_LIMIT = 10;
/** Paid catalog-generation requests the whole platform may start in a UTC day. */
export const CATALOG_AI_PLATFORM_DAILY_LIMIT = 200;

export type CatalogGenerationLimitCode = "workspace-daily-cap" | "platform-daily-cap";

export interface CatalogGenerationLimit {
  code: CatalogGenerationLimitCode;
  reason: string;
  retryAt: string;
  retryAfterMs: number;
}

export interface CatalogGenerationLimitOptions {
  now?: Date;
  dailyLimit?: number;
  platformDailyLimit?: number;
}

export type CatalogGenerationAdmission =
  | { allowed: true; reservationId: number; reservedAt: string; dayUtc: string }
  | { allowed: false; limitation: CatalogGenerationLimit };

export class CatalogGenerationLimitExceeded extends Error {
  readonly limitation: CatalogGenerationLimit;
  readonly code: CatalogGenerationLimitCode;
  readonly retryAt: string;
  readonly retryAfterMs: number;

  constructor(limitation: CatalogGenerationLimit) {
    super(limitation.reason);
    this.name = "CatalogGenerationLimitExceeded";
    this.limitation = limitation;
    this.code = limitation.code;
    this.retryAt = limitation.retryAt;
    this.retryAfterMs = limitation.retryAfterMs;
  }
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return resolved;
}

function nextUtcMidnight(at: Date): Date {
  const next = new Date(at.getTime());
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * Atomically charge one generation attempt before the provider is called.
 * The conditional INSERT keeps simultaneous requests from oversubscribing
 * either ceiling. Reservations deliberately survive downstream failures.
 */
export async function reserveCatalogGeneration(
  t: TenantScope,
  options: CatalogGenerationLimitOptions = {},
): Promise<CatalogGenerationAdmission> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new RangeError("now must be a valid date");
  const dailyLimit = positiveInteger(
    options.dailyLimit,
    CATALOG_AI_WORKSPACE_DAILY_LIMIT,
    "dailyLimit",
  );
  const platformDailyLimit = positiveInteger(
    options.platformDailyLimit,
    CATALOG_AI_PLATFORM_DAILY_LIMIT,
    "platformDailyLimit",
  );
  const reservedAt = now.toISOString();
  const dayUtc = reservedAt.slice(0, 10);

  const inserted = await t.db
    .prepare(
      `INSERT INTO catalog_generation_reservations (workspace_id, reserved_at, day_utc)
       SELECT ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?)
         AND (
           SELECT COUNT(*) FROM catalog_generation_reservations
           WHERE workspace_id = ? AND day_utc = ?
         ) < ?
         AND (
           SELECT COUNT(*) FROM catalog_generation_reservations WHERE day_utc = ?
         ) < ?`,
    )
    .bind(
      t.workspaceId,
      reservedAt,
      dayUtc,
      t.workspaceId,
      t.workspaceId,
      dayUtc,
      dailyLimit,
      dayUtc,
      platformDailyLimit,
    )
    .run();

  if (inserted.rowsAffected > 0) {
    const row = await t.db
      .prepare(
        `SELECT id FROM catalog_generation_reservations
         WHERE workspace_id = ? AND reserved_at = ? ORDER BY id DESC LIMIT 1`,
      )
      .bind(t.workspaceId, reservedAt)
      .first<{ id: number }>();
    return { allowed: true, reservationId: Number(row?.id ?? 0), reservedAt, dayUtc };
  }

  const [workspaceCount, platformCount] = await Promise.all([
    t.db
      .prepare(
        `SELECT COUNT(*) AS count FROM catalog_generation_reservations
         WHERE workspace_id = ? AND day_utc = ?`,
      )
      .bind(t.workspaceId, dayUtc)
      .first<{ count: number }>(),
    t.db
      .prepare("SELECT COUNT(*) AS count FROM catalog_generation_reservations WHERE day_utc = ?")
      .bind(dayUtc)
      .first<{ count: number }>(),
  ]);
  const retryAt = nextUtcMidnight(now).toISOString();
  const platformLimited = Number(platformCount?.count ?? 0) >= platformDailyLimit;
  const code: CatalogGenerationLimitCode = platformLimited
    ? "platform-daily-cap"
    : "workspace-daily-cap";
  const reason = platformLimited
    ? `AI catalog generation is paused across the service for today. Try again after ${retryAt}.`
    : Number(workspaceCount?.count ?? 0) >= dailyLimit
      ? `This workspace has reached its daily AI catalog limit. Try again after ${retryAt}.`
      : "This workspace could not be reserved for AI catalog generation. Try again shortly.";

  return {
    allowed: false,
    limitation: {
      code,
      reason,
      retryAt,
      retryAfterMs: Math.max(0, Date.parse(retryAt) - nowMs),
    },
  };
}

export async function requireCatalogGenerationReservation(
  t: TenantScope,
  options: CatalogGenerationLimitOptions = {},
): Promise<Extract<CatalogGenerationAdmission, { allowed: true }>> {
  const admission = await reserveCatalogGeneration(t, options);
  if (!admission.allowed) throw new CatalogGenerationLimitExceeded(admission.limitation);
  return admission;
}

/** Test and operational diagnostic for one tenant's append-only ledger. */
export async function countCatalogGenerationReservations(
  t: TenantScope,
  input: { dayUtc?: string } = {},
): Promise<number> {
  const sql = input.dayUtc
    ? "SELECT COUNT(*) AS count FROM catalog_generation_reservations WHERE workspace_id = ? AND day_utc = ?"
    : "SELECT COUNT(*) AS count FROM catalog_generation_reservations WHERE workspace_id = ?";
  const row = await t.db
    .prepare(sql)
    .bind(...(input.dayUtc ? [t.workspaceId, input.dayUtc] : [t.workspaceId]))
    .first<{ count: number }>();
  return Number(row?.count ?? 0) || 0;
}
