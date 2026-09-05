import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Form, Link, useNavigation } from "react-router";

import { ClientSchema } from "@/core/schema";
import * as repo from "@/db/repositories";
import {
  CLIENT_STATE_LABEL,
  CLIENT_STATE_ORDER,
  clientState,
  totalsFor,
} from "../lib/portfolio";
import {
  EmptyState,
  Icon,
  PageContextMeta,
  SidePanel,
  StateDot,
  formatCompactRange,
  formatRelative,
  pluralize,
} from "../components/ui";
import { ClientMark } from "../components/entity-mark";
import { OfferingGuidance } from "../components/offering-guidance";
import { requireTenant } from "../lib/session.server";
import { normalizeDomain, validateClientInput } from "../lib/validation";
import type { Route } from "./+types/clients._index";

export function meta() {
  return [{ title: "Clients · Axiom Orbit" }];
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
  // Three queries regardless of portfolio size.
  const [clients, runsByClient, oppsByClient] = await Promise.all([
    repo.listClients(t.scope),
    repo.latestAnalysisRunByClient(t.scope),
    repo.listOpportunitiesByClient(t.scope),
  ]);
  const enriched = clients.map((client) => {
    const totals = totalsFor(oppsByClient.get(client.id) ?? []);
    const run = runsByClient.get(client.id) ?? null;
    return {
      ...client,
      totals,
      lastRunAt: run?.finishedAt ?? null,
      runSummary: run?.summary ?? null,
      state: clientState({ outcome: run?.outcome ?? null, openCount: totals.open }),
    };
  });
  return { clients: enriched };
}

export async function action({ request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const form = await request.formData();
  const input = {
    name: String(form.get("name") ?? ""),
    domain: String(form.get("domain") ?? ""),
    offerings: String(form.get("offerings") ?? ""),
  };
  const problem = validateClientInput(input);
  if (problem) return { ok: false as const, error: problem };

  const domain = normalizeDomain(input.domain);
  const existing = await repo.listClients(t.scope);
  const duplicate = existing.find((client) => client.domain.toLowerCase() === domain);
  if (duplicate) {
    return {
      ok: false as const,
      error: `${duplicate.name} is already watching ${domain}.`,
    };
  }

  const client = ClientSchema.parse({
    id: slugId(input.name),
    name: input.name.trim(),
    domain,
    offerings: input.offerings
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    notes: String(form.get("notes") ?? "").trim(),
  });
  await repo.upsertClient(t.scope, client);
  return { ok: true as const, id: client.id, name: client.name };
}

type EnrichedClient = Awaited<ReturnType<typeof loader>>["clients"][number];

export default function ClientsIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { clients } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [addOpen, setAddOpen] = useState(false);
  const [newOfferings, setNewOfferings] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (actionData?.ok && actionData.id !== handled.current) {
      handled.current = actionData.id;
      setAddOpen(false);
      setNewOfferings("");
    }
  }, [actionData]);

  const ordered = [...clients].sort(
    (a, b) =>
      CLIENT_STATE_ORDER[a.state] - CLIENT_STATE_ORDER[b.state] ||
      b.totals.priceMax - a.totals.priceMax ||
      a.name.localeCompare(b.name),
  );
  const shown = deferredQuery
    ? ordered.filter(
        (client) =>
          client.name.toLowerCase().includes(deferredQuery) ||
          client.domain.toLowerCase().includes(deferredQuery),
      )
    : ordered;
  const portfolioValue = clients.reduce(
    (total, client) => ({
      min: total.min + client.totals.priceMin,
      max: total.max + client.totals.priceMax,
    }),
    { min: 0, max: 0 },
  );

  return (
    <div className="directory-page clients-directory">
      <PageContextMeta />
      <div className="pagehead">
        <div className="pagehead-copy">
          <span className="eyebrow">Clients</span>
          <h1 className="title-page">Clients</h1>
          <p className="summary-line">
            <b className="num">{clients.length}</b>
            <span>{pluralize(clients.length, "client", "clients")}</span>
            <span className="dot-sep">·</span>
            <b className="num">
              {portfolioValue.max > 0
                ? formatCompactRange(portfolioValue.min, portfolioValue.max)
                : "—"}
            </b>
            <span>potential revenue</span>
          </p>
        </div>
        <div className="pagehead-actions">
          <label className="orbit-search">
            <Icon name="search" size={17} />
            <span className="sr-only">Search clients</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search clients…"
            />
          </label>
          {clients.length > 0 && (
            <button className="btn btn-primary" type="button" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={15} />
              Add client
            </button>
          )}
        </div>
      </div>

      {actionData?.ok && (
        <div className="notice ok" role="status">
          <Icon name="check" size={15} />
          <span>
            {actionData.name} added.{" "}
            <Link to={"/clients/" + actionData.id}>Open it and analyze the site</Link>.
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
          Add a business you already look after. Axiom Orbit watches its website and tells you
          when there is legitimate, billable work worth bringing up.
        </EmptyState>
      ) : (
        <div className="records-table clients-table">
          <div className="records-head" aria-hidden="true">
            <span>Client</span>
            <span>Opportunities</span>
            <span>Potential value</span>
            <span>Status</span>
            <span>Last checked</span>
            <span />
          </div>
          <ul className="records">
          {shown.map((client) => (
            <li key={client.id}>
              <ClientRow client={client} />
            </li>
          ))}
          </ul>
          {shown.length === 0 && (
            <p className="table-empty">No clients match “{query}”.</p>
          )}
        </div>
      )}

      <SidePanel
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a client"
        description="The website, and what this business sells. Both feed every analysis."
      >
        <Link className="panel-import-link" to="/clients/import">
          Import multiple clients instead
          <Icon name="arrow-right" size={14} />
        </Link>
        <Form method="post">
          <div className="field">
            <label htmlFor="new-client-name">Client name</label>
            <input id="new-client-name" name="name" type="text" required autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="new-client-domain">Website</label>
            <input
              id="new-client-domain"
              name="domain"
              type="text"
              placeholder="example.com"
              required
              autoComplete="off"
              inputMode="url"
            />
            <div className="field-hint">Just the domain — https:// is optional.</div>
          </div>
          <div className="field">
            <label htmlFor="new-client-offerings">What customers hire this business for</label>
            <textarea
              id="new-client-offerings"
              name="offerings"
              rows={6}
              value={newOfferings}
              onChange={(event) => setNewOfferings(event.target.value)}
              placeholder={"heat pump installation\nair conditioning repair\nduct cleaning"}
            />
            <div className="field-hint">
              One per line: things customers actually hire or pay them for. Not claims about the
              business — no "free quotes", "fully insured", "family owned" or "financing available".
              This is what the site gets checked against and what findings get priced from, so it
              matters more than anything else on this form.
            </div>
            <OfferingGuidance raw={newOfferings} />
          </div>
          <div className="field">
            <label htmlFor="new-client-notes">Notes</label>
            <textarea
              id="new-client-notes"
              name="notes"
              rows={3}
              placeholder="Optional context for your team"
            />
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
  return (
    <Link className="record" to={"/clients/" + client.id}>
      <ClientMark name={client.name} seed={client.domain} className="client-mark" />
      <span className="record-main">
        <span className="record-name">{client.name}</span>
        <span className="record-domain">{client.domain}</span>
      </span>
      <span className="client-opportunities num">{client.totals.open}</span>
      <span className="client-value num">
        {client.totals.open > 0
          ? formatCompactRange(client.totals.priceMin, client.totals.priceMax)
          : "—"}
      </span>
      <span className={`client-status ${client.state}`}>
        <StateDot state={client.state} />
        {CLIENT_STATE_LABEL[client.state]}
      </span>
      <span className="client-checked">{formatRelative(client.lastRunAt)}</span>
      <span className="record-end">
        <Icon name="chevron-right" size={16} className="record-chevron" />
      </span>
    </Link>
  );
}
