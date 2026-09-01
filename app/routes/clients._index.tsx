import { useEffect, useRef, useState } from "react";
import { Form, Link, useNavigation } from "react-router";

import { ClientSchema } from "@/core/schema";
import * as repo from "@/db/repositories";
import {
  EmptyState,
  Icon,
  SidePanel,
  formatDate,
  pluralize,
} from "../components/ui";
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

type EnrichedClient = Awaited<ReturnType<typeof loader>>["clients"][number];

export default function ClientsIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { clients } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [addOpen, setAddOpen] = useState(false);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (actionData?.ok && actionData.id !== handled.current) {
      handled.current = actionData.id;
      setAddOpen(false);
    }
  }, [actionData]);

  const monitored = clients.filter((client) => client.lastCapturedAt).length;
  const withWork = clients.filter((client) => client.opportunityCount > 0).length;

  return (
    <div>
      <div className="pagehead">
        <div className="pagehead-copy">
          <span className="eyebrow">Portfolio</span>
          <h1 className="title-page">Clients</h1>
          <p className="summary-line">
            <b>{clients.length}</b>
            <span>{pluralize(clients.length, "business", "businesses")} monitored</span>
            {clients.length > 0 && (
              <>
                <span className="dot-sep">·</span>
                <span>{monitored} analyzed</span>
                <span className="dot-sep">·</span>
                <span>
                  {withWork} with open {pluralize(withWork, "opportunity", "opportunities")}
                </span>
              </>
            )}
          </p>
        </div>
        {clients.length > 0 && (
          <div className="pagehead-actions">
            <button className="btn btn-primary" type="button" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={15} />
              Add client
            </button>
          </div>
        )}
      </div>

      {actionData?.ok && (
        <div className="notice ok" role="status">
          <Icon name="check" size={15} />
          <span>
            Client added. <Link to={"/clients/" + actionData.id}>Open it to analyze the site</Link>.
          </span>
        </div>
      )}
      {actionData && !actionData.ok && (
        <div className="notice err" role="alert">
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}

      {clients.length === 0 ? (
        <EmptyState
          icon="users"
          title="No clients yet"
          actions={
            <button className="btn btn-primary" type="button" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={15} />
              Add your first client
            </button>
          }
        >
          Add a business you already look after. Client Growth watches its site and tells you when
          there is legitimate, billable work to bring up.
        </EmptyState>
      ) : (
        <ul className="records">
          {clients.map((client) => (
            <li key={client.id}>
              <ClientRow client={client} />
            </li>
          ))}
        </ul>
      )}

      <SidePanel
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a client"
        description="The website and what this business sells. Both feed the analysis."
      >
        <Form method="post">
          <div className="field">
            <label htmlFor="new-client-name">Client name</label>
            <input id="new-client-name" name="name" type="text" required />
          </div>
          <div className="field">
            <label htmlFor="new-client-domain">Website</label>
            <input
              id="new-client-domain"
              name="domain"
              type="text"
              placeholder="example.com"
              required
            />
            <div className="field-hint">https:// is optional.</div>
          </div>
          <div className="field">
            <label htmlFor="new-client-offerings">What this business sells</label>
            <textarea
              id="new-client-offerings"
              name="offerings"
              placeholder={"One per line\nheat pump installation\nair conditioning repair"}
            />
            <div className="field-hint">
              Used to check whether their site actually covers what they sell.
            </div>
          </div>
          <div className="field">
            <label htmlFor="new-client-notes">Notes</label>
            <textarea id="new-client-notes" name="notes" placeholder="Optional context for your team" />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Adding…" : "Add client"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
          </div>
        </Form>
      </SidePanel>
    </div>
  );
}

function ClientRow({ client }: { client: EnrichedClient }) {
  const analyzed = Boolean(client.lastCapturedAt);
  const state = !analyzed ? "idle" : client.opportunityCount > 0 ? "live" : "clean";
  const stateLabel = !analyzed
    ? "Not analyzed"
    : client.opportunityCount > 0
      ? "Open opportunities"
      : "Clean";

  return (
    <Link className="record" to={"/clients/" + client.id}>
      <span className={"state-dot " + state} title={stateLabel}>
        <span className={"dot" + (analyzed ? "" : " hollow")} />
        <span className="sr-only">{stateLabel}</span>
      </span>
      <span className="record-main">
        <span className="record-name">{client.name}</span>
        <span className="record-meta">
          <span>{client.domain}</span>
          <span className="dot-sep">·</span>
          <span>
            {client.offerings.length} {pluralize(client.offerings.length, "offering", "offerings")}
          </span>
        </span>
      </span>
      <span className="record-end">
        <span className={"record-stat" + (client.opportunityCount > 0 ? "" : " is-zero")}>
          <b>{client.opportunityCount > 0 ? client.opportunityCount : "—"}</b>
          <span>{pluralize(client.opportunityCount, "opportunity", "opportunities")}</span>
        </span>
        <span className="record-stat wide is-zero">
          <b style={{ fontWeight: 500 }}>
            {analyzed ? formatDate(client.lastCapturedAt) : "Never"}
          </b>
          <span>analyzed</span>
        </span>
        <Icon name="chevron-right" size={15} className="record-chevron" />
      </span>
    </Link>
  );
}
