import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";

import { ClientSchema } from "@/core/schema";
import * as repo from "@/db/repositories";
import { runAnalysis } from "../lib/analysis.server";
import {
  byPotentialValue,
  clientState,
  isOpen,
  statusBadge,
  totalsFor,
  CLIENT_STATE_LABEL,
} from "../lib/portfolio";
import {
  AnalysisBanner,
  AnalysisRunning,
  EmptyState,
  Fact,
  Icon,
  Meter,
  SidePanel,
  StateDot,
  formatCompactRange,
  formatCurrencyRange,
  formatDate,
  formatRelative,
  pluralize,
} from "../components/ui";
import { requireTenant } from "../lib/session.server";
import { normalizeDomain, validateClientInput } from "../lib/validation";
import type { Route } from "./+types/clients.$id";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? data.client.name + " · Client Growth" : "Client" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  // Onboarding sends the user here when the very first analysis could not run, so
  // the workspace is usable and the failure is explained rather than swallowed.
  const firstRunFailed = new URL(request.url).searchParams.get("firstRun") === "failed";
  const client = await repo.getClient(t.scope, params.id);
  if (!client) throw new Response("Client not found", { status: 404 });
  const [services, coverage, opportunities, runs] = await Promise.all([
    repo.listServices(t.scope),
    repo.listCoverage(t.scope, client.id),
    repo.listOpportunities(t.scope, client.id),
    repo.listAnalysisRuns(t.scope, client.id, 6),
  ]);
  const totals = totalsFor(opportunities);
  const latest = runs[0] ?? null;
  return {
    client,
    services,
    coveredIds: coverage.map((c) => c.serviceId),
    opportunities,
    totals,
    runs,
    firstRunFailed,
    state: clientState({ outcome: latest?.outcome ?? null, openCount: totals.open }),
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const existing = await repo.getClient(t.scope, params.id);
  if (!existing) throw new Response("Client not found", { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "save") {
    const input = {
      name: String(form.get("name") ?? ""),
      domain: String(form.get("domain") ?? ""),
      offerings: String(form.get("offerings") ?? ""),
    };
    const problem = validateClientInput(input);
    if (problem) return { ok: false as const, error: problem };
    await repo.upsertClient(
      t.scope,
      ClientSchema.parse({
        id: existing.id,
        name: input.name.trim(),
        domain: normalizeDomain(input.domain),
        offerings: input.offerings
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        notes: String(form.get("notes") ?? "").trim(),
      }),
    );
    return { ok: true as const, message: "Client details saved." };
  }

  if (intent === "toggle-coverage") {
    const serviceId = String(form.get("serviceId") ?? "");
    if (form.get("covered") === "on") {
      const applied = await repo.setCoverage(
        t.scope,
        existing.id,
        serviceId,
        "Set from the client page",
      );
      if (!applied) return { ok: false as const, error: "That service is not in your catalog." };
      return { ok: true as const, message: "Marked as covered by contract." };
    }
    await repo.removeCoverage(t.scope, existing.id, serviceId);
    return { ok: true as const, message: "Coverage removed. Future gaps here become billable." };
  }

  if (intent === "analyze") {
    try {
      const result = await runAnalysis(t.scope, context.cloudflare.env as never, existing.id);
      return {
        ok: true as const,
        message: null,
        run: {
          outcome: result.verdict.outcome,
          summary: result.verdict.summary,
          limitation: result.verdict.limitation,
        },
      };
    } catch (err) {
      const error =
        err instanceof Response
          ? `${err.status} ${err.statusText}`
          : err instanceof Error
            ? err.message
            : "Analysis could not be completed.";
      return { ok: false as const, error };
    }
  }

  throw new Response("Unknown action", { status: 400 });
}

export default function ClientDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { client, services, coveredIds, opportunities, totals, runs, state, firstRunFailed } =
    loaderData;
  const navigation = useNavigation();
  const intent = navigation.formData?.get("intent");
  const analyzing = intent === "analyze";
  const saving = intent === "save";
  const busy = navigation.state !== "idle";
  const [editOpen, setEditOpen] = useState(false);

  const latest = runs[0] ?? null;
  const open = opportunities.filter(isOpen).sort(byPotentialValue);
  const closed = opportunities.filter((opp) => !isOpen(opp)).sort(byPotentialValue);
  const activeServices = services.filter((service) => service.active);

  return (
    <div className="detail">
      <Link className="backlink" to="/clients">
        <Icon name="arrow-left" size={14} />
        Clients
      </Link>

      <header className="detail-head">
        <div className="detail-head-row">
          <div className="detail-head-copy">
            <div className="detail-meta detail-meta-top">
              <StateDot state={state} />
              <span>{CLIENT_STATE_LABEL[state]}</span>
            </div>
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
          <div className="detail-head-actions">
            <button className="btn" type="button" onClick={() => setEditOpen(true)}>
              <Icon name="pencil" size={13} />
              Edit
            </button>
            <Form method="post">
              <input type="hidden" name="intent" value="analyze" />
              <button type="submit" className="btn btn-primary" disabled={busy}>
                <Icon name="refresh" size={15} className={analyzing ? "spin" : undefined} />
                {analyzing ? "Reading the site…" : latest ? "Re-analyze" : "Analyze site"}
              </button>
            </Form>
          </div>
        </div>

        <dl className="factbar">
          <Fact label="Last analyzed">
            {latest ? formatRelative(latest.finishedAt) : <span className="faint">Never</span>}
          </Fact>
          <Fact label="Open opportunities">
            {totals.open > 0 ? (
              <Link className="link num" to={"/opportunities?client=" + client.id}>
                {totals.open}
              </Link>
            ) : (
              <span className="faint">None</span>
            )}
          </Fact>
          <Fact label="Potential value">
            {totals.open > 0 ? (
              <span className="num">{formatCompactRange(totals.priceMin, totals.priceMax)}</span>
            ) : (
              <span className="faint">—</span>
            )}
          </Fact>
          <Fact label="Covered by contract">
            {coveredIds.length > 0 ? (
              <span className="num">
                {coveredIds.length} of {services.length}
              </span>
            ) : (
              <span className="faint">Nothing marked</span>
            )}
          </Fact>
        </dl>
      </header>

      {analyzing && <AnalysisRunning clientName={client.name} domain={client.domain} />}
      {!analyzing && actionData && "run" in actionData && actionData.run && (
        <AnalysisBanner
          outcome={actionData.run.outcome}
          summary={actionData.run.summary}
          limitation={actionData.run.limitation}
        >
          {totals.open > 0 && (
            <Link className="link runcard-link" to={"/opportunities?client=" + client.id}>
              Open the findings
              <Icon name="arrow-right" size={12} />
            </Link>
          )}
        </AnalysisBanner>
      )}
      {!analyzing && actionData && actionData.ok && "message" in actionData && actionData.message && (
        <div className="notice ok" role="status">
          <Icon name="check" size={15} />
          <span>{actionData.message}</span>
        </div>
      )}
      {!analyzing && actionData && !actionData.ok && (
        <div className="notice err" role="alert">
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}

      {!analyzing && !actionData && firstRunFailed && (
        <div className="notice err" role="alert">
          <Icon name="alert" size={15} />
          <span>
            {client.name} was saved, but the first analysis could not be completed. Check the
            website address below, then try again.
          </span>
        </div>
      )}

      {!analyzing && !actionData && !firstRunFailed && latest?.outcome === "inconclusive" && (
        <AnalysisBanner
          outcome="inconclusive"
          summary={latest.summary}
          limitation={latest.limitation}
        />
      )}

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Findings</h2>
            <p>What the last analysis surfaced for this client.</p>
          </div>
          {open.length > 0 && (
            <Link className="btn btn-sm" to={"/opportunities?client=" + client.id}>
              Open in feed
              <Icon name="arrow-up-right" size={13} />
            </Link>
          )}
        </div>
        {opportunities.length === 0 ? (
          <EmptyState
            icon={state === "inconclusive" ? "alert" : state === "never" ? "target" : "check"}
            title={
              state === "never"
                ? "This site has not been read yet"
                : state === "inconclusive"
                  ? "The last analysis was inconclusive"
                  : "Nothing billable found"
            }
            inset
          >
            {state === "never"
              ? "Run an analysis to see what this client's website does and does not cover."
              : (latest?.summary ??
                "The site was read and no unmet billable work was found.")}
          </EmptyState>
        ) : (
          <ul className="records">
            {[...open, ...closed].map((opp) => {
              const badge = statusBadge(opp);
              const live = isOpen(opp);
              return (
                <li key={opp.id}>
                  <Link
                    className={"record" + (live ? "" : " is-quiet")}
                    to={"/opportunities/" + opp.id}
                  >
                    <span className="record-main">
                      <span className="record-name">{opp.title}</span>
                      <span className="record-meta">
                        <span className={"pill " + badge.tone}>{badge.label}</span>
                        <span className="dot-sep">·</span>
                        <span>{opp.detected}</span>
                      </span>
                    </span>
                    <span className="record-end">
                      <span className="record-stat wide">
                        <b className="num">{formatCurrencyRange(opp.priceMin, opp.priceMax)}</b>
                        <span>potential value</span>
                      </span>
                      <span className="record-stat">
                        <Meter value={opp.confidence} />
                        <span>{Math.round(opp.confidence * 100)}% confident</span>
                      </span>
                      <Icon name="chevron-right" size={15} className="record-chevron" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Contract coverage</h2>
            <p>
              Work you already do for this client. Covered services never appear as a billable
              opportunity, however clearly the site shows the gap.
            </p>
          </div>
        </div>
        {activeServices.length === 0 ? (
          <EmptyState
            icon="briefcase"
            title="No active services in your catalog"
            inset
            actions={
              <Link className="btn" to="/services">
                Open the catalog
              </Link>
            }
          >
            Add the work your agency sells before marking what this client already pays for.
          </EmptyState>
        ) : (
          <ul className="records">
            {activeServices.map((service) => {
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
                        (covered ? "Remove contract coverage for " : "Mark as covered by contract: ") +
                        service.name
                      }
                    >
                      <Icon name="check" size={12} strokeWidth={2.4} />
                    </button>
                    <span className="record-main">
                      <span className="record-name">{service.name}</span>
                      <span className="record-meta">
                        <span>{covered ? "Covered by contract" : "Available to sell"}</span>
                      </span>
                    </span>
                    <span className="record-end">
                      <span className="record-stat wide is-zero">
                        <b className="num">
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
            <h2 className="title-section">What this business sells</h2>
            <p>Every analysis checks the site against this list.</p>
          </div>
          <button className="btn btn-sm" type="button" onClick={() => setEditOpen(true)}>
            <Icon name="pencil" size={13} />
            Edit
          </button>
        </div>
        {client.offerings.length === 0 ? (
          <EmptyState
            icon="tag"
            title="No offerings recorded"
            inset
            actions={
              <button className="btn" type="button" onClick={() => setEditOpen(true)}>
                Add offerings
              </button>
            }
          >
            Without this list, Client Growth cannot tell whether the site covers what the business
            actually does — so it will not claim anything is missing.
          </EmptyState>
        ) : (
          <ul className="tag-row tag-row-lg">
            {client.offerings.map((offering) => (
              <li key={offering} className="pill quiet">
                {offering}
              </li>
            ))}
          </ul>
        )}
        {client.notes && <p className="prose client-notes">{client.notes}</p>}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Analysis history</h2>
            <p>Every run and what it concluded, including the runs that concluded nothing.</p>
          </div>
        </div>
        {runs.length === 0 ? (
          <p className="prose faint">No analysis has been run for this client yet.</p>
        ) : (
          <ol className="runlog">
            {runs.map((run) => (
              <li key={run.id} className={"runlog-item " + run.outcome}>
                <span className="runlog-mark" aria-hidden="true" />
                <div className="runlog-body">
                  <div className="runlog-top">
                    <span className="runlog-outcome">
                      {run.outcome === "findings"
                        ? "Findings"
                        : run.outcome === "clean"
                          ? "Clean"
                          : "Inconclusive"}
                    </span>
                    <span className="dot-sep">·</span>
                    <time dateTime={run.finishedAt}>{formatDate(run.finishedAt, true)}</time>
                    <span className="dot-sep">·</span>
                    <span className="faint">
                      {run.pagesRead} {pluralize(run.pagesRead, "page", "pages")} read
                    </span>
                  </div>
                  <p className="runlog-summary">{run.summary}</p>
                  {run.limitation && <p className="runlog-limit">{run.limitation}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <SidePanel
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit client"
        description="The site and offering context every analysis is checked against."
      >
        <Form method="post" onSubmit={() => setEditOpen(false)}>
          <input type="hidden" name="intent" value="save" />
          <div className="field">
            <label htmlFor="edit-name">Client name</label>
            <input id="edit-name" name="name" type="text" defaultValue={client.name} required />
          </div>
          <div className="field">
            <label htmlFor="edit-domain">Website</label>
            <input
              id="edit-domain"
              name="domain"
              type="text"
              defaultValue={client.domain}
              required
            />
            <div className="field-hint">Just the domain — https:// is optional.</div>
          </div>
          <div className="field">
            <label htmlFor="edit-offerings">What this business sells</label>
            <textarea
              id="edit-offerings"
              name="offerings"
              rows={6}
              defaultValue={client.offerings.join("\n")}
            />
            <div className="field-hint">One per line. Two or more makes the analysis far better.</div>
          </div>
          <div className="field">
            <label htmlFor="edit-notes">Notes</label>
            <textarea
              id="edit-notes"
              name="notes"
              rows={3}
              defaultValue={client.notes}
              placeholder="Optional context for your team"
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </button>
          </div>
        </Form>
      </SidePanel>
    </div>
  );
}
