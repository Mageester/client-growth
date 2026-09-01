import { Form, Link } from "react-router";
import { useState } from "react";

import { ClientSchema } from "@/core/schema";
import * as repo from "@/db/repositories";
import { formatDate, getInitials, Icon } from "../components/ui";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/clients._index";

export function meta() {
  return [{ title: "Clients · Client Growth" }];
}

function slugId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return "client-" + (base || "unnamed") + "-" + Math.random().toString(36).slice(2, 6);
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  const clients = await repo.listClients(t.scope);
  const enrichedClients = await Promise.all(
    clients.map(async (client) => {
      const [opportunities, evidence] = await Promise.all([
        repo.listOpportunities(t.scope, client.id),
        repo.getLatestEvidence(t.scope, client.id),
      ]);
      return {
        ...client,
        lastCapturedAt: evidence?.capturedAt ?? null,
        opportunityCount: opportunities.filter(
          (opp) =>
            opp.billableStatus === "billable" &&
            (opp.status === "new" || opp.status === "proposal_prepared"),
        ).length,
      };
    }),
  );
  return { clients: enrichedClients };
}

export async function action({ request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const domain = String(form.get("domain") ?? "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (!name || !domain) return { ok: false as const, error: "Name and domain are required." };

  const offerings = String(form.get("offerings") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const client = ClientSchema.parse({
    id: slugId(name),
    name,
    domain,
    offerings,
    notes: String(form.get("notes") ?? "").trim(),
  });
  await repo.upsertClient(t.scope, client);
  return { ok: true as const, id: client.id };
}

export default function ClientsIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { clients } = loaderData;
  const [addOpen, setAddOpen] = useState(clients.length === 0);
  return (
    <div>
      <div className="page-head">
        <div className="page-head-copy">
          <h1>Clients</h1>
          <div className="sub">Keep your client portfolio ready for the next useful conversation.</div>
        </div>
      </div>

      {actionData?.ok && (
        <div className="notice ok" role="status">
          <Icon name="check" size={17} />
          <span>
            Client added. <Link to={"/clients/" + actionData.id}>Open client</Link>
          </span>
        </div>
      )}
      {actionData && !actionData.ok && (
        <div className="notice err" role="alert">
          <Icon name="x" size={17} />
          <span>{actionData.error}</span>
        </div>
      )}

      <section className="card list-shell">
        <div className="list-toolbar">
          <div>
            <strong>Client portfolio</strong>
            <div className="list-toolbar-copy">
              {clients.length} {clients.length === 1 ? "client" : "clients"} monitored
            </div>
          </div>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setAddOpen(true)}>
            <Icon name="plus" size={16} />
            Add client
          </button>
        </div>
        {clients.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon"><Icon name="users" size={20} /></span>
            <h2>No clients yet</h2>
            <p>Add your first client to start finding evidence-backed revenue opportunities.</p>
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Services</th>
                  <th>Last analysis</th>
                  <th>Opportunities</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => {
                  const { lastCapturedAt, opportunityCount } = client;
                  return (
                    <tr key={client.id}>
                    <td>
                      <div className="client-name-cell">
                        <span className="avatar">{getInitials(client.name)}</span>
                        <span>
                          <Link className="cell-primary" to={"/clients/" + client.id}>
                            {client.name}
                          </Link>
                          <small>{client.domain}</small>
                        </span>
                      </div>
                    </td>
                    <td><span className="cell-secondary">{client.offerings.length} listed</span></td>
                    <td>
                      <span className={lastCapturedAt ? "cell-secondary" : "cell-muted"}>
                        {lastCapturedAt ? formatDate(lastCapturedAt) : "Not analyzed"}
                      </span>
                    </td>
                    <td>
                      <span className={opportunityCount > 0 ? "cell-primary" : "cell-muted"}>
                        {opportunityCount > 0 ? opportunityCount : "None yet"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <Link className="btn btn-secondary btn-sm" to={"/clients/" + client.id}>
                          Open client
                        </Link>
                        <Link className="btn btn-quiet btn-sm" to={"/clients/" + client.id}>
                          Analyze
                        </Link>
                      </div>
                    </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <details
        id="add-client"
        className="form-drawer"
        open={addOpen}
        onToggle={(event) => setAddOpen(event.currentTarget.open)}
      >
        <summary className="drawer-summary">
          <span className="drawer-summary-copy">
            <strong>Add a client</strong>
            <small>Save the website and the services your client sells.</small>
          </span>
          <span className="btn btn-primary btn-sm">
            <Icon name="plus" size={16} />
            New client
          </span>
        </summary>
        <div className="drawer-panel">
          <Form method="post" className="stack">
            <div className="field-row">
              <div className="field">
                <label htmlFor="new-client-name">Client name</label>
                <input id="new-client-name" name="name" type="text" required />
              </div>
              <div className="field">
                <label htmlFor="new-client-domain">Website domain</label>
                <input id="new-client-domain" name="domain" type="text" placeholder="example.com" required />
                <div className="field-hint">https:// is optional.</div>
              </div>
            </div>
            <div className="field">
              <label htmlFor="new-client-offerings">Services this client offers</label>
              <textarea
                id="new-client-offerings"
                name="offerings"
                placeholder={"One service per line\nheat pump installation\nair conditioning repair"}
              />
              <div className="field-hint">This helps analysis understand what their customers can buy.</div>
            </div>
            <div className="field">
              <label htmlFor="new-client-notes">Notes</label>
              <textarea id="new-client-notes" name="notes" placeholder="Optional context for your team" />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                Add client
                <Icon name="arrow-up-right" size={15} />
              </button>
            </div>
          </Form>
        </div>
      </details>
    </div>
  );
}
