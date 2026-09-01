import { Form, Link, redirect, useNavigation } from "react-router";

import { ClientSchema } from "@/core/schema";
import { assessReachability } from "@/core/reachability";
import * as repo from "@/db/repositories";
import { formatCurrencyRange, formatDate, Icon } from "../components/ui";
import { runAnalysis } from "../lib/analysis.server";
import { checkClientDomain } from "../lib/clientDomain";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/clients.$id";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? data.client.name + " · Client Growth" : "Client" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  const client = await repo.getClient(t.scope, params.id);
  if (!client) throw new Response("Client not found", { status: 404 });
  const [services, coverage, evidence, opportunities] = await Promise.all([
    repo.listServices(t.scope),
    repo.listCoverage(t.scope, client.id),
    repo.getLatestEvidence(t.scope, client.id),
    repo.listOpportunities(t.scope, client.id),
  ]);
  const reachability = evidence ? assessReachability(evidence) : null;
  return {
    client,
    services,
    coveredIds: coverage.map((c) => c.serviceId),
    lastCapturedAt: evidence?.capturedAt ?? null,
    lastScanReached: reachability?.reached ?? null,
    lastScanReason: reachability?.reason ?? null,
    opportunityCount: opportunities.filter(
      (o) => o.billableStatus === "billable" && (o.status === "new" || o.status === "proposal_prepared"),
    ).length,
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const existing = await repo.getClient(t.scope, params.id);
  if (!existing) throw new Response("Client not found", { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "save") {
    const checked = checkClientDomain(String(form.get("domain") ?? existing.domain));
    if (!checked.ok) return { ok: false as const, error: checked.error! };
    const updated = ClientSchema.parse({
      id: existing.id,
      name: String(form.get("name") ?? existing.name).trim(),
      domain: checked.domain,
      offerings: String(form.get("offerings") ?? "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      notes: String(form.get("notes") ?? "").trim(),
    });
    await repo.upsertClient(t.scope, updated);
    return { ok: true as const, message: "Client details saved." };
  }

  if (intent === "toggle-coverage") {
    const serviceId = String(form.get("serviceId") ?? "");
    if (form.get("covered") === "on") {
      await repo.setCoverage(t.scope, existing.id, serviceId, "Set from client page");
    } else {
      await repo.removeCoverage(t.scope, existing.id, serviceId);
    }
    return { ok: true as const, message: "Coverage updated." };
  }

  if (intent === "analyze") {
    try {
      const result = await runAnalysis(t.scope, context.cloudflare.env as never, existing.id);
      // A run that never reached the site must not look like a clean scan.
      if (!result.reachability.reached) {
        return {
          ok: false as const,
          error: `The website could not be read, so nothing was checked. ${result.reachability.reason}`,
        };
      }
      return redirect("/opportunities");
    } catch (err) {
      const error =
        err instanceof Response
          ? err.status + " " + err.statusText
          : err instanceof Error
            ? err.message
            : "Analysis failed";
      return { ok: false as const, error };
    }
  }

  throw new Response("Unknown action", { status: 400 });
}

export default function ClientDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { client, services, coveredIds, lastCapturedAt, opportunityCount, lastScanReached, lastScanReason } =
    loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="detail-layout">
      <div className="detail-lede">
        <div>
          <h1>{client.name}</h1>
          <div className="sub">
            <span>{client.domain}</span>
            <span className="meta-dot">•</span>
            <span>{client.offerings.length} listed service{client.offerings.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        <Link className="btn btn-secondary" to="/clients">
          <Icon name="arrow-up-right" size={15} />
          All clients
        </Link>
      </div>

      {actionData && "ok" in actionData && actionData.ok && (
        <div className="notice ok" role="status">
          <Icon name="check" size={17} />
          <span>{actionData.message}</span>
        </div>
      )}
      {actionData && "ok" in actionData && !actionData.ok && (
        <div className="notice err" role="alert">
          <Icon name="x" size={17} />
          <span>{actionData.error}</span>
        </div>
      )}

      <section className="card">
        <div className="detail-card-title">
          <div>
            <h2>Website analysis</h2>
            <p className="muted">Scan the site for evidence-backed opportunities you can review with the client.</p>
          </div>
          <span
            className={
              !lastCapturedAt ? "status" : lastScanReached ? "status proposal" : "status dismissed"
            }
          >
            {!lastCapturedAt ? "Not scanned" : lastScanReached ? "Scanned" : "Unreachable"}
          </span>
        </div>
        {lastCapturedAt && !lastScanReached && (
          <div className="notice err" role="alert">
            <Icon name="x" size={17} />
            <span>{lastScanReason}</span>
          </div>
        )}
        <div className="row-actions">
          <span className="cell-muted">
            {lastCapturedAt
              ? (lastScanReached ? "Last scanned " : "Last attempted ") + formatDate(lastCapturedAt, true)
              : "No analysis has been run yet"}
          </span>
          {opportunityCount > 0 && (
            <Link className="btn btn-quiet btn-sm" to="/opportunities">
              {opportunityCount} active opportunit{opportunityCount === 1 ? "y" : "ies"}
              <Icon name="arrow-up-right" size={14} />
            </Link>
          )}
        </div>
        <Form method="post" className="form-actions">
          <input type="hidden" name="intent" value="analyze" />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <Icon name="refresh" size={16} />
            {busy ? "Analyzing…" : "Scan website & analyze"}
          </button>
        </Form>
      </section>

      <section className="card">
        <div className="detail-card-title">
          <div>
            <h2>Contract coverage</h2>
            <p className="muted">Covered work is never surfaced as a billable upsell for this client.</p>
          </div>
          <Icon name="briefcase" size={18} />
        </div>
        {services.length === 0 ? (
          <div className="empty-state compact">
            <p>Add services to your catalog first.</p>
            <Link className="btn btn-secondary btn-sm" to="/services">Open services</Link>
          </div>
        ) : (
          <table className="coverage-table">
            <tbody>
              {services.map((service) => {
                const covered = coveredIds.includes(service.id);
                return (
                  <tr key={service.id}>
                    <td>
                      <Form method="post" className="inline">
                        <input type="hidden" name="intent" value="toggle-coverage" />
                        <input type="hidden" name="serviceId" value={service.id} />
                        {!covered && <input type="hidden" name="covered" value="on" />}
                        <button
                          type="submit"
                          className={"coverage-toggle " + (covered ? "is-covered" : "")}
                          aria-label={(covered ? "Remove coverage for " : "Mark covered: ") + service.name}
                        >
                          {covered ? <Icon name="check" size={17} /> : <span className="coverage-empty" aria-hidden="true" />}
                        </button>
                      </Form>
                    </td>
                    <td><span className="cell-primary">{service.name}</span></td>
                    <td><span className="cell-secondary">{formatCurrencyRange(service.priceMin, service.priceMax)}</span></td>
                    <td><span className="cell-muted">{service.active ? "Active service" : "Inactive service"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="detail-card-title">
          <div>
            <h2>Client details</h2>
            <p className="muted">Update the site and service context used during analysis.</p>
          </div>
          <Icon name="settings" size={18} />
        </div>
        <Form method="post" className="stack">
          <input type="hidden" name="intent" value="save" />
          <div className="field-row">
            <div className="field">
              <label htmlFor="name">Client name</label>
              <input id="name" name="name" type="text" defaultValue={client.name} />
            </div>
            <div className="field">
              <label htmlFor="domain">Website domain</label>
              <input id="domain" name="domain" type="text" defaultValue={client.domain} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="offerings">Services this client offers</label>
            <textarea id="offerings" name="offerings" defaultValue={client.offerings.join("\n")} />
            <div className="field-hint">One service per line.</div>
          </div>
          <div className="field">
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" defaultValue={client.notes} placeholder="Optional context for your team" />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Icon name="check" size={15} />
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </Form>
      </section>
    </div>
  );
}
