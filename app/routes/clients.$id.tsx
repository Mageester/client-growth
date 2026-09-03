import type { ReactNode } from "react";
import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";

import { ClientSchema } from "@/core/schema";
import { assessCatalogCoverage } from "@/core/rules/registry";
import { assessAnalysisReadiness, type ReadinessState } from "@/core/analysisReadiness";
import { assessServiceCoverage } from "@/core/absenceVerification";
import { suggestOfferings, type SuggestedOffering } from "@/core/offeringSuggestions";
import {
  CADENCE_LABEL,
  SELECTABLE_CADENCES,
  changeHeadline,
  isMonitoringCadence,
  type MonitoringCadence,
  type MonitoringState,
} from "@/core/monitoring";
import * as monitoringRepo from "@/db/monitoring";
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
  SidePanel,
  StateDot,
  formatCompactRange,
  formatCurrencyRange,
  formatDate,
  formatDue,
  formatRelative,
  pluralize,
} from "../components/ui";
import { requireTenant } from "../lib/session.server";
import { normalizeDomain, offeringWarnings, validateClientInput } from "../lib/validation";
import type { Route } from "./+types/clients.$id";

/** The readiness shape after it has crossed the loader's JSON boundary. */
type AnalysisReadinessView = {
  state: ReadinessState;
  rules: Array<{
    ruleId: string;
    label: string;
    state: ReadinessState;
    reason: string;
    actionable: boolean;
  }>;
  catalog: { matched: number; total: number; unmatchedLabels: string[] };
  readyCount: number;
  total: number;
};

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? data.client.name + " · Axiom Orbit" : "Client" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  // Onboarding sends the user here when the very first analysis could not run, so
  // the workspace is usable and the failure is explained rather than swallowed.
  const firstRunFailed = new URL(request.url).searchParams.get("firstRun") === "failed";
  const client = await repo.getClient(t.scope, params.id);
  if (!client) throw new Response("Client not found", { status: 404 });
  const [services, coverage, opportunities, runs, monitoring, evidence] = await Promise.all([
    repo.listServices(t.scope),
    repo.listCoverage(t.scope, client.id),
    repo.listOpportunities(t.scope, client.id),
    repo.listAnalysisRuns(t.scope, client.id, 6),
    monitoringRepo.getMonitoring(t.scope, client.id),
    repo.getLatestEvidence(t.scope, client.id),
  ]);
  const totals = totalsFor(opportunities);
  const latest = runs[0] ?? null;

  // What the site's own evidence says this business sells that the client's
  // profile does not mention. Read-only and never applied automatically: the
  // agency confirms every line. See <SuggestedServices/>.
  const suggestions = evidence
    ? suggestOfferings({ evidence, existingOfferings: client.offerings, max: 8 })
    : [];

  // Readiness is per rule, and it is worked out from what the LAST crawl
  // actually managed rather than from the client's offering count alone. That
  // is what lets the page tell "your setup is thin" apart from "we could not
  // read this site" — two sentences that need two different reactions.
  const crawlCoverage = evidence ? assessServiceCoverage({ client, evidence }) : null;
  const readiness = assessAnalysisReadiness({
    catalog: services,
    offerings: client.offerings.length,
    lastCrawl: evidence
      ? {
          analyzable: crawlCoverage?.analyzable ?? false,
          limitation: crawlCoverage?.limitation ?? null,
          readablePages: evidence.site.pages.filter(
            (page) => page.status >= 200 && page.status < 300 && page.wordCount > 0,
          ).length,
          suggestedOfferings: suggestions.length,
        }
      : undefined,
  });

  return {
    client,
    services,
    coveredIds: coverage.map((c) => c.serviceId),
    opportunities,
    totals,
    runs,
    monitoring: monitoring ?? monitoringRepo.MONITORING_OFF,
    firstRunFailed,
    readiness,
    suggestions,
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

  // Confirming suggested offerings. The suggestions themselves are computed
  // from crawled evidence and shown for review; this is the only path that
  // writes any of them, it only ever runs because a person pressed the button,
  // and it appends — an existing offering is never rewritten or removed.
  if (intent === "accept-suggestions") {
    const accepted = form
      .getAll("offering")
      .map((value) => String(value).trim())
      .filter(Boolean);
    if (accepted.length === 0) {
      return { ok: false as const, error: "No suggested services were selected." };
    }

    const existingKeys = new Set(existing.offerings.map((o) => o.trim().toLowerCase()));
    const added = accepted.filter((o) => !existingKeys.has(o.toLowerCase()));
    const offerings = [...existing.offerings, ...added];
    const problem = validateClientInput({
      name: existing.name,
      domain: existing.domain,
      offerings: offerings.join("\n"),
    });
    if (problem) return { ok: false as const, error: problem };

    await repo.upsertClient(
      t.scope,
      ClientSchema.parse({ ...existing, offerings }),
    );
    return {
      ok: true as const,
      message:
        added.length === 0
          ? "Those services were already in this client's profile."
          : `Added ${added.length} ${added.length === 1 ? "service" : "services"} to ${existing.name}. Re-analyze to check them against the site.`,
    };
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

  if (intent === "set-monitoring") {
    const cadence = String(form.get("cadence") ?? "");
    if (!isMonitoringCadence(cadence)) {
      return { ok: false as const, error: "That is not a monitoring option." };
    }
    // The first scheduled check is measured from the last completed analysis, so
    // enabling monitoring right after analyzing does not immediately re-scan.
    const latest = await repo.getLatestAnalysisRun(t.scope, existing.id);
    const state = await monitoringRepo.setMonitoringCadence(t.scope, existing.id, cadence, {
      lastAnalyzedAt: latest?.finishedAt ?? null,
    });
    if (!state) return { ok: false as const, error: "Client not found." };
    return {
      ok: true as const,
      message:
        state.cadence === "off"
          ? "Monitoring turned off. This client is only checked when you press Analyze."
          : `Monitoring on. ${existing.name} will be checked ${CADENCE_LABEL[
              state.cadence
            ].toLowerCase()}, starting ${formatDate(state.nextDueAt, true)}.`,
    };
  }

  if (intent === "analyze") {
    // The button is disabled for this, but a form post must not be able to
    // start a run that provably cannot check anything.
    if (assessCatalogCoverage(await repo.listServices(t.scope)).matched === 0) {
      return {
        ok: false as const,
        error:
          "No active service is offered for a kind of website gap, so an analysis could not check anything. Set that up in your catalog first.",
      };
    }
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
  const {
    client,
    services,
    coveredIds,
    opportunities,
    totals,
    runs,
    monitoring,
    state,
    firstRunFailed,
    readiness,
    suggestions,
  } = loaderData;
  const navigation = useNavigation();
  const intent = navigation.formData?.get("intent");
  const analyzing = intent === "analyze";
  const saving = intent === "save";
  const busy = navigation.state !== "idle";
  const [editOpen, setEditOpen] = useState(false);

  // A run is worth starting when ANY rule can produce a finding. Blocking it
  // because one of two rules is limited would refuse to look for a broken
  // checkout on a client whose offerings list happens to be short.
  const canAnalyze = readiness.catalog.matched > 0;
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
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || !canAnalyze}
                title={
                  canAnalyze
                    ? undefined
                    : "Add a service that is offered for a website gap before analyzing."
                }
              >
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

      <MonitoringRow monitoring={monitoring} busy={busy} canAnalyze={canAnalyze} />

      <Readiness readiness={readiness} clientName={client.name} />
      <SuggestedServices
        suggestions={suggestions}
        clientName={client.name}
        busy={busy}
        onEditClient={() => setEditOpen(true)}
      />

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
                        <b className="num">{Math.round(opp.confidence * 100)}%</b>
                        <span>confident</span>
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
            Without this list, Axiom Orbit cannot tell whether the site covers what the business
            actually does — so it will not claim anything is missing.
          </EmptyState>
        ) : (
          <>
            <ul className="tag-row tag-row-lg">
              {client.offerings.map((offering) => (
                <li key={offering} className="pill quiet">
                  {offering}
                </li>
              ))}
            </ul>
            <OfferingQuality offerings={client.offerings} onEdit={() => setEditOpen(true)} />
          </>
        )}
        {client.notes && <p className="prose client-notes">{client.notes}</p>}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Analysis history</h2>
            <p>
              Every check and what it concluded, including the ones that concluded nothing and the
              ones that ran while nobody was watching.
            </p>
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
                    {run.trigger === "scheduled" && (
                      <>
                        <span className="dot-sep">·</span>
                        <span className="pill quiet runlog-trigger">Monitoring</span>
                      </>
                    )}
                  </div>
                  <p className="runlog-summary">{run.summary}</p>
                  {(run.newCount > 0 || run.resolvedCount > 0) && (
                    <p className="runlog-change">
                      {[
                        run.newCount > 0
                          ? `${run.newCount} new ${pluralize(run.newCount, "opportunity", "opportunities")}`
                          : null,
                        run.resolvedCount > 0
                          ? `${run.resolvedCount} fixed since the previous check`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
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
            <label htmlFor="edit-offerings">What customers hire this business for</label>
            <textarea
              id="edit-offerings"
              name="offerings"
              rows={6}
              defaultValue={client.offerings.join("\n")}
            />
            <div className="field-hint">
              One per line: things customers actually hire or pay them for. Not claims about the
              business — no "free quotes", "fully insured", "family owned" or "financing available".
              Two or more makes the analysis far better.
            </div>
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

/**
 * Monitoring, stated in one line.
 *
 * The whole feature is "you do not have to remember to press Analyze", so the
 * only things worth showing are whether it is on, when it last looked, when it
 * looks next, and how to change that. Everything a run produced already has a
 * home in the findings and the history below.
 *
 * The last outcome is only shown when it is something the agency should know
 * about: a check that could not read the site, or a run of failures. A healthy
 * weekly check should be quiet.
 */
function MonitoringRow({
  monitoring,
  busy,
  canAnalyze,
}: {
  monitoring: MonitoringState;
  busy: boolean;
  canAnalyze: boolean;
}) {
  const on = monitoring.cadence !== "off";
  const troubled =
    monitoring.lastOutcome === "failed" || monitoring.lastOutcome === "inconclusive";

  return (
    <div className={"monitorbar" + (on ? " is-on" : "")}>
      <div className="monitorbar-copy">
        <span className="monitorbar-label">
          <Icon name="refresh" size={13} />
          Monitoring
        </span>
        <span className="monitorbar-state">{CADENCE_LABEL[monitoring.cadence]}</span>
        {on ? (
          <span className="monitorbar-meta">
            <span className="dot-sep">·</span>
            <span>
              {monitoring.lastSuccessAt
                ? "last checked " + formatRelative(monitoring.lastSuccessAt)
                : "not checked yet"}
            </span>
            {monitoring.nextDueAt && (
              <>
                <span className="dot-sep">·</span>
                <span>next check {formatDue(monitoring.nextDueAt)}</span>
              </>
            )}
          </span>
        ) : (
          <span className="monitorbar-meta">
            <span className="dot-sep">·</span>
            <span>this client is only checked when you press Analyze</span>
          </span>
        )}
      </div>

      <Form method="post" className="monitorbar-actions">
        <input type="hidden" name="intent" value="set-monitoring" />
        <label className="sr-only" htmlFor="monitoring-cadence">
          Monitoring frequency
        </label>
        <select
          id="monitoring-cadence"
          name="cadence"
          defaultValue={monitoring.cadence}
          disabled={busy || !canAnalyze}
          className="monitorbar-select"
        >
          {(SELECTABLE_CADENCES as readonly MonitoringCadence[]).map((cadence) => (
            <option key={cadence} value={cadence}>
              {CADENCE_LABEL[cadence]}
            </option>
          ))}
          {/* Keeps a cadence set elsewhere visible instead of silently rewriting it. */}
          {!(SELECTABLE_CADENCES as readonly string[]).includes(monitoring.cadence) && (
            <option value={monitoring.cadence}>{CADENCE_LABEL[monitoring.cadence]}</option>
          )}
        </select>
        <button
          type="submit"
          className="btn btn-sm"
          disabled={busy || !canAnalyze}
          title={
            canAnalyze
              ? undefined
              : "Add a service that is offered for a website gap before turning monitoring on."
          }
        >
          Save
        </button>
      </Form>

      {on && troubled && (
        <p className="monitorbar-note">
          {changeHeadline(monitoring.lastOutcome ?? "failed", {
            newCount: 0,
            stillOpenCount: 0,
            resolvedCount: 0,
          })}
          {monitoring.consecutiveFailures > 1 &&
            ` The last ${monitoring.consecutiveFailures} checks in a row could not be completed.`}{" "}
          Nothing was concluded and no finding was changed.
        </p>
      )}
    </div>
  );
}

/**
 * What this analysis would actually be able to check — shown BEFORE the run,
 * not explained afterwards.
 *
 * Two things this deliberately does NOT do.
 *
 * It does not collapse the rules into one verdict. Whether the crawl can reach
 * a site's service pages decides whether a missing page can be claimed; it has
 * nothing to do with whether a call-to-action returns 404. A client with one
 * offering used to be warned as though nothing could be checked, which is both
 * untrue and discouraging.
 *
 * And it does not offer the agency a fix for something they cannot fix. When
 * the limit is the crawler, it says so plainly. Telling someone to add more
 * offerings when the real problem is that the site would not load is worse than
 * saying nothing: they do the work and the next run fails identically.
 */
function Readiness({
  readiness,
  clientName,
}: {
  readiness: AnalysisReadinessView;
  clientName: string;
}) {
  // Nothing in the catalog answers any kind of website gap: the run cannot
  // produce a finding whatever the site looks like.
  if (readiness.catalog.matched === 0) {
    return (
      <div className="notice err" role="alert">
        <Icon name="alert" size={15} />
        <span>
          An analysis cannot check anything yet. Every finding is priced from something you sell,
          and no active service says which kind of website gap it answers.{" "}
          <Link className="link" to="/services">
            Set that up in your catalog
          </Link>
          , then analyze.
        </span>
      </div>
    );
  }

  const limited = readiness.rules.filter((rule) => rule.state !== "ready");
  if (limited.length === 0) return null;

  return (
    <>
      {limited.map((rule) => (
        <div
          className={rule.state === "not_ready" ? "notice warn" : "notice"}
          role="status"
          key={rule.ruleId}
        >
          <Icon name="alert" size={15} />
          <span>
            <strong>{rule.label}</strong> — {rule.reason}{" "}
            {rule.state === "not_ready" && (
              <Link className="link" to="/services">
                Open the catalog
              </Link>
            )}
            {rule.state === "site_coverage_limited" && !rule.actionable && (
              <span className="faint">
                {clientName}&rsquo;s setup is not the limit here, so there is nothing to change.
              </span>
            )}
          </span>
        </div>
      ))}
    </>
  );
}

/**
 * "These look like services customers can hire this business for."
 *
 * This is the difference between a scanner that says "insufficient coverage"
 * and a product. When a client cannot be analyzed because Axiom Orbit was
 * told about one of the six things the business sells, the site itself already
 * contains the answer — and the run that failed has it sitting in evidence.
 *
 * Every line here is a SUGGESTION. Nothing is added by opening this panel, and
 * nothing is added by ignoring it. The agency opens the editor, keeps what is
 * right, changes what is nearly right, and deletes the rest. Each suggestion
 * shows where it came from, because a list of services with no provenance is
 * something an agency has to verify from scratch anyway.
 */
function SuggestedServices({
  suggestions,
  clientName,
  busy,
  onEditClient,
}: {
  suggestions: SuggestedOffering[];
  clientName: string;
  busy: boolean;
  onEditClient: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (suggestions.length === 0) return null;

  return (
    <div className="notice suggested-services" role="status">
      <Icon name="alert" size={15} />
      <div>
        <p>
          The last crawl found {suggestions.length}{" "}
          {pluralize(suggestions.length, "service", "services")} on this site that{" "}
          {suggestions.length === 1 ? "is" : "are"} not in {clientName}&rsquo;s profile. These look
          like services customers can hire this business for.
        </p>
        <button type="button" className="btn" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Review suggested services"}
        </button>

        {open && (
          <>
            <ul className="suggestion-list">
              {suggestions.map((suggestion) => (
                <li key={suggestion.label}>
                  <div className="suggestion-head">
                    <span className="suggestion-label">{suggestion.label}</span>
                    <span className="pill faint">
                      {suggestion.confidence === "high" ? "Strong evidence" : "Worth checking"}
                    </span>
                  </div>
                  <ul className="suggestion-evidence">
                    {suggestion.evidence.map((item, index) => (
                      <li key={index}>
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noreferrer" className="link">
                            {item.detail}
                          </a>
                        ) : (
                          item.detail
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <Form method="post" className="suggestion-actions">
              <input type="hidden" name="intent" value="accept-suggestions" />
              {suggestions.map((suggestion) => (
                <input key={suggestion.label} type="hidden" name="offering" value={suggestion.label} />
              ))}
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Add all {suggestions.length} to {clientName}
              </button>
              <button type="button" className="btn" onClick={onEditClient} disabled={busy}>
                Edit the list instead
              </button>
            </Form>
            <p className="faint">
              Nothing has been added yet. Anything you add is checked against the site like a
              service, and a missing page for one would be priced like a service.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Says out loud when the offerings list contains things nobody buys.
 *
 * Every line in that box is checked against the site and a gap becomes a priced
 * page recommendation, so "fully insured" sitting in there is one analysis away
 * from a proposal for a page about the client's insurance. The warning is
 * advisory and nothing is removed — the agency may have a good reason — but it
 * is stated plainly, before a run turns it into a number.
 */
function OfferingQuality({
  offerings,
  onEdit,
}: {
  offerings: string[];
  onEdit: () => void;
}) {
  const warnings = offeringWarnings(offerings);
  if (warnings.length === 0) return null;

  return (
    <div className="notice warn offering-quality">
      <Icon name="alert" size={14} />
      <div>
        <p>
          {warnings.length === 1
            ? "One entry looks like a claim about the business rather than work customers buy:"
            : `${warnings.length} entries look like claims about the business rather than work customers buy:`}
        </p>
        <ul className="tag-row">
          {warnings.map((w) => (
            <li key={w.value} className="pill">
              {w.value} <span className="faint">— {w.kind}</span>
            </li>
          ))}
        </ul>
        <p className="faint">
          Nothing has been changed. Left in the list, each of these is checked against the site like
          a service, and a missing page for one would be priced like a service.{" "}
          <button type="button" className="btn-link" onClick={onEdit}>
            Edit the list
          </button>
          .
        </p>
      </div>
    </div>
  );
}
