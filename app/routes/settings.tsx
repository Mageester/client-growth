import { Form, useNavigation } from "react-router";

import * as monitoringRepo from "@/db/monitoring";
import { renameWorkspace } from "@/db/workspaces";
import { AxiomCredit, Icon, pluralize } from "../components/ui";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/settings";

export function meta() {
  return [{ title: "Settings · Client Growth" }];
}

/** The window the monitoring health section reports on. */
const HEALTH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export async function loader({ request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  const [states, health] = await Promise.all([
    monitoringRepo.listMonitoringByClient(t.scope),
    monitoringRepo.scheduledRunHealth(t.scope, {
      since: new Date(Date.now() - HEALTH_WINDOW_MS).toISOString(),
    }),
  ]);
  return {
    email: t.user.email,
    workspaceName: t.workspace.name,
    monitoring: { ...monitoringRepo.summarizePortfolio(states.values()), ...health },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const form = await request.formData();
  const name = String(form.get("workspaceName") ?? "").trim();
  if (!name) return { error: "Workspace name cannot be empty." };
  await renameWorkspace(t.db, t.workspace.id, name);
  return { ok: true };
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const saving = navigation.state !== "idle";

  return (
    <div className="detail detail-narrow">
      <div className="pagehead">
        <div className="pagehead-copy">
          <span className="eyebrow">Account</span>
          <h1 className="title-page">Settings</h1>
        </div>
      </div>

      {actionData && "ok" in actionData && actionData.ok && (
        <div className="notice ok" role="status">
          <Icon name="check" size={15} />
          <span>Workspace saved.</span>
        </div>
      )}
      {actionData && "error" in actionData && actionData.error && (
        <div className="notice err" role="alert">
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Workspace</h2>
            <p>The agency name shown across Client Growth.</p>
          </div>
        </div>
        <Form method="post">
          <div className="field">
            <label htmlFor="workspaceName">Workspace name</label>
            <input
              id="workspaceName"
              name="workspaceName"
              type="text"
              defaultValue={loaderData.workspaceName}
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </Form>
      </section>

      <MonitoringHealth monitoring={loaderData.monitoring} />

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Account</h2>
            <p>The signed-in account that owns this workspace.</p>
          </div>
        </div>
        <dl>
          <div className="kv-row">
            <dt>Email</dt>
            <dd>{loaderData.email}</dd>
          </div>
        </dl>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Session</h2>
            <p>Sign out of this browser when you are finished.</p>
          </div>
          <Form method="post" action="/logout">
            <button type="submit" className="btn">
              <Icon name="logout" size={14} />
              Log out
            </button>
          </Form>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">About</h2>
            <p>
              Client Growth watches the websites of the clients you already look after and surfaces
              evidence-backed work worth bringing up.
            </p>
          </div>
        </div>
        <AxiomCredit />
      </section>
    </div>
  );
}

/**
 * Whether monitoring is actually working, in the agency's language.
 *
 * The operator-facing version of these numbers (evaluator calls, rejections,
 * errors) is deliberately separate: it lives in the Worker's scheduled-run log
 * line and in the operator trigger's JSON. What belongs here is only what an
 * agency owner can act on — how much is watched, how much it found, and whether
 * any site could not be read.
 */
function MonitoringHealth({
  monitoring,
}: {
  monitoring: Awaited<ReturnType<typeof loader>>["monitoring"];
}) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2 className="title-section">Monitoring</h2>
          <p>
            Client Growth re-checks monitored clients on their own schedule. Turn it on for a
            client from that client&rsquo;s page.
          </p>
        </div>
      </div>

      {monitoring.monitored === 0 ? (
        <p className="prose faint">
          No client is monitored yet, so nothing is checked automatically and nothing runs in the
          background.
        </p>
      ) : (
        <dl>
          <div className="kv-row">
            <dt>Clients monitored</dt>
            <dd>
              {monitoring.monitored}
              {monitoring.due > 0 && (
                <span className="faint">
                  {" "}
                  · {monitoring.due} {pluralize(monitoring.due, "check", "checks")} due
                </span>
              )}
            </dd>
          </div>
          <div className="kv-row">
            <dt>Checks in the last 30 days</dt>
            <dd>
              {monitoring.runs}
              {monitoring.inconclusive > 0 && (
                <span className="faint">
                  {" "}
                  · {monitoring.inconclusive} could not be fully analyzed
                </span>
              )}
            </dd>
          </div>
          <div className="kv-row">
            <dt>What they changed</dt>
            <dd>
              {monitoring.newFindings + monitoring.resolvedFindings === 0
                ? "Nothing new"
                : `${monitoring.newFindings} new · ${monitoring.resolvedFindings} fixed by the client`}
            </dd>
          </div>
          {monitoring.evaluatorErrors > 0 && (
            <div className="kv-row">
              <dt>Incomplete checks</dt>
              <dd>
                {monitoring.evaluatorErrors}{" "}
                {pluralize(monitoring.evaluatorErrors, "finding", "findings")} could not be assessed
                and {monitoring.evaluatorErrors === 1 ? "was" : "were"} dropped rather than guessed.
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
