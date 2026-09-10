import { Form, Link, useNavigation } from "react-router";

import { isWorkspaceEntitledToMonitor } from "@/core/entitlements";
import {
  CADENCE_LABEL,
  MONITORING_OFF,
  SELECTABLE_CADENCES,
  changeHeadline,
  isMonitoringCadence,
  type MonitoringCadence,
} from "@/core/monitoring";
import { isMonitorDigestCadence } from "@/core/monitorDigest";
import * as repo from "@/db/repositories";
import { listMonitoringByClient, setMonitoringCadence, summarizePortfolio } from "@/db/monitoring";
import {
  getMonitorDigestSettings,
  listMonitorDigestRuns,
  setMonitorDigestSettings,
} from "@/db/monitorDigests";
import { PILOT_OFFER, pilotRequestHref } from "../lib/pilot-request";
import { requireTenant } from "../lib/session.server";
import { resolveMailTransport } from "../lib/resend.server";
import { sendDigestNow } from "../lib/monitorDigest.server";
import { Icon, PageContextMeta, formatRelative, pluralize } from "../components/ui";
import { ClientMark } from "../components/entity-mark";
import type { Route } from "./+types/monitor";

export function meta() {
  return [{ title: "Monitor · Axiom Orbit" }];
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const OUTCOME_LABEL: Record<string, string> = {
  sent: "Sent",
  skipped_no_change: "Quiet week — not sent",
  skipped_not_entitled: "Not sent",
  failed: "Send failed",
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  const env = context.cloudflare.env as unknown as Record<string, unknown>;
  const entitled = isWorkspaceEntitledToMonitor(env, t.user.email);

  if (!entitled) {
    return { entitled: false as const, ownerEmail: t.user.email };
  }

  const [clients, monitoringByClient, latestRuns, digest, digestRuns] = await Promise.all([
    repo.listClients(t.scope),
    listMonitoringByClient(t.scope),
    repo.latestAnalysisRunByClient(t.scope),
    getMonitorDigestSettings(t.scope),
    listMonitorDigestRuns(t.scope, { limit: 8 }),
  ]);

  const rows = clients
    .map((client) => {
      const state = monitoringByClient.get(client.id) ?? MONITORING_OFF;
      const run = latestRuns.get(client.id) ?? null;
      const lastChange =
        run && run.trigger === "scheduled" && (run.newCount > 0 || run.resolvedCount > 0)
          ? { newCount: run.newCount, resolvedCount: run.resolvedCount, at: run.finishedAt, outcome: run.outcome }
          : null;
      return {
        id: client.id,
        name: client.name,
        domain: client.domain,
        cadence: state.cadence,
        lastOutcome: state.lastOutcome,
        lastSuccessAt: state.lastSuccessAt,
        nextDueAt: state.nextDueAt,
        lastChange,
      };
    })
    .sort(
      (a, b) => (a.cadence === "off" ? 1 : 0) - (b.cadence === "off" ? 1 : 0) || a.name.localeCompare(b.name),
    );

  const changes = rows
    .filter((r) => r.lastChange)
    .map((r) => ({ id: r.id, name: r.name, domain: r.domain, ...r.lastChange! }))
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, 6);

  return {
    entitled: true as const,
    ownerEmail: t.user.email,
    emailConfigured: resolveMailTransport(env as never).kind !== "none",
    portfolio: summarizePortfolio(monitoringByClient.values()),
    digest,
    digestRuns,
    clients: rows,
    changes,
    totalClients: clients.length,
    now: new Date().toISOString(),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const env = context.cloudflare.env as unknown as Record<string, unknown>;
  if (!isWorkspaceEntitledToMonitor(env, t.user.email)) {
    return { ok: false as const, error: "MONITOR isn’t enabled for this workspace." };
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "save-digest-settings") {
    const cadence = String(form.get("cadence") ?? "");
    if (!isMonitorDigestCadence(cadence)) {
      return { ok: false as const, error: "That is not a digest option." };
    }
    const recipient = String(form.get("recipient") ?? "").trim();
    if (recipient && !EMAIL_RE.test(recipient)) {
      return { ok: false as const, error: "Enter a valid email address, or leave it blank to use your own." };
    }
    await setMonitorDigestSettings(t.scope, {
      cadence,
      onlyOnChange: form.get("onlyOnChange") === "on",
      recipient: recipient || null,
    });
    return {
      ok: true as const,
      message: cadence === "off" ? "Weekly digest turned off." : "Digest preferences saved.",
    };
  }

  if (intent === "set-cadence") {
    const clientId = String(form.get("clientId") ?? "");
    const cadence = String(form.get("cadence") ?? "");
    if (!isMonitoringCadence(cadence)) {
      return { ok: false as const, error: "That is not a monitoring option." };
    }
    const latest = await repo.getLatestAnalysisRun(t.scope, clientId);
    const state = await setMonitoringCadence(t.scope, clientId, cadence, {
      lastAnalyzedAt: latest?.finishedAt ?? null,
    });
    if (!state) return { ok: false as const, error: "Client not found." };
    return {
      ok: true as const,
      message: state.cadence === "off" ? "Monitoring turned off for that client." : "Monitoring on.",
    };
  }

  if (intent === "send-digest-now") {
    const result = await sendDigestNow({
      db: t.db,
      env,
      workspaceId: t.workspace.id,
      ownerEmail: t.user.email,
    });
    if (result.outcome === "email-not-configured") {
      return { ok: false as const, error: "Email isn’t configured yet, so a digest can’t be sent." };
    }
    if (result.outcome === "sent") {
      return { ok: true as const, message: `Sent this week’s digest to ${result.recipient}.` };
    }
    return {
      ok: false as const,
      error: "Nothing was sent — see recent digests below for why.",
    };
  }

  return { ok: false as const, error: "Unknown action." };
}

// ---------------------------------------------------------------------------

/**
 * The gate, described as what it is.
 *
 * Three things the audit found wrong here. It said "ask us to turn it on" and
 * gave nothing to ask with. It promised Orbit would notice "something a
 * competitor added" — competitor comparison exists, but it is a comparison the
 * agency starts, against competitors the agency names; nothing schedules it,
 * and describing it as a watch sells a feature that does not run. And it
 * promised an emailed digest without saying delivery needs a configured mail
 * transport, which some environments do not have.
 *
 * Entitlement stays operator-enabled. This screen asks; it does not open.
 */
function Upsell({ ownerEmail }: { ownerEmail: string }) {
  return (
    <main className="home-page">
      <header className="home-head">
        <div>
          <span className="eyebrow">Monitor</span>
          <h1 className="title-page">Never look at a client cold again.</h1>
          <p className="page-statement">
            Monitoring rechecks each client site on a weekly schedule and records what is new,
            still open, resolved, or inconclusive — so “nothing changed” never quietly means “we
            couldn’t look”. Where email delivery is configured, it can also send one weekly digest
            of what those rechecks found.
          </p>
        </div>
      </header>
      <section className="home-clear">
        <Icon name="refresh" size={22} />
        <div>
          <b>Monitoring isn’t enabled for this workspace yet.</b>
          <p>
            Axiom enables it per workspace once the scope is agreed, so nothing recurring starts
            without you. Ask for it against <b>{ownerEmail}</b> and we will reply{" "}
            {PILOT_OFFER.responseTime}.
          </p>
          <p className="faint">
            Comparing a client against named competitors is a separate check you run yourself.
            Orbit does not crawl competitors on a schedule.
          </p>
          <div className="form-actions">
            <a className="btn btn-primary btn-sm" href={pilotRequestHref()}>
              Ask Axiom to enable monitoring
            </a>
            <Link className="btn btn-sm" to="/clients">
              Back to clients
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function Monitor({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  if (!loaderData.entitled) {
    return <Upsell ownerEmail={loaderData.ownerEmail} />;
  }

  const { portfolio, digest, digestRuns, clients, changes, emailConfigured, now } = loaderData;
  const renderNow = Date.parse(now) || Date.now();
  const monitoredRows = clients.filter((c) => c.cadence !== "off");

  return (
    <main className="home-page">
      <header className="home-head">
        <div>
          <span className="eyebrow">Monitor</span>
          <h1 className="title-page">Monitoring</h1>
          <p className="page-statement">
            {portfolio.monitored > 0
              ? `Watching ${portfolio.monitored} ${pluralize(portfolio.monitored, "client", "clients")} for new billable work.`
              : "Turn monitoring on for a client below and Orbit will watch it for new billable work."}
          </p>
        </div>
        <PageContextMeta dateTime={now} />
      </header>

      {actionData && (
        <div className={`notice monitor-note ${actionData.ok ? "is-ok" : "is-warn"}`} role="status">
          {actionData.ok ? actionData.message : actionData.error}
        </div>
      )}

      <section className="home-pipeline" aria-labelledby="monitor-summary">
        <div className="section-head">
          <div>
            <span className="eyebrow">This portfolio</span>
            <h2 id="monitor-summary" className="title-section">
              Coverage
            </h2>
          </div>
        </div>
        <dl className="pipeline-grid">
          <div><dt>Monitored</dt><dd>{portfolio.monitored}</dd></div>
          <div><dt>Due now</dt><dd>{portfolio.due}</dd></div>
          <div><dt>Needs attention</dt><dd>{portfolio.unhealthy}</dd></div>
          <div><dt>Not monitored</dt><dd>{loaderData.totalClients - portfolio.monitored}</dd></div>
        </dl>
      </section>

      <section className="home-weekly" aria-labelledby="digest-heading">
        <div className="section-head">
          <div>
            <span className="eyebrow">Weekly digest</span>
            <h2 id="digest-heading" className="title-section">
              What lands in your inbox
            </h2>
          </div>
        </div>
        {!emailConfigured && (
          <p className="prose faint">
            Email isn’t configured for this environment yet, so digests can’t be delivered. The
            schedule below still records what would have been sent.
          </p>
        )}
        <Form method="post" className="monitor-digest-form">
          <input type="hidden" name="intent" value="save-digest-settings" />
          <label className="field">
            <span>Frequency</span>
            <select name="cadence" defaultValue={digest.cadence} disabled={busy}>
              <option value="weekly">Weekly</option>
              <option value="off">Off</option>
            </select>
          </label>
          <label className="field field-check">
            <input type="checkbox" name="onlyOnChange" defaultChecked={digest.onlyOnChange} disabled={busy} />
            <span>Only email me when something changed</span>
          </label>
          <label className="field">
            <span>Send to</span>
            <input
              type="email"
              name="recipient"
              defaultValue={digest.recipient ?? ""}
              placeholder={loaderData.ownerEmail}
              disabled={busy}
            />
          </label>
          <div className="monitor-digest-actions">
            <button type="submit" className="btn btn-sm" disabled={busy}>
              Save
            </button>
          </div>
        </Form>

        {/* A separate form, because a form carries exactly one intent.
            Both controls used to live above: the hidden save intent came first
            in the field order, the send button appended a second one, and
            `formData.get("intent")` returns the first. Pressing Send saved
            preferences and reported success. */}
        <Form method="post" className="monitor-digest-send">
          <input type="hidden" name="intent" value="send-digest-now" />
          <button type="submit" className="btn btn-sm btn-quiet" disabled={busy || !emailConfigured}>
            Send me this week’s digest
          </button>
        </Form>

        {digestRuns.length > 0 && (
          <ul className="weekly-list monitor-digest-history">
            {digestRuns.map((run) => (
              <li key={run.periodStart}>
                <div className="weekly-row">
                  <span>{OUTCOME_LABEL[run.outcome] ?? run.outcome}</span>
                  <time dateTime={run.sentAt}>{formatRelative(run.sentAt, renderNow)}</time>
                </div>
                <p className="weekly-drift">
                  {run.outcome === "sent"
                    ? `${run.newCount} new · ${run.resolvedCount} fixed · ${run.clientCount} ${pluralize(run.clientCount, "client", "clients")}`
                    : run.error
                      ? run.error
                      : "No email was sent."}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {changes.length > 0 && (
        <section className="home-weekly" aria-labelledby="monitor-changes">
          <div className="section-head">
            <div>
              <span className="eyebrow">Detected by monitoring</span>
              <h2 id="monitor-changes" className="title-section">
                Recent changes
              </h2>
            </div>
          </div>
          <ul className="weekly-list">
            {changes.map((change) => (
              <li key={change.id}>
                <div className="weekly-row">
                  <Link to={`/clients/${change.id}`}>{change.name}</Link>
                  <time dateTime={change.at}>{formatRelative(change.at, renderNow)}</time>
                </div>
                <p>{changeHeadline(change.outcome, { newCount: change.newCount, stillOpenCount: 0, resolvedCount: change.resolvedCount })}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="home-weekly" aria-labelledby="monitor-clients">
        <div className="section-head">
          <div>
            <span className="eyebrow">Clients</span>
            <h2 id="monitor-clients" className="title-section">
              {monitoredRows.length > 0
                ? `${monitoredRows.length} monitored`
                : "Nothing monitored yet"}
            </h2>
          </div>
        </div>
        <ul className="monitor-client-list">
          {clients.map((client) => (
            <li key={client.id} className={client.cadence === "off" ? "is-off" : "is-on"}>
              <ClientMark name={client.name} seed={client.domain} size="md" />
              <div className="monitor-client-copy">
                <Link to={`/clients/${client.id}`}>{client.name}</Link>
                <small>
                  {client.cadence === "off"
                    ? "Not monitored"
                    : client.lastSuccessAt
                      ? `Last checked ${formatRelative(client.lastSuccessAt, renderNow)}`
                      : "Not checked yet"}
                  {client.nextDueAt && client.cadence !== "off"
                    ? ` · next ${formatRelative(client.nextDueAt, renderNow)}`
                    : ""}
                </small>
              </div>
              <Form method="post" className="monitor-client-cadence">
                <input type="hidden" name="intent" value="set-cadence" />
                <input type="hidden" name="clientId" value={client.id} />
                <select name="cadence" defaultValue={client.cadence} disabled={busy} aria-label={`Monitoring for ${client.name}`}>
                  {(SELECTABLE_CADENCES as readonly MonitoringCadence[]).map((cadence) => (
                    <option key={cadence} value={cadence}>
                      {CADENCE_LABEL[cadence]}
                    </option>
                  ))}
                  {!(SELECTABLE_CADENCES as readonly string[]).includes(client.cadence) && (
                    <option value={client.cadence}>{CADENCE_LABEL[client.cadence]}</option>
                  )}
                </select>
                <button type="submit" className="btn btn-sm" disabled={busy}>
                  Save
                </button>
              </Form>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
