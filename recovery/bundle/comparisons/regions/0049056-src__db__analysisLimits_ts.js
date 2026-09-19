// src/db/analysisLimits.ts
var ANALYSIS_CLIENT_COOLDOWN_MS = 5 * 60 * 1e3;
var ANALYSIS_WORKSPACE_DAILY_LIMIT = 50;
var ANALYSIS_PLATFORM_DAILY_LIMIT = 200;
var AnalysisLimitExceeded = class extends Error {
  static {
    __name(this, "AnalysisLimitExceeded");
  }
  code;
  reason;
  retryAt;
  retryAfterMs;
  limitation;
  constructor(limitation3) {
    super(limitation3.reason);
    this.name = "AnalysisLimitExceeded";
    this.code = limitation3.code;
    this.reason = limitation3.reason;
    this.retryAt = limitation3.retryAt;
    this.retryAfterMs = limitation3.retryAfterMs;
    this.limitation = limitation3;
  }
};
function isAnalysisLimitExceeded(value) {
  return value instanceof AnalysisLimitExceeded;
}
__name(isAnalysisLimitExceeded, "isAnalysisLimitExceeded");
function validInteger(value, fallback, name) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
  return resolved;
}
__name(validInteger, "validInteger");
function utcDay(at) {
  return at.toISOString().slice(0, 10);
}
__name(utcDay, "utcDay");
function nextUtcMidnight(at) {
  const next = new Date(at.getTime());
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
__name(nextUtcMidnight, "nextUtcMidnight");
function limitation(code, reason, retryAtMs, nowMs) {
  const retryAfterMs = Math.max(0, retryAtMs - nowMs);
  return {
    code,
    reason,
    retryAt: new Date(retryAtMs).toISOString(),
    retryAfterMs
  };
}
__name(limitation, "limitation");
async function reserveAnalysisStart(t, clientId2, options = {}) {
  const now2 = options.now ?? /* @__PURE__ */ new Date();
  const nowMs = now2.getTime();
  if (!Number.isFinite(nowMs)) throw new RangeError("now must be a valid date");
  const cooldownMs = validInteger(
    options.cooldownMs,
    ANALYSIS_CLIENT_COOLDOWN_MS,
    "cooldownMs"
  );
  const dailyLimit = validInteger(
    options.dailyLimit,
    ANALYSIS_WORKSPACE_DAILY_LIMIT,
    "dailyLimit"
  );
  const platformDailyLimit = validInteger(
    options.platformDailyLimit,
    ANALYSIS_PLATFORM_DAILY_LIMIT,
    "platformDailyLimit"
  );
  const reservedAt = now2.toISOString();
  const day = utcDay(now2);
  const cooldownBoundary = new Date(nowMs - cooldownMs).toISOString();
  const inserted = await t.db.prepare(
    `INSERT INTO analysis_limit_reservations
         (workspace_id, client_id, reserved_at, day_utc, stage, stage_updated_at)
       SELECT ?, ?, ?, ?, 'queued', ?
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
         ) < ?`
  ).bind(
    t.workspaceId,
    clientId2,
    reservedAt,
    day,
    reservedAt,
    clientId2,
    t.workspaceId,
    t.workspaceId,
    clientId2,
    cooldownBoundary,
    t.workspaceId,
    day,
    dailyLimit,
    day,
    platformDailyLimit
  ).run();
  if (inserted.rowsAffected > 0) {
    const row = await t.db.prepare(
      `SELECT id FROM analysis_limit_reservations
         WHERE workspace_id = ? AND client_id = ? AND reserved_at = ?
         ORDER BY id DESC LIMIT 1`
    ).bind(t.workspaceId, clientId2, reservedAt).first();
    return {
      allowed: true,
      reservationId: Number(row?.id ?? 0),
      reservedAt,
      dayUtc: day
    };
  }
  const [latest, count5, platformCount] = await Promise.all([
    t.db.prepare(
      `SELECT id, reserved_at FROM analysis_limit_reservations
         WHERE workspace_id = ? AND client_id = ?
         ORDER BY reserved_at DESC, id DESC LIMIT 1`
    ).bind(t.workspaceId, clientId2).first(),
    t.db.prepare(
      `SELECT COUNT(*) AS count FROM analysis_limit_reservations
         WHERE workspace_id = ? AND day_utc = ?`
    ).bind(t.workspaceId, day).first(),
    // Deliberately unscoped: the operator's bill is a property of the whole
    // service, not of one tenant. This reads a COUNT and nothing else — no row,
    // id, name or workspace of another tenant is selected, returned, or exposed
    // in the message built from it.
    t.db.prepare(
      `SELECT COUNT(*) AS count FROM analysis_limit_reservations WHERE day_utc = ?`
    ).bind(day).first()
  ]);
  const midnightMs = nextUtcMidnight(now2).getTime();
  const cooldownRetryMs = latest ? Date.parse(latest.reserved_at) + cooldownMs : Number.NEGATIVE_INFINITY;
  const gates = [];
  if (Number(platformCount?.count ?? 0) >= platformDailyLimit) {
    gates.push({
      code: "platform-daily-cap",
      retryAtMs: midnightMs,
      reason: "analysis is paused across the service for the rest of today"
    });
  }
  if (Number(count5?.count ?? 0) >= dailyLimit) {
    gates.push({
      code: "workspace-daily-cap",
      retryAtMs: midnightMs,
      reason: "this workspace has reached its daily analysis limit"
    });
  }
  if (cooldownRetryMs > nowMs) {
    gates.push({
      code: "client-cooldown",
      retryAtMs: cooldownRetryMs,
      reason: "this client was analyzed recently"
    });
  }
  if (gates.length > 0) {
    const retryAtMs2 = Math.max(...gates.map((gate) => gate.retryAtMs));
    const sentence3 = gates.map((gate) => gate.reason).join(" and ");
    return {
      allowed: false,
      limitation: limitation(
        gates[0].code,
        `${sentence3.charAt(0).toUpperCase()}${sentence3.slice(1)}. Try again after ${new Date(retryAtMs2).toISOString()}.`,
        retryAtMs2,
        nowMs
      )
    };
  }
  const retryAtMs = nowMs + 1e3;
  return {
    allowed: false,
    limitation: limitation(
      "client-cooldown",
      "This client could not be reserved for analysis. Try again shortly.",
      retryAtMs,
      nowMs
    )
  };
}
__name(reserveAnalysisStart, "reserveAnalysisStart");
async function requireAnalysisReservation(t, clientId2, options = {}) {
  const result = await reserveAnalysisStart(t, clientId2, options);
  if (!result.allowed) throw new AnalysisLimitExceeded(result.limitation);
  return result;
}
__name(requireAnalysisReservation, "requireAnalysisReservation");
