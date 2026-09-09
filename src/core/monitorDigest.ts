/**
 * The MONITOR weekly digest — pure model + rendering, no I/O, no clock.
 *
 * This is where "not a generic monitoring tool" is enforced. A digest speaks in
 * exactly three registers, all in the agency's own language and priced from the
 * agency's own catalog:
 *
 *   - NEW sellable work found since the last scan;
 *   - findings a client RESOLVED themselves (so the agency stops pitching them);
 *   - an honest "we couldn't fully read N sites", never dressed up as "clean".
 *
 * There is no uptime percentage, no "content changed" diff and no vanity metric,
 * because none of those is billable work. A quiet week says so plainly, and with
 * the default "only when something changed" it sends nothing at all rather than
 * manufacturing a reason to email.
 *
 * The digest reads only already-computed scheduled-run output; it never triggers
 * an analysis, so building or sending one costs nothing at the provider.
 */

import {
  changeHeadline,
  type MonitoringOutcome,
} from "@/core/monitoring";
import { jobsToPayback, paybackSentence } from "@/core/clientValue";

// ---------------------------------------------------------------------------
// cadence + settings
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

/** The product offers Off and Weekly, mirroring the scanner's own cadences. */
export const MONITOR_DIGEST_CADENCES = ["off", "weekly"] as const;
export type MonitorDigestCadence = (typeof MONITOR_DIGEST_CADENCES)[number];

export function isMonitorDigestCadence(value: unknown): value is MonitorDigestCadence {
  return (MONITOR_DIGEST_CADENCES as readonly unknown[]).includes(value);
}

export const MONITOR_DIGEST_INTERVAL_MS: Record<MonitorDigestCadence, number> = {
  off: 0,
  weekly: 7 * DAY,
};

/** How far back a digest looks. One week, matching the only on-cadence. */
export const MONITOR_DIGEST_PERIOD_MS = 7 * DAY;

/**
 * How long a digest claim is honoured. A tick evicted mid-send leaves its claim
 * behind; after this the workspace is reclaimable. Comfortably longer than one
 * tick, far shorter than the weekly cadence, so a live send is never stolen and
 * an interrupted one is retried next day rather than lost for a week.
 */
export const MONITOR_DIGEST_CLAIM_TTL_MS = 10 * 60 * 1000;

export interface MonitorDigestSettings {
  cadence: MonitorDigestCadence;
  /** When true (the default), a week with no new or resolved work sends nothing. */
  onlyOnChange: boolean;
  /** Explicit recipient, or null to fall back to the workspace owner at send time. */
  recipient: string | null;
}

export const DEFAULT_MONITOR_DIGEST_SETTINGS: MonitorDigestSettings = {
  cadence: "weekly",
  onlyOnChange: true,
  recipient: null,
};

// ---------------------------------------------------------------------------
// facts (input) — what storage aggregates for a period
// ---------------------------------------------------------------------------

export interface MonitorDigestTopOpportunity {
  id: string;
  title: string;
  priceMin: number;
  priceMax: number;
}

export interface MonitorDigestClientFacts {
  clientId: string;
  clientName: string;
  domain: string;
  /** New opportunities across this client's scheduled scans in the period. */
  newCount: number;
  /** Findings this client's scans confirmed resolved in the period. */
  resolvedCount: number;
  /** The client's most recent scheduled scan in the period could not read the site. */
  couldNotRead: boolean;
  /** Outcome of the client's most recent scheduled scan in the period. */
  latestOutcome: MonitoringOutcome | null;
  /** Open, billable opportunities right now (not just this period). */
  openCount: number;
  openPriceMin: number;
  openPriceMax: number;
  /** The single most valuable open opportunity — the digest's deep-link target. */
  topOpportunity: MonitorDigestTopOpportunity | null;
  /** One typical job in the client's business, if the agency recorded it. */
  averageJobValue: number | null;
}

export interface MonitorDigestFacts {
  workspaceName: string;
  period: { since: string; until: string };
  /** Clients with monitoring enabled, whether or not they changed this period. */
  monitoredClients: number;
  /** Per-client facts for clients that had at least one scheduled scan this period. */
  clients: MonitorDigestClientFacts[];
}

// ---------------------------------------------------------------------------
// model (output)
// ---------------------------------------------------------------------------

export interface MonitorDigestLine {
  clientId: string;
  clientName: string;
  domain: string;
  headline: string;
  newCount: number;
  resolvedCount: number;
  openCount: number;
  priceRange: { min: number; max: number } | null;
  topOpportunity: MonitorDigestTopOpportunity | null;
  /** "Pays for itself with one job.", or null when no job value is recorded. */
  payoff: string | null;
}

export interface MonitorDigestModel {
  workspaceName: string;
  period: { since: string; until: string };
  monitoredClients: number;
  totals: {
    newFindings: number;
    resolvedFindings: number;
    clientsWithChange: number;
    monitoredClients: number;
    priceMin: number;
    priceMax: number;
  };
  lines: MonitorDigestLine[];
  /** Clients whose most recent scan this period could not read the site. */
  couldNotRead: number;
  /** No new and no resolved work anywhere this period. */
  quiet: boolean;
}

/**
 * Turn a period's facts into the digest model.
 *
 * "Meaningful change" is new or resolved work — the same definition the scanner
 * uses (`hasMeaningfulChange`). Sites we could not read are reported as a
 * footnote but do NOT, on their own, make a week non-quiet: a persistently
 * unreadable site should not generate a fresh email every week.
 */
export function buildMonitorDigest(facts: MonitorDigestFacts): MonitorDigestModel {
  const lines: MonitorDigestLine[] = facts.clients
    .filter((c) => c.newCount > 0 || c.resolvedCount > 0)
    .map((c) => ({
      clientId: c.clientId,
      clientName: c.clientName,
      domain: c.domain,
      headline: changeHeadline(c.latestOutcome ?? "clean", {
        newCount: c.newCount,
        stillOpenCount: 0,
        resolvedCount: c.resolvedCount,
      }),
      newCount: c.newCount,
      resolvedCount: c.resolvedCount,
      openCount: c.openCount,
      priceRange: c.openCount > 0 ? { min: c.openPriceMin, max: c.openPriceMax } : null,
      topOpportunity: c.topOpportunity,
      payoff: c.topOpportunity
        ? paybackSentence(
            jobsToPayback({
              priceMin: c.topOpportunity.priceMin,
              priceMax: c.topOpportunity.priceMax,
              averageJobValue: c.averageJobValue ?? undefined,
            }),
          )
        : null,
    }))
    .sort(
      (a, b) =>
        b.newCount - a.newCount ||
        (b.priceRange?.max ?? 0) - (a.priceRange?.max ?? 0) ||
        a.clientName.localeCompare(b.clientName),
    );

  const newFindings = facts.clients.reduce((sum, c) => sum + c.newCount, 0);
  const resolvedFindings = facts.clients.reduce((sum, c) => sum + c.resolvedCount, 0);
  const priceMin = lines.reduce((sum, l) => sum + (l.priceRange?.min ?? 0), 0);
  const priceMax = lines.reduce((sum, l) => sum + (l.priceRange?.max ?? 0), 0);

  return {
    workspaceName: facts.workspaceName,
    period: facts.period,
    monitoredClients: facts.monitoredClients,
    totals: {
      newFindings,
      resolvedFindings,
      clientsWithChange: lines.length,
      monitoredClients: facts.monitoredClients,
      priceMin,
      priceMax,
    },
    lines,
    couldNotRead: facts.clients.filter((c) => c.couldNotRead).length,
    quiet: newFindings === 0 && resolvedFindings === 0,
  };
}

/**
 * Whether this week's digest is worth sending. A workspace with nothing
 * monitored never sends; with "only when something changed" on, a quiet week
 * sends nothing; otherwise the weekly digest goes out as a heartbeat.
 */
export function shouldSendDigest(
  model: MonitorDigestModel,
  settings: Pick<MonitorDigestSettings, "cadence" | "onlyOnChange">,
): boolean {
  if (settings.cadence === "off") return false;
  if (model.monitoredClients === 0) return false;
  if (settings.onlyOnChange) return !model.quiet;
  return true;
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function money(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function moneyRange(min: number, max: number): string {
  return min === max ? money(min) : `${money(min)} – ${money(max)}`;
}

function formatPeriod(period: { since: string; until: string }): string {
  const start = new Date(period.since);
  const end = new Date(period.until);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

interface DigestLinks {
  opportunity(id: string): string;
  client(id: string): string;
  monitor: string;
}

function linksFor(baseUrl: string): DigestLinks {
  const base = trimBase(baseUrl);
  return {
    opportunity: (id) => `${base}/opportunities/${id}`,
    client: (id) => `${base}/clients/${id}`,
    monitor: `${base}/monitor`,
  };
}

/** One line the reader takes in at a glance, in billable-work terms. */
export function digestSummarySentence(model: MonitorDigestModel): string {
  const parts: string[] = [];
  if (model.totals.newFindings > 0) {
    const worth =
      model.totals.priceMax > 0
        ? ` worth ${moneyRange(model.totals.priceMin, model.totals.priceMax)}`
        : "";
    parts.push(
      `${model.totals.newFindings} new ${plural(model.totals.newFindings, "opportunity", "opportunities")}${worth}`,
    );
  }
  if (model.totals.resolvedFindings > 0) {
    parts.push(
      `${model.totals.resolvedFindings} ${plural(model.totals.resolvedFindings, "finding", "findings")} fixed by ${plural(model.totals.resolvedFindings, "a client", "clients")}`,
    );
  }
  const body = parts.length > 0 ? parts.join(", ") : "no new billable work";
  return `This week across ${model.monitoredClients} monitored ${plural(model.monitoredClients, "client", "clients")}: ${body}.`;
}

export function digestSubject(model: MonitorDigestModel): string {
  if (model.totals.newFindings > 0) {
    return `Axiom Orbit — ${model.totals.newFindings} new ${plural(model.totals.newFindings, "opportunity", "opportunities")} across your clients`;
  }
  if (model.totals.resolvedFindings > 0) {
    return `Axiom Orbit — ${model.totals.resolvedFindings} ${plural(model.totals.resolvedFindings, "finding", "findings")} your clients fixed this week`;
  }
  return "Axiom Orbit — your weekly monitoring digest";
}

function couldNotReadSentence(model: MonitorDigestModel): string {
  const n = model.couldNotRead;
  return `${n} ${plural(n, "site", "sites")} couldn't be fully read this week. Nothing was concluded for ${plural(n, "it", "them")}, and the next check is scheduled automatically.`;
}

export function renderMonitorDigestText(model: MonitorDigestModel, baseUrl: string): string {
  const links = linksFor(baseUrl);
  const out: string[] = [];
  out.push(`${model.workspaceName} — monitoring digest`);
  const period = formatPeriod(model.period);
  if (period) out.push(period);
  out.push("");
  out.push(digestSummarySentence(model));

  for (const line of model.lines) {
    out.push("");
    out.push(`${line.clientName} (${line.domain})`);
    out.push(`  ${line.headline}`);
    if (line.topOpportunity) {
      const price = moneyRange(line.topOpportunity.priceMin, line.topOpportunity.priceMax);
      out.push(`  ${line.topOpportunity.title} — ${price}${line.payoff ? ` · ${line.payoff}` : ""}`);
      out.push(`  ${links.opportunity(line.topOpportunity.id)}`);
    } else {
      out.push(`  ${links.client(line.clientId)}`);
    }
  }

  if (model.quiet) {
    out.push("");
    out.push("No new opportunities this week — everything open is unchanged.");
  }
  if (model.couldNotRead > 0) {
    out.push("");
    out.push(couldNotReadSentence(model));
  }

  out.push("");
  out.push(`Manage monitoring and digests: ${links.monitor}`);
  out.push(
    "You're receiving this because monitoring is on for one or more of your clients in Axiom Orbit.",
  );
  return out.join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderMonitorDigestHtml(model: MonitorDigestModel, baseUrl: string): string {
  const links = linksFor(baseUrl);
  const period = formatPeriod(model.period);
  const ink = "#1a1c1f";
  const faint = "#6b7076";
  const rule = "#e6e8eb";

  const rows = model.lines
    .map((line) => {
      const price = line.topOpportunity
        ? moneyRange(line.topOpportunity.priceMin, line.topOpportunity.priceMax)
        : line.priceRange
          ? moneyRange(line.priceRange.min, line.priceRange.max)
          : "";
      const target = line.topOpportunity
        ? links.opportunity(line.topOpportunity.id)
        : links.client(line.clientId);
      const title = line.topOpportunity ? escapeHtml(line.topOpportunity.title) : "";
      const detail = title
        ? `<div style="margin-top:4px"><a href="${target}" style="color:${ink};font-weight:600;text-decoration:none">${title}</a>${
            price ? ` <span style="color:${faint}">— ${price}</span>` : ""
          }${line.payoff ? `<div style="color:${faint};font-size:13px">${escapeHtml(line.payoff)}</div>` : ""}</div>`
        : `<div style="margin-top:4px"><a href="${target}" style="color:${ink};text-decoration:none">View client</a></div>`;
      return `<tr><td style="padding:14px 0;border-bottom:1px solid ${rule}">
        <div style="font-weight:600;color:${ink}">${escapeHtml(line.clientName)} <span style="color:${faint};font-weight:400">${escapeHtml(line.domain)}</span></div>
        <div style="color:${faint};font-size:14px;margin-top:2px">${escapeHtml(line.headline)}</div>
        ${detail}
      </td></tr>`;
    })
    .join("\n");

  const quietBlock = model.quiet
    ? `<p style="color:${faint}">No new opportunities this week — everything open is unchanged.</p>`
    : "";
  const couldNotReadBlock =
    model.couldNotRead > 0
      ? `<p style="color:${faint};font-size:13px">${escapeHtml(couldNotReadSentence(model))}</p>`
      : "";

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:${ink}">
  <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${faint}">Axiom Orbit · Monitor</div>
  <h1 style="font-size:20px;margin:6px 0 2px">${escapeHtml(model.workspaceName)} — monitoring digest</h1>
  ${period ? `<div style="color:${faint};font-size:14px">${period}</div>` : ""}
  <p style="font-size:16px;margin:16px 0">${escapeHtml(digestSummarySentence(model))}</p>
  ${rows ? `<table role="presentation" width="100%" style="border-collapse:collapse">${rows}</table>` : ""}
  ${quietBlock}
  ${couldNotReadBlock}
  <p style="margin-top:24px"><a href="${links.monitor}" style="color:${ink};font-weight:600">Manage monitoring and digests →</a></p>
  <p style="color:${faint};font-size:12px">You're receiving this because monitoring is on for one or more of your clients in Axiom Orbit.</p>
</div>`;
}
