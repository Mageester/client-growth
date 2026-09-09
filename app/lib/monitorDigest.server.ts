import { parseEnv } from "@/config/env";
import {
  decideMonitorEntitlement,
  parseMonitorEntitlementPolicy,
  type MonitorEntitlementPolicy,
} from "@/core/entitlements";
import {
  MONITOR_DIGEST_PERIOD_MS,
  buildMonitorDigest,
  digestSubject,
  renderMonitorDigestHtml,
  renderMonitorDigestText,
  shouldSendDigest,
} from "@/core/monitorDigest";
import {
  claimWorkspaceDigest,
  collectDigestFacts,
  finishWorkspaceDigest,
  getMonitorDigestSettings,
  listWorkspacesDueForDigest,
  recordMonitorDigestRun,
  type DueDigestWorkspace,
  type MonitorDigestRunOutcome,
} from "@/db/monitorDigests";
import type { SqlDb } from "@/db/sql";
import type { TenantScope } from "@/db/tenant";
import { getTrustedAuthBaseURL } from "./auth.server";
import {
  createResendMonitorDigestSender,
  resolveMailTransport,
  type MonitorDigestSender,
} from "./resend.server";

/**
 * The MONITOR weekly-digest tick.
 *
 * Structurally a smaller sibling of the monitoring scan tick: select a bounded
 * batch of due workspaces, claim each with a single conditional UPDATE so two
 * ticks cannot both send, do the work, record it. Two differences matter:
 *
 *   - it spends nothing at the provider — it only reads scheduled-run output
 *     that the scan tick already produced and paid for;
 *   - it reaches outside the app (email), so a workspace that is not entitled to
 *     MONITOR is recorded and skipped, never sent to.
 *
 * Every workspace is wrapped individually: one workspace's failure — a provider
 * timeout, a bad row — never stops the others.
 */

function describeError(err: unknown): string {
  const text =
    err instanceof Response
      ? `${err.status} ${err.statusText}`
      : err instanceof Error
        ? `${err.name}: ${err.message}`
        : String(err);
  return text.slice(0, 200);
}

/** Pick a sender from the environment, or null when email cannot be delivered. */
export function resolveDigestSender(env: Record<string, unknown>): MonitorDigestSender | null {
  const transport = resolveMailTransport(env);
  if (transport.kind === "resend") return createResendMonitorDigestSender(transport.config);
  if (transport.kind === "console") {
    return async (message) => {
      console.log(
        `[monitor-digest:console] to=${message.to} subject=${message.subject}\n${message.text}`,
      );
    };
  }
  return null;
}

export interface MonitorDigestWorkspaceResult {
  workspaceId: string;
  outcome: MonitorDigestRunOutcome | "skipped_claim";
  newFindings: number;
  resolvedFindings: number;
}

interface ProcessContext {
  now: Date;
  policy: MonitorEntitlementPolicy;
  baseUrl: string;
  send: MonitorDigestSender;
  /** Send regardless of the quiet/only-on-change gate (the manual "send now"). */
  force?: boolean;
}

/**
 * Build, maybe send, record and reschedule one workspace's digest. Always
 * releases the claim by rescheduling, whatever the outcome. Never throws for an
 * expected outcome (not entitled, quiet week, send failure) — those are recorded
 * and returned; only a genuinely unexpected error propagates to the tick's net.
 */
async function processWorkspaceDigest(
  db: SqlDb,
  target: DueDigestWorkspace,
  ctx: ProcessContext,
): Promise<MonitorDigestWorkspaceResult> {
  const t: TenantScope = { db, workspaceId: target.workspaceId };
  const since = target.lastSentAt ?? new Date(ctx.now.getTime() - MONITOR_DIGEST_PERIOD_MS).toISOString();
  const until = ctx.now.toISOString();

  const record = (outcome: MonitorDigestRunOutcome, extra: {
    recipient?: string | null;
    newFindings?: number;
    resolvedFindings?: number;
    clientCount?: number;
    error?: string | null;
  }) =>
    recordMonitorDigestRun(t, {
      periodStart: since,
      periodEnd: until,
      sentAt: until,
      recipient: extra.recipient ?? null,
      outcome,
      newCount: extra.newFindings ?? 0,
      resolvedCount: extra.resolvedFindings ?? 0,
      clientCount: extra.clientCount ?? 0,
      error: extra.error ?? null,
    });

  const finish = (sent: boolean) => finishWorkspaceDigest(db, target.workspaceId, { now: ctx.now, sent });

  const result = (
    outcome: MonitorDigestRunOutcome,
    newFindings = 0,
    resolvedFindings = 0,
  ): MonitorDigestWorkspaceResult => ({ workspaceId: target.workspaceId, outcome, newFindings, resolvedFindings });

  // Not paying for MONITOR: never email, but record why so the console can say so.
  if (!decideMonitorEntitlement({ policy: ctx.policy, ownerEmail: target.ownerEmail }).entitled) {
    await record("skipped_not_entitled", {});
    await finish(false);
    return result("skipped_not_entitled");
  }

  const facts = await collectDigestFacts(t, { since, until, now: ctx.now });
  const model = buildMonitorDigest(facts);
  const recipient =
    target.recipient && target.recipient.trim().length > 0 ? target.recipient.trim() : target.ownerEmail;

  const wantSend =
    ctx.force || shouldSendDigest(model, { cadence: "weekly", onlyOnChange: target.onlyOnChange });
  if (!wantSend) {
    await record("skipped_no_change", {
      newFindings: model.totals.newFindings,
      resolvedFindings: model.totals.resolvedFindings,
      clientCount: model.totals.clientsWithChange,
    });
    await finish(false);
    return result("skipped_no_change", model.totals.newFindings, model.totals.resolvedFindings);
  }

  if (!recipient) {
    await record("failed", { error: "no recipient address for this workspace" });
    await finish(false);
    return result("failed");
  }

  try {
    await ctx.send({
      to: recipient,
      workspaceId: target.workspaceId,
      periodStart: since,
      subject: digestSubject(model),
      text: renderMonitorDigestText(model, ctx.baseUrl),
      html: renderMonitorDigestHtml(model, ctx.baseUrl),
    });
  } catch (err) {
    await record("failed", {
      recipient,
      error: describeError(err),
      newFindings: model.totals.newFindings,
      resolvedFindings: model.totals.resolvedFindings,
      clientCount: model.totals.clientsWithChange,
    });
    await finish(false);
    return result("failed", model.totals.newFindings, model.totals.resolvedFindings);
  }

  await record("sent", {
    recipient,
    newFindings: model.totals.newFindings,
    resolvedFindings: model.totals.resolvedFindings,
    clientCount: model.totals.clientsWithChange,
  });
  await finish(true);
  return result("sent", model.totals.newFindings, model.totals.resolvedFindings);
}

export interface MonitorDigestTickOptions {
  db: SqlDb;
  env: Record<string, unknown>;
  now?: Date;
  /** Workspaces this tick may email. Defaults to MONITOR_DIGEST_MAX_PER_RUN. */
  limit?: number;
  /** Injected for tests; defaults to the environment's mail transport. */
  send?: MonitorDigestSender;
  /** Injected for tests; defaults to the trusted auth base URL. */
  baseUrl?: string;
}

export interface MonitorDigestTickResult {
  startedAt: string;
  finishedAt: string;
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  workspaces: MonitorDigestWorkspaceResult[];
}

export async function runMonitorDigestTick(
  options: MonitorDigestTickOptions,
): Promise<MonitorDigestTickResult> {
  const now = options.now ?? new Date();
  const policy = parseMonitorEntitlementPolicy(options.env);
  const limit =
    options.limit ?? parseEnv(options.env).MONITOR_DIGEST_MAX_PER_RUN;

  const result: MonitorDigestTickResult = {
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    considered: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    workspaces: [],
  };

  // MONITOR is entirely off (the pre-launch default). Nobody is entitled, so the
  // tick is inert rather than selecting, claiming and recording a skip for every
  // workspace every week. It comes alive the moment the tier is sold to anyone.
  if (policy.mode === "off") {
    result.finishedAt = new Date().toISOString();
    return result;
  }

  const send = options.send ?? resolveDigestSender(options.env);
  if (!send) {
    // No way to deliver mail. Say so once and do nothing — this is the honest
    // "half-configured is not configured" behaviour the rest of the app uses.
    console.warn("[monitor-digest] no email transport configured; skipping the digest tick");
    result.finishedAt = new Date().toISOString();
    return result;
  }

  const baseUrl = options.baseUrl ?? getTrustedAuthBaseURL(options.env as { BETTER_AUTH_URL?: string });
  const due = await listWorkspacesDueForDigest(options.db, { now, limit });
  result.considered = due.length;

  for (const target of due) {
    const claimed = await claimWorkspaceDigest(options.db, target.workspaceId, now);
    if (!claimed) {
      result.skipped++;
      result.workspaces.push({
        workspaceId: target.workspaceId,
        outcome: "skipped_claim",
        newFindings: 0,
        resolvedFindings: 0,
      });
      continue;
    }

    try {
      const outcome = await processWorkspaceDigest(options.db, target, { now, policy, baseUrl, send });
      if (outcome.outcome === "sent") result.sent++;
      else if (outcome.outcome === "failed") result.failed++;
      else result.skipped++;
      result.workspaces.push(outcome);
    } catch (err) {
      // Unexpected (e.g. the facts query threw). Release the claim and move on.
      console.error(`[monitor-digest] tick failed for ${target.workspaceId}: ${describeError(err)}`);
      try {
        await finishWorkspaceDigest(options.db, target.workspaceId, { now, sent: false });
      } catch (finishErr) {
        console.error(
          `[monitor-digest] could not release ${target.workspaceId}: ${describeError(finishErr)}`,
        );
      }
      result.failed++;
      result.workspaces.push({
        workspaceId: target.workspaceId,
        outcome: "failed",
        newFindings: 0,
        resolvedFindings: 0,
      });
    }
  }

  result.finishedAt = new Date().toISOString();
  return result;
}

export interface SendDigestNowOptions {
  db: SqlDb;
  env: Record<string, unknown>;
  workspaceId: string;
  /** The workspace owner's email — the fallback recipient. */
  ownerEmail: string | null;
  now?: Date;
  send?: MonitorDigestSender;
  baseUrl?: string;
}

export interface SendDigestNowResult {
  ok: boolean;
  outcome: MonitorDigestWorkspaceResult["outcome"] | "email-not-configured";
  recipient: string | null;
}

/**
 * Send this week's digest to one workspace right now — the console's "send me a
 * copy" action. Forces past the quiet/only-on-change gate (the person asked),
 * still respects entitlement, and reschedules the weekly clock so the automatic
 * digest does not immediately follow.
 */
export async function sendDigestNow(options: SendDigestNowOptions): Promise<SendDigestNowResult> {
  const now = options.now ?? new Date();
  const send = options.send ?? resolveDigestSender(options.env);
  if (!send) return { ok: false, outcome: "email-not-configured", recipient: null };

  const scope: TenantScope = { db: options.db, workspaceId: options.workspaceId };
  const settings = await getMonitorDigestSettings(scope);
  const baseUrl = options.baseUrl ?? getTrustedAuthBaseURL(options.env as { BETTER_AUTH_URL?: string });
  const policy = parseMonitorEntitlementPolicy(options.env);

  const target: DueDigestWorkspace = {
    workspaceId: options.workspaceId,
    name: "",
    ownerUserId: "",
    ownerEmail: options.ownerEmail,
    recipient: settings.recipient,
    onlyOnChange: settings.onlyOnChange,
    lastSentAt: null,
  };

  const outcome = await processWorkspaceDigest(options.db, target, {
    now,
    policy,
    baseUrl,
    send,
    force: true,
  });

  const recipient =
    settings.recipient && settings.recipient.trim().length > 0
      ? settings.recipient.trim()
      : options.ownerEmail;
  return { ok: outcome.outcome === "sent", outcome: outcome.outcome, recipient };
}
