import { Form, Link, redirect, useNavigation } from "react-router";

import { ClientSchema } from "@/core/schema";
import * as repo from "@/db/repositories";
import {
  EmptyState,
  Icon,
  formatCurrencyRange,
  formatDate,
  pluralize,
} from "../components/ui";
import { runAnalysis } from "../lib/analysis.server";
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
  return {
    client,
    services,
    coveredIds: coverage.map((c) => c.serviceId),
    lastCapturedAt: evidence?.capturedAt ?? null,
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
    const updated = ClientSchema.parse({
      id: existing.id,
      name: String(form.get("name") ?? existing.name).trim(),
      domain: String(form.get("domain") ?? existing.domain)
        .trim()
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, ""),
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
      await runAnalysis(t.scope, context.cloudflare.env as never, existing.id);
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
  const { client, services, coveredIds, lastCapturedAt, opportunityCount } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const analyzing = navigation.formData?.get("intent") === "analyze";

  return (
    <div className="detail">
      <Link className="backlink" to="/clients">
        <Icon name="arrow-left" size={14} />
        Clients
      </Link>

      <header className="detail-head">
        <div className="detail-head-row">
          <div>
            <span className="eyebrow">Client</span>
            <h1 className="title-lg">{client.name}</h1>
            <div className="detail-meta">
              <a
                href={"https://" + client.domain}
                target="_blank"
                rel="noreferrer"
                className="row-tight"
              >
                {client.domain}
                <Icon name="external" size={12} />
              </a>
              <span className="dot-sep">·</span>
              <span>
                {client.offerings.length}{" "}
                {pluralize(client.offerings.length, "offering", "offerings")} tracked
              </span>
            </div>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="analyze" />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Icon name="refresh" size={15} className={analyzing ? "spin" : undefined} />
              {analyzing ? "Analyzing…" : lastCapturedAt ? "Re-analyze site" : "Analyze site"}
            </button>
          </Form>
        </div>

        <dl className="factbar">
          <div className="fact">
            <dt>Last analyzed</dt>
            <dd>{lastCapturedAt ? formatDate(lastCapturedAt, true) : "Never"}</dd>
          </div>
          <div className="fact">
            <dt>Open opportunities</dt>
            <dd>
              {opportunityCount > 0 ? (
                <Link className="link" to={"/opportunities?client=" + client.id}>
                  {opportunityCount}{" "}
                  {pluralize(opportunityCount, "opportunity", "opportunities")}
                </Link>
              ) : (
                <span className="faint">None</span>
              )}
            </dd>
          </div>
          <div className="fact">
            <dt>Covered by contract</dt>
            <dd>
              {coveredIds.length > 0 ? (
                `${coveredIds.length} of ${services.length}`
              ) : (
                <span className="faint">Nothing marked</span>
              )}
            </dd>
          </div>
        </dl>
      </header>

      {actionData && "ok" in actionData && actionData.ok && (
        <div className="notice ok" role="status" style={{ marginTop: "1.15rem" }}>
          <Icon name="check" size={15} />
          <span>{actionData.message}</span>
        </div>
      )}
      {actionData && "ok" in actionData && !actionData.ok && (
        <div className="notice err" role="alert" style={{ marginTop: "1.15rem" }}>
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Contract coverage</h2>
            <p>
              Work you already do for this client under contract. Covered offerings are never
              surfaced as a billable opportunity.
            </p>
          </div>
        </div>
        {services.length === 0 ? (
          <EmptyState
            icon="briefcase"
            title="No services in your catalog"
            inset
            actions={
              <Link className="btn" to="/services">
                Open catalog
              </Link>
            }
          >
            Add the work your agency sells before marking what this client already pays for.
          </EmptyState>
        ) : (
          <ul className="records">
            {services.map((service) => {
              const covered = coveredIds.includes(service.id);
              return (
                <li key={service.id}>
                  <Form method="post" className="record">
                    <input type="hidden" name="intent" value="toggle-coverage" />
                    <input type="hidden" name="serviceId" value={service.id} />
                    {!covered && <input type="hidden" name="covered" value="on" />}
                    <button
                      type="submit"
                      className={"check-toggle" + (covered ? " on" : "")}
                      disabled={busy}
                      aria-pressed={covered}
                      aria-label={
                        (covered ? "Remove coverage for " : "Mark as covered: ") + service.name
                      }
                    >
                      <Icon name="check" size={12} strokeWidth={2.4} />
                    </button>
                    <span className="record-main">
                      <span className="record-name">{service.name}</span>
                      <span className="record-meta">
                        <span>{covered ? "Covered by contract" : "Available to sell"}</span>
                        {!service.active && (
                          <>
                            <span className="dot-sep">·</span>
                            <span>Inactive in catalog</span>
                          </>
                        )}
                      </span>
                    </span>
                    <span className="record-end">
                      <span className="record-stat wide is-zero">
                        <b style={{ fontWeight: 550 }}>
                          {formatCurrencyRange(service.priceMin, service.priceMax)}
                        </b>
                        <span>typical range</span>
                      </span>
                    </span>
                  </Form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Details</h2>
            <p>The site and offering context every analysis is checked against.</p>
          </div>
        </div>
        <Form method="post" style={{ maxWidth: "34rem" }}>
          <input type="hidden" name="intent" value="save" />
          <div className="field-row">
            <div className="field">
              <label htmlFor="name">Client name</label>
              <input id="name" name="name" type="text" defaultValue={client.name} />
            </div>
            <div className="field">
              <label htmlFor="domain">Website</label>
              <input id="domain" name="domain" type="text" defaultValue={client.domain} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="offerings">What this business sells</label>
            <textarea id="offerings" name="offerings" defaultValue={client.offerings.join("\n")} />
            <div className="field-hint">One per line.</div>
          </div>
          <div className="field">
            <label htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              name="notes"
              defaultValue={client.notes}
              placeholder="Optional context for your team"
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy && !analyzing ? "Saving…" : "Save changes"}
            </button>
          </div>
        </Form>
      </section>
    </div>
  );
}
