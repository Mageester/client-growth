import type { SqlDb } from "@/db/sql";
import type { TenantScope } from "@/db/tenant";

/** Default minimum time between paid analysis starts for one client. */
export const ANALYSIS_CLIENT_COOLDOWN_MS = 5 * 60 * 1000;

/** Default maximum number of analysis starts per workspace UTC day. */
export const ANALYSIS_WORKSPACE_DAILY_LIMIT = 50;

/**
 * Default maximum number of analysis starts across EVERY workspace in one UTC
 * day — the ceiling on the operator's own bill.
 *
 * The per-workspace cap bounds what one tenant can spend; it does nothing about
 * how many tenants there are. With open signup, `workspaces x 50` is unbounded,
 * so this is the only limit that is actually a limit. It is deliberately a
 * blunt instrument: crossing it pauses paid work for everyone until UTC
 * midnight, which is the correct failure for a runaway bill and the wrong one
 * for a healthy business — if real customers ever reach it, raise it knowingly
 * rather than discovering it from an invoice.
 */
export const ANALYSIS_PLATFORM_DAILY_LIMIT = 200;

export const ANALYSIS_LIMIT_CODES = [
  "client-cooldown",
  "workspace-daily-cap",
  "platform-daily-cap",
] as const;
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
  /** Starts allowed across all workspaces in one UTC day. */
  platformDailyLimit?: number;
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
  const platformDailyLimit = validInteger(
    options.platformDailyLimit,
    ANALYSIS_PLATFORM_DAILY_LIMIT,
    "platformDailyLimit",
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
         ) < ?
         AND (
           SELECT COUNT(*) FROM analysis_limit_reservations
           WHERE day_utc = ?
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
      day,
      platformDailyLimit,
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

  const [latest, count, platformCount] = await Promise.all([
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
    // Deliberately unscoped: the operator's bill is a property of the whole
    // service, not of one tenant. This reads a COUNT and nothing else — no row,
    // id, name or workspace of another tenant is selected, returned, or exposed
    // in the message built from it.
    t.db
      .prepare(
        `SELECT COUNT(*) AS count FROM analysis_limit_reservations WHERE day_utc = ?`,
      )
      .bind(day)
      .first<{ count: number }>(),
  ]);

  const midnightMs = nextUtcMidnight(now).getTime();
  const cooldownRetryMs = latest
    ? Date.parse(latest.reserved_at) + cooldownMs
    : Number.NEGATIVE_INFINITY;

  // Every closed gate, most-to-least general. Retry is only possible once ALL
  // of them are open, so the latest boundary is the real retry time; the code
  // reported is the broadest gate still shut, because that is the one the
  // reader can do least about and most needs to understand.
  const gates: Array<{ code: AnalysisLimitCode; retryAtMs: number; reason: string }> = [];
  if (Number(platformCount?.count ?? 0) >= platformDailyLimit) {
    gates.push({
      code: "platform-daily-cap",
      retryAtMs: midnightMs,
      reason: "analysis is paused across the service for the rest of today",
    });
  }
  if (Number(count?.count ?? 0) >= dailyLimit) {
    gates.push({
      code: "workspace-daily-cap",
      retryAtMs: midnightMs,
      reason: "this workspace has reached its daily analysis limit",
    });
  }
  if (cooldownRetryMs > nowMs) {
    gates.push({
      code: "client-cooldown",
      retryAtMs: cooldownRetryMs,
      reason: "this client was analyzed recently",
    });
  }

  if (gates.length > 0) {
    const retryAtMs = Math.max(...gates.map((gate) => gate.retryAtMs));
    const sentence = gates.map((gate) => gate.reason).join(" and ");
    return {
      allowed: false,
      limitation: limitation(
        gates[0]!.code,
        `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}. Try again after ${new Date(retryAtMs).toISOString()}.`,
        retryAtMs,
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
