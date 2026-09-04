import type { SqlDb } from "@/db/sql";
import type { TenantScope } from "@/db/tenant";

/** Default minimum time between paid analysis starts for one client. */
export const ANALYSIS_CLIENT_COOLDOWN_MS = 5 * 60 * 1000;

/** Default maximum number of analysis starts per workspace UTC day. */
export const ANALYSIS_WORKSPACE_DAILY_LIMIT = 50;

export const ANALYSIS_LIMIT_CODES = ["client-cooldown", "workspace-daily-cap"] as const;
export type AnalysisLimitCode = (typeof ANALYSIS_LIMIT_CODES)[number];

export interface AnalysisLimit {
  code: AnalysisLimitCode;
  /** Plain language explanation suitable for a route notice. */
  reason: string;
  /** The first instant at which a retry can succeed, in UTC ISO format. */
  retryAt: string;
  /** Milliseconds from the attempted start until retryAt. */
  retryAfterMs: number;
}

export interface AnalysisLimitOptions {
  now?: Date;
  cooldownMs?: number;
  dailyLimit?: number;
}

export type AnalysisReservation =
  | {
      allowed: true;
      reservationId: number;
      reservedAt: string;
      dayUtc: string;
    }
  | {
      allowed: false;
      limitation: AnalysisLimit;
    };

/**
 * A typed admission failure raised by `runAnalysis` before any crawler or
 * evaluator work starts. The reservation ledger is intentionally append-only:
 * accepted starts remain counted even when the caller later fails.
 */
export class AnalysisLimitExceeded extends Error {
  readonly code: AnalysisLimitCode;
  readonly reason: string;
  readonly retryAt: string;
  readonly retryAfterMs: number;
  readonly limitation: AnalysisLimit;

  constructor(limitation: AnalysisLimit) {
    super(limitation.reason);
    this.name = "AnalysisLimitExceeded";
    this.code = limitation.code;
    this.reason = limitation.reason;
    this.retryAt = limitation.retryAt;
    this.retryAfterMs = limitation.retryAfterMs;
    this.limitation = limitation;
  }
}

export function isAnalysisLimitExceeded(value: unknown): value is AnalysisLimitExceeded {
  return value instanceof AnalysisLimitExceeded;
}

interface ReservationRow {
  id: number;
  reserved_at: string;
}

function validInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
  return resolved;
}

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function nextUtcMidnight(at: Date): Date {
  const next = new Date(at.getTime());
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function limitation(
  code: AnalysisLimitCode,
  reason: string,
  retryAtMs: number,
  nowMs: number,
): AnalysisLimit {
  const retryAfterMs = Math.max(0, retryAtMs - nowMs);
  return {
    code,
    reason,
    retryAt: new Date(retryAtMs).toISOString(),
    retryAfterMs,
  };
}

/**
 * Atomically reserve one analysis start for a client.
 *
 * The conditional INSERT is the concurrency boundary. D1/SQLite serializes a
 * write statement, so the cooldown and daily COUNT are evaluated together with
 * the insert; two parallel requests cannot both observe the same free slot.
 * Reservations reference the workspace only, deliberately retaining the daily
 * accounting row when a client is deleted and recreated.
 */
export async function reserveAnalysisStart(
  t: TenantScope,
  clientId: string,
  options: AnalysisLimitOptions = {},
): Promise<AnalysisReservation> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new RangeError("now must be a valid date");

  const cooldownMs = validInteger(
    options.cooldownMs,
    ANALYSIS_CLIENT_COOLDOWN_MS,
    "cooldownMs",
  );
  const dailyLimit = validInteger(
    options.dailyLimit,
    ANALYSIS_WORKSPACE_DAILY_LIMIT,
    "dailyLimit",
  );
  const reservedAt = now.toISOString();
  const day = utcDay(now);
  const cooldownBoundary = new Date(nowMs - cooldownMs).toISOString();

  const inserted = await t.db
    .prepare(
      `INSERT INTO analysis_limit_reservations (workspace_id, client_id, reserved_at, day_utc)
       SELECT ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM clients
         WHERE id = ? AND workspace_id = ?
       )
         AND NOT EXISTS (
           SELECT 1 FROM analysis_limit_reservations
           WHERE workspace_id = ? AND client_id = ? AND reserved_at > ?
         )
         AND (
           SELECT COUNT(*) FROM analysis_limit_reservations
           WHERE workspace_id = ? AND day_utc = ?
         ) < ?`,
    )
    .bind(
      t.workspaceId,
      clientId,
      reservedAt,
      day,
      clientId,
      t.workspaceId,
      t.workspaceId,
      clientId,
      cooldownBoundary,
      t.workspaceId,
      day,
      dailyLimit,
    )
    .run();

  if (inserted.rowsAffected > 0) {
    const row = await t.db
      .prepare(
        `SELECT id FROM analysis_limit_reservations
         WHERE workspace_id = ? AND client_id = ? AND reserved_at = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .bind(t.workspaceId, clientId, reservedAt)
      .first<{ id: number }>();
    // A successful insert always has a row. Keep the fallback defensive for a
    // non-conforming D1 adapter rather than returning an untyped null id.
    return {
      allowed: true,
      reservationId: Number(row?.id ?? 0),
      reservedAt,
      dayUtc: day,
    };
  }

  const [latest, count] = await Promise.all([
    t.db
      .prepare(
        `SELECT id, reserved_at FROM analysis_limit_reservations
         WHERE workspace_id = ? AND client_id = ?
         ORDER BY reserved_at DESC, id DESC LIMIT 1`,
      )
      .bind(t.workspaceId, clientId)
      .first<ReservationRow>(),
    t.db
      .prepare(
        `SELECT COUNT(*) AS count FROM analysis_limit_reservations
         WHERE workspace_id = ? AND day_utc = ?`,
      )
      .bind(t.workspaceId, day)
      .first<{ count: number }>(),
  ]);

  const cooldownRetryMs = latest
    ? Date.parse(latest.reserved_at) + cooldownMs
    : Number.NEGATIVE_INFINITY;
  const dailyRetryMs = Number(count?.count ?? 0) >= dailyLimit
    ? nextUtcMidnight(now).getTime()
    : Number.NEGATIVE_INFINITY;

  // If both gates are closed, retry only when BOTH are open. The later instant
  // is therefore the correct retry time; the reason names both constraints.
  if (cooldownRetryMs > nowMs && dailyRetryMs > nowMs) {
    const retryAtMs = Math.max(cooldownRetryMs, dailyRetryMs);
    return {
      allowed: false,
      limitation: limitation(
        retryAtMs === dailyRetryMs ? "workspace-daily-cap" : "client-cooldown",
        `This client was analyzed recently and this workspace has reached its daily analysis limit. Try again after ${new Date(retryAtMs).toISOString()}.`,
        retryAtMs,
        nowMs,
      ),
    };
  }

  if (dailyRetryMs > nowMs) {
    return {
      allowed: false,
      limitation: limitation(
        "workspace-daily-cap",
        `This workspace has reached its daily analysis limit. Try again after ${new Date(dailyRetryMs).toISOString()}.`,
        dailyRetryMs,
        nowMs,
      ),
    };
  }

  if (cooldownRetryMs > nowMs) {
    return {
      allowed: false,
      limitation: limitation(
        "client-cooldown",
        `This client was analyzed recently. Try again after ${new Date(cooldownRetryMs).toISOString()}.`,
        cooldownRetryMs,
        nowMs,
      ),
    };
  }

  // This normally means the client disappeared between the caller's lookup and
  // the atomic reservation. Return a typed limit-shaped failure rather than
  // pretending a run started; the route can show a normal notice.
  const retryAtMs = nowMs + 1_000;
  return {
    allowed: false,
    limitation: limitation(
      "client-cooldown",
      "This client could not be reserved for analysis. Try again shortly.",
      retryAtMs,
      nowMs,
    ),
  };
}

/** Reserve and throw the typed exception used by request-facing entry points. */
export async function requireAnalysisReservation(
  t: TenantScope,
  clientId: string,
  options: AnalysisLimitOptions = {},
): Promise<Extract<AnalysisReservation, { allowed: true }>> {
  const result = await reserveAnalysisStart(t, clientId, options);
  if (!result.allowed) throw new AnalysisLimitExceeded(result.limitation);
  return result;
}

/** Test/diagnostic helper for the append-only ledger. */
export async function countAnalysisReservations(
  t: TenantScope,
  input: { dayUtc?: string; clientId?: string } = {},
): Promise<number> {
  const clauses = ["workspace_id = ?"];
  const values: Array<string> = [t.workspaceId];
  if (input.dayUtc) {
    clauses.push("day_utc = ?");
    values.push(input.dayUtc);
  }
  if (input.clientId) {
    clauses.push("client_id = ?");
    values.push(input.clientId);
  }
  const row = await t.db
    .prepare(`SELECT COUNT(*) AS count FROM analysis_limit_reservations WHERE ${clauses.join(" AND ")}`)
    .bind(...values)
    .first<{ count: number }>();
  return Number(row?.count ?? 0) || 0;
}
