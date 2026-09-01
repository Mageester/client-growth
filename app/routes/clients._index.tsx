import { useEffect, useRef, useState } from "react";
import { Form, Link, useNavigation } from "react-router";

import { ClientSchema } from "@/core/schema";
import * as repo from "@/db/repositories";
import {
  CLIENT_STATE_LABEL,
  CLIENT_STATE_ORDER,
  clientState,
  totalsFor,
  type ClientState,
} from "../lib/portfolio";
import {
  EmptyState,
  Icon,
  SidePanel,
  StateDot,
  formatCompactRange,
  formatRelative,
  pluralize,
} from "../components/ui";
import { requireTenant } from "../lib/session.server";
import { normalizeDomain, validateClientInput } from "../lib/validation";
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
  const [clients, runsByClient] = await Promise.all([
    repo.listClients(t.scope),
    repo.latestAnalysisRunByClient(t.scope),
  ]);
  const enriched = await Promise.all(
    clients.map(async (client) => {
      const totals = totalsFor(await repo.listOpportunities(t.scope, client.id));
      const run = runsByClient.get(client.id) ?? null;
      return {
        ...client,
        totals,
        lastRunAt: run?.finishedAt ?? null,
        runSummary: run?.summary ?? null,
        state: clientState({ outcome: run?.outcome ?? null, openCount: totals.open }),
      };
    }),
  );
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
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (actionData?.ok && actionData.id !== handled.current) {
      handled.current = actionData.id;
      setAddOpen(false);
    }
  }, [actionData]);

  const counts = clients.reduce<Record<ClientState, number>>(
    (acc, client) => ({ ...acc, [client.state]: acc[client.state] + 1 }),
    { attention: 0, clean: 0, inconclusive: 0, never: 0 },
  );
  const ordered = [...clients].sort(
    (a, b) =>
      CLIENT_STATE_ORDER[a.state] - CLIENT_STATE_ORDER[b.state] ||
      b.totals.priceMax - a.totals.priceMax ||
      a.name.localeCompare(b.name),
  );

  return (
    <div>
      <div className="pagehead">
        <div className="pagehead-copy">
          <span className="eyebrow">Portfolio</span>
          <h1 className="title-page">Clients</h1>
          <p className="summary-line">
            <b className="num">{clients.length}</b>
            <span>{pluralize(clients.length, "site watched", "sites watched")}</span>
            {clients.length > 0 && (
              <>
                <span className="dot-sep">·</span>
                <span>
                  {counts.attention > 0
                    ? `${counts.attention} ${pluralize(counts.attention, "needs", "need")} attention`
                    : "none need attention"}
                </span>
                {counts.inconclusive > 0 && (
                  <>
                    <span className="dot-sep">·</span>
                    <span>{counts.inconclusive} could not be read</span>
                  </>
                )}
                {counts.never > 0 && (
                  <>
                    <span className="dot-sep">·</span>
                    <span>{counts.never} not yet analyzed</span>
                  </>
                )}
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
          Add a business you already look after. Client Growth watches its website and tells you
          when there is legitimate, billable work worth bringing up.
        </EmptyState>
      ) : (
        <ul className="records">
          {ordered.map((client) => (
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
        description="The website, and what this business sells. Both feed every analysis."
      >
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
            <label htmlFor="new-client-offerings">What this business sells</label>
            <textarea
              id="new-client-offerings"
              name="offerings"
              rows={6}
              placeholder={"heat pump installation\nair conditioning repair\nduct cleaning"}
            />
            <div className="field-hint">
              One per line. This is what the site gets checked against, so it matters more than
              anything else on this form.
            </div>
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
      <StateDot state={client.state} />
      <span className="record-main">
        <span className="record-name">{client.name}</span>
        <span className="record-meta">
          <span className="record-domain">{client.domain}</span>
          <span className="dot-sep">·</span>
          <span>{CLIENT_STATE_LABEL[client.state]}</span>
          <span className="dot-sep">·</span>
          <span>
            {client.offerings.length} {pluralize(client.offerings.length, "offering", "offerings")}
          </span>
        </span>
      </span>
      <span className="record-end">
        <span className={"record-stat" + (client.totals.open > 0 ? "" : " is-zero")}>
          <b className="num">{client.totals.open > 0 ? client.totals.open : "—"}</b>
          <span>{pluralize(client.totals.open, "opportunity", "opportunities")}</span>
        </span>
        <span className={"record-stat wide" + (client.totals.open > 0 ? "" : " is-zero")}>
          <b className="num">
            {client.totals.open > 0
              ? formatCompactRange(client.totals.priceMin, client.totals.priceMax)
              : "—"}
          </b>
          <span>potential value</span>
        </span>
        <span className="record-stat wide is-zero">
          <b>{formatRelative(client.lastRunAt)}</b>
          <span>analyzed</span>
        </span>
        <Icon name="chevron-right" size={15} className="record-chevron" />
      </span>
    </Link>
  );
}
