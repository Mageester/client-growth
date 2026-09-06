import { useDeferredValue, useState, type ReactNode } from "react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";

import type { Opportunity } from "@/core/schema";
import { tierForRule } from "@/core/rules/registry";
import { byEvidencedValue, computeWinRates, winRatesFromRanked } from "@/core/winRates";
import { changeHeadline, type MonitoringOutcome } from "@/core/monitoring";
import { isAnalysisLimitExceeded } from "@/db/analysisLimits";
import * as monitoringRepo from "@/db/monitoring";
import * as repo from "@/db/repositories";
import {
  CLIENT_STATE_LABEL,
  CLIENT_STATE_ORDER,
  byPotentialValue,
  clientState,
  isOpen,
  sumTotals,
  totalsFor,
} from "../lib/portfolio";
import { OpportunityQueue, type SignalDeskEntry } from "../components/signal-desk";
import {
  AnalysisBanner,
  AnalysisRunning,
  EmptyState,
  Icon,
  Menu,
  PageContextMeta,
  StateDot,
  formatCompactRange,
  formatDue,
  formatRelative,
  pluralize,
} from "../components/ui";
import { AnalysisAbortedError, runAnalysis } from "../lib/analysis.server";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/opportunities._index";

export function meta() {
  return [{ title: "Opportunities · Axiom Orbit" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  // Six queries for the whole portfolio, not six plus one per client.
  const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
  const [clients, services, runsByClient, oppsByClient, monitoringByClient, health] =
    await Promise.all([
      repo.listClients(t.scope),
      repo.listServices(t.scope),
      repo.latestAnalysisRunByClient(t.scope),
      repo.listOpportunitiesByClient(t.scope),
      monitoringRepo.listMonitoringByClient(t.scope),
      monitoringRepo.scheduledRunHealth(t.scope, { since }),
    ]);
  const serviceName = Object.fromEntries(services.map((s) => [s.id, s.name]));
  const groups = clients.map((client) => {
    const opportunities = oppsByClient.get(client.id) ?? [];
    const totals = totalsFor(opportunities);
    const run = runsByClient.get(client.id) ?? null;
    return {
      client,
      opportunities,
      totals,
      run,
      monitoring: monitoringByClient.get(client.id) ?? monitoringRepo.MONITORING_OFF,
      state: clientState({ outcome: run?.outcome ?? null, openCount: totals.open }),
    };
  });

  // The smallest portfolio-level fact that makes monitoring worth having: how
  // much is watched, how much is waiting, and what changed while you were away.
  const portfolio = monitoringRepo.summarizePortfolio(monitoringByClient.values());
  // Measured across the whole portfolio, not the current filter: what this
  // agency converts is a property of the agency, not of the page they are on.
  const winRates = computeWinRates([...oppsByClient.values()].flat());
  return {
    groups,
    serviceName,
    winRates: winRates.ranked,
    monitoring: {
      ...portfolio,
      newFindings: health.newFindings,
      resolvedFindings: health.resolvedFindings,
      checks: health.runs,
    },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const form = await request.formData();
  const clientId = String(form.get("clientId") ?? "");
  if (!clientId) return { ok: false as const, error: "Pick a client to analyze." };
  try {
    const result = await runAnalysis(t.scope, context.cloudflare.env as never, clientId, {
      signal: request.signal,
    });
    return {
      ok: true as const,
      clientId,
      outcome: result.verdict.outcome,
      summary: result.verdict.summary,
      limitation: result.verdict.limitation,
    };
  } catch (err) {
    if (isAnalysisLimitExceeded(err)) {
      return {
        ok: false as const,
        clientId,
        error: err.reason,
        limitation: err.limitation,
      };
    }
    if (err instanceof AnalysisAbortedError) {
      return { ok: false as const, clientId, error: err.message, analysisAborted: true as const };
    }
    const error =
      err instanceof Response
        ? `${err.status} ${err.statusText}`
        : err instanceof Error
          ? err.message
          : "Analysis could not be completed.";
    return { ok: false as const, error };
  }
}

/** "Recently" for the portfolio summary. Long enough that a weekly client counts. */
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type Group = Awaited<ReturnType<typeof loader>>["groups"][number];
type Entry = { opp: Opportunity; group: Group };
export type FeedFilter = "open" | "strongest" | "all";

const STRONG_CONFIDENCE = 0.75;

export function healthSectionDescription(count: number, filter: FeedFilter): string {
  if (filter === "all") {
    return `${count} ${pluralize(count, "health finding", "health findings")} in this view. Closed items remain here for history.`;
  }
  return `${count} ${pluralize(count, "check", "checks")} worth fixing — titles, headings, descriptions and links. Supporting work rather than the reason to call.`;
}

export default function OpportunitiesIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { groups, serviceName, monitoring, winRates } = loaderData;
  // Findings are ordered by what this agency actually sells, and commercial
  // work always outranks site health however the rates fall.
  const rates = winRatesFromRanked(winRates);
  const rank = byEvidencedValue(rates);
  const navigation = useNavigation();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const analyzingId =
    navigation.state === "submitting"
      ? (navigation.formData?.get("clientId")?.toString() ?? null)
      : null;

  const analyzingClient =
    groups.find((group) => group.client.id === analyzingId) ?? null;

  const rawFilter = params.get("show");
  const filter: FeedFilter =
    rawFilter === "all" ? "all" : rawFilter === "strongest" ? "strongest" : "open";
  const selectedId = params.get("client");
  const selected = groups.find((group) => group.client.id === selectedId) ?? null;
  const scoped = selected ? [selected] : groups;

  const open: Entry[] = scoped
    .flatMap((group) => group.opportunities.filter(isOpen).map((opp) => ({ opp, group })))
    .sort((a, b) => rank(a.opp, b.opp));
  const closed: Entry[] = scoped
    .flatMap((group) =>
      group.opportunities.filter((opp) => !isOpen(opp)).map((opp) => ({ opp, group })),
    )
    .sort((a, b) => rank(a.opp, b.opp));

  const filteredByState =
    filter === "all"
      ? [...open, ...closed]
      : filter === "strongest"
        ? open.filter((entry) => entry.opp.confidence >= STRONG_CONFIDENCE)
        : open;

  const shown = deferredQuery
    ? filteredByState.filter(
        ({ opp, group }) =>
          opp.title.toLowerCase().includes(deferredQuery) ||
          group.client.name.toLowerCase().includes(deferredQuery) ||
          (serviceName[opp.suggestedServiceId] ?? "").toLowerCase().includes(deferredQuery),
      )
    : filteredByState;

  const signalEntries: SignalDeskEntry[] = shown.map(({ opp, group }) => ({
    opportunity: opp,
    client: group.client,
    serviceName: serviceName[opp.suggestedServiceId] ?? opp.suggestedServiceId,
  }));
  // The separation that decides what this product looks like. Nine of the
  // eleven rules produce site hygiene that Screaming Frog, Lighthouse and every
  // SEO suite already give away; mixed into one list they outnumber and bury
  // the two or three findings that answer "what could we sell this client",
  // and a queue led by alt-text warnings reads as a free tool with a login.
  // Same data, same evidence, same prices — the commercial work simply leads.
  const commercialEntries = signalEntries.filter(
    (entry) => tierForRule(entry.opportunity.ruleId) === "commercial",
  );
  const healthEntries = signalEntries.filter(
    (entry) => tierForRule(entry.opportunity.ruleId) === "health",
  );
  const totals = sumTotals(scoped.map((group) => group.totals));
  const portfolioTotals = sumTotals(groups.map((group) => group.totals));
  const needsAttention = groups.filter((group) => group.state === "attention").length;
  const unreadable = groups.filter((group) => group.state === "inconclusive").length;
  const neverAnalyzed = groups.filter((group) => group.state === "never").length;
  const lastRun = scoped
    .map((group) => group.run?.finishedAt ?? null)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  function withParam(key: string, value: string | null): string {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    if (key !== "opportunity") next.delete("opportunity");
    const query = next.toString();
    return query ? "?" + query : "?";
  }

  function setFilter(value: FeedFilter) {
    const next = new URLSearchParams(params);
    if (value === "open") next.delete("show");
    else next.set("show", value);
    next.delete("opportunity");
    setParams(next, { preventScrollReset: true });
  }

  if (groups.length === 0) {
    return (
      <div>
        <PageHead>
          <p className="lede">
            Axiom Orbit reads the sites you already look after and tells you where there is
            legitimate, evidence-backed work worth bringing up.
          </p>
        </PageHead>
        <EmptyState
          icon="users"
          title="Add the first site to watch"
          actions={
            <Link className="btn btn-primary" to="/clients">
              <Icon name="plus" size={15} />
              Add a client
            </Link>
          }
        >
          Every finding starts from a real page on a real client site. Add a business you look after
          and run the first analysis.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="opportunities-page">
      <PageContextMeta className="opportunities-context-meta" />
      <PageHead
        actions={
          <>
          <ClientScopeControl
            groups={groups}
            selected={selected}
            portfolioOpen={portfolioTotals.open}
            needsAttention={needsAttention}
            hrefFor={(clientId) => withParam("client", clientId)}
          />
          {open.length > 0 && (
            <label className="orbit-select-wrap">
              <span className="sr-only">Filter findings</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value as FeedFilter)}>
                <option value="open">Open ({open.length})</option>
                <option value="strongest">High confidence</option>
                <option value="all">All findings ({open.length + closed.length})</option>
              </select>
              <Icon name="chevron-down" size={13} />
            </label>
          )}
          <label className="orbit-search opportunities-search">
            <Icon name="search" size={17} />
            <span className="sr-only">Search opportunities</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search opportunities…"
            />
          </label>
          </>
        }
      >
        <p className="summary-line">
          <b className="num">{totals.open}</b>
          <span>open {pluralize(totals.open, "opportunity", "opportunities")}</span>
          {totals.open > 0 && (
            <>
              <span className="dot-sep">·</span>
              <b className="num">{formatCompactRange(totals.priceMin, totals.priceMax)}</b>
              <span>potential revenue</span>
            </>
          )}
          <span className="sr-only">
            {selected
              ? ` for ${selected.client.domain}`
              : ` across ${groups.length} ${pluralize(groups.length, "client", "clients")}`}
            {lastRun ? `, last analyzed ${formatRelative(lastRun)}` : ", never analyzed"}
          </span>
        </p>
        <p className="page-context-line">
          {selected ? (
            <>
              <a
                href={"https://" + selected.client.domain}
                target="_blank"
                rel="noreferrer"
                className="row-tight"
              >
                {selected.client.domain}
                <Icon name="external" size={13} />
              </a>
              <span className="dot-sep">·</span>
              <span>{CLIENT_STATE_LABEL[selected.state]}</span>
              {selected.run && (
                <>
                  <span className="dot-sep">·</span>
                  <span>{formatRelative(selected.run.finishedAt)}</span>
                </>
              )}
              {selected.monitoring.cadence !== "off" && (
                <>
                  <span className="dot-sep">·</span>
                  <span>next check {formatDue(selected.monitoring.nextDueAt)}</span>
                </>
              )}
            </>
          ) : (
            <span>
              {groups.length - neverAnalyzed} of {groups.length} analyzed
              {unreadable > 0 ? ` · ${unreadable} could not be read` : ""}
            </span>
          )}
        </p>
        <p className="page-context-line signal-ordering-copy">
          Ordered by commercial fit first, then what your agency converts, potential value, and confidence.
        </p>
        <MonitoringSummary monitoring={monitoring} />
      </PageHead>

      {analyzingClient && (
        <AnalysisRunning
          clientName={analyzingClient.client.name}
          domain={analyzingClient.client.domain}
          stopHref={params.toString() ? `/opportunities?${params.toString()}` : "/opportunities"}
        />
      )}
      {!analyzingClient && actionData?.ok && (
        <AnalysisBanner
          outcome={actionData.outcome}
          summary={actionData.summary}
          limitation={actionData.limitation}
          clientName={
            groups.find((group) => group.client.id === actionData.clientId)?.client.name ?? null
          }
        />
      )}
      {!analyzingClient && actionData && !actionData.ok && (
        <div className={"notice" + (actionData.limitation ? "" : " err")} role={actionData.limitation ? "status" : "alert"}>
          <Icon name={actionData.limitation ? "clock" : "alert"} size={15} />
          <span>{actionData.error}</span>
        </div>
      )}

      <div className="signal-desk">
        <section aria-label="Opportunities" className="signal-main">
          {selected?.run && <LastCheck group={selected} />}

          {selected?.run?.outcome === "inconclusive" && shown.length > 0 && (
            <AnalysisBanner
              outcome="inconclusive"
              summary={selected.run.summary}
              limitation={selected.run.limitation}
              clientName={null}
            />
          )}

          {shown.length === 0 ? (
            <FeedEmpty
              selected={selected}
              groups={groups}
              analyzingId={analyzingId}
              filter={filter}
              openCount={open.length}
              closedCount={closed.length}
              onFilter={setFilter}
            />
          ) : (
            <>
              {commercialEntries.length > 0 && (
                <>
                  <div className="signal-list-head" aria-hidden="true">
                    <span>Opportunity</span>
                    <span>Client</span>
                    <span>Value</span>
                    <span>Confidence</span>
                    <span>Age</span>
                    <span />
                  </div>
                  <OpportunityQueue
                    entries={commercialEntries}
                    hrefFor={(entry) =>
                      `/opportunities/${encodeURIComponent(entry.opportunity.id)}`
                    }
                  />
                </>
              )}

              {healthEntries.length > 0 && (
                <section className="signal-section-break">
                  <div className="feed-head-copy">
                    <h2>Site health</h2>
                    <div className="feed-head-meta">
                      <span>
                        {healthSectionDescription(healthEntries.length, filter)}
                      </span>
                    </div>
                  </div>
                  <div className="signal-list-head" aria-hidden="true">
                    <span>Finding</span>
                    <span>Client</span>
                    <span>Value</span>
                    <span>Confidence</span>
                    <span>Age</span>
                    <span />
                  </div>
                  <OpportunityQueue
                    entries={healthEntries}
                    hrefFor={(entry) =>
                      `/opportunities/${encodeURIComponent(entry.opportunity.id)}`
                    }
                  />
                </section>
              )}
            </>
          )}

          {shown.length > 0 && filter !== "all" && closed.length > 0 && (
            <button type="button" className="feed-more" onClick={() => setFilter("all")}>
              Show {closed.length} covered, snoozed &amp; dismissed{" "}
              {pluralize(closed.length, "finding", "findings")}
              <Icon name="chevron-down" size={13} />
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

function ClientScopeControl({
  groups,
  selected,
  portfolioOpen,
  needsAttention,
  hrefFor,
}: {
  groups: Group[];
  selected: Group | null;
  portfolioOpen: number;
  needsAttention: number;
  hrefFor: (clientId: string | null) => string;
}) {
  const ordered = [...groups].sort(
    (a, b) =>
      CLIENT_STATE_ORDER[a.state] - CLIENT_STATE_ORDER[b.state] ||
      b.totals.open - a.totals.open ||
      a.client.name.localeCompare(b.client.name),
  );

  return (
    <Menu
      align="end"
      triggerClassName="btn signal-client-trigger"
      triggerLabel="Filter opportunities by client"
      trigger={
        <>
          <Icon name="users" size={15} />
          <span>{selected ? selected.client.name : "All clients"}</span>
          <span className="scope-count">{selected ? selected.totals.open : portfolioOpen}</span>
          <Icon name="chevron-down" size={13} />
        </>
      }
    >
      <div className="menu-label">
        {needsAttention > 0 ? `${needsAttention} need attention` : "Portfolio is clear"}
      </div>
      <Link
        className={"menu-item" + (selected ? "" : " selected")}
        to={hrefFor(null)}
        role="menuitem"
        preventScrollReset
      >
        <Icon name="users" size={14} />
        <span>All clients</span>
        <span className="menu-item-note">{portfolioOpen} open</span>
      </Link>
      {ordered.map((group) => (
        <Link
          key={group.client.id}
          className={"menu-item" + (group.client.id === selected?.client.id ? " selected" : "")}
          to={hrefFor(group.client.id)}
          role="menuitem"
          preventScrollReset
        >
          <StateDot state={group.state} />
          <span>{group.client.name}</span>
          <span className="menu-item-note">
            {group.totals.open > 0 ? `${group.totals.open} open` : CLIENT_STATE_LABEL[group.state]}
          </span>
        </Link>
      ))}
      <div className="menu-sep" />
      <Link className="menu-item" to="/clients" role="menuitem">
        <Icon name="plus" size={14} />
        <span>Manage clients</span>
      </Link>
    </Menu>
  );
}

/**
 * The portfolio's monitoring line. One sentence, and only when monitoring is
 * actually on for something — an agency that has not enabled it should not be
 * shown a row of zeroes to explain a feature they are not using.
 */
function MonitoringSummary({
  monitoring,
}: {
  monitoring: Awaited<ReturnType<typeof loader>>["monitoring"];
}) {
  if (monitoring.monitored === 0) return null;

  const changed: string[] = [];
  if (monitoring.newFindings > 0) {
    changed.push(
      `${monitoring.newFindings} new ${pluralize(monitoring.newFindings, "opportunity", "opportunities")}`,
    );
  }
  if (monitoring.resolvedFindings > 0) {
    changed.push(`${monitoring.resolvedFindings} fixed`);
  }

  return (
    <p className="monitorline">
      <Icon name="refresh" size={13} />
      <span>
        {monitoring.monitored} {pluralize(monitoring.monitored, "client", "clients")} monitored
      </span>
      {monitoring.due > 0 && (
        <>
          <span className="dot-sep">·</span>
          <span>
            {monitoring.due} {pluralize(monitoring.due, "check", "checks")} due
          </span>
        </>
      )}
      <span className="dot-sep">·</span>
      <span>
        {changed.length > 0
          ? changed.join(" and ") + " in the last 7 days"
          : monitoring.checks > 0
            ? "nothing new in the last 7 days"
            : "no checks have run yet"}
      </span>
      {monitoring.unhealthy > 0 && (
        <>
          <span className="dot-sep">·</span>
          <span className="monitorline-warn">
            {monitoring.unhealthy}{" "}
            {monitoring.unhealthy === 1 ? "site could not" : "sites could not"} be fully analyzed
          </span>
        </>
      )}
    </p>
  );
}

/**
 * What the selected client's most recent check changed.
 *
 * The feed's job is to show work worth doing, so this deliberately reports the
 * delta rather than restating the totals already visible below it. A run that
 * could not read the site says so instead of implying the site is clean.
 */
function LastCheck({ group }: { group: Group }) {
  const run = group.run;
  if (!run) return null;

  const outcome: MonitoringOutcome = run.outcome;
  const headline = changeHeadline(outcome, {
    newCount: run.newCount,
    stillOpenCount: Math.max(0, group.totals.open - run.newCount),
    resolvedCount: run.resolvedCount,
  });
  const interesting = run.newCount > 0 || run.resolvedCount > 0;

  return (
    <p className={"lastcheck" + (interesting ? " is-change" : "")}>
      <span className="lastcheck-headline">{headline}</span>
      <span className="dot-sep">·</span>
      <span>
        {run.trigger === "scheduled" ? "Monitoring checked" : "You analyzed"} this site{" "}
        {formatRelative(run.finishedAt)}
      </span>
    </p>
  );
}

function PageHead({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="pagehead">
      <div className="pagehead-copy">
        <span className="eyebrow">Opportunities</span>
        <h1 className="title-page">Opportunities</h1>
        {children}
      </div>
      {actions && <div className="pagehead-actions">{actions}</div>}
    </div>
  );
}

function AnalyzeControl({
  groups,
  selected,
  analyzingId,
}: {
  groups: Group[];
  selected: Group | null;
  analyzingId: string | null;
}) {
  const busy = analyzingId !== null;
  if (selected) {
    const running = analyzingId === selected.client.id;
    return (
      <Form method="post">
        <input type="hidden" name="clientId" value={selected.client.id} />
        <button className="btn analyze-control" type="submit" disabled={busy}>
          <Icon name="refresh" size={15} className={running ? "spin" : undefined} />
          <span className="analyze-label">
            {running ? "Reading the site…" : selected.run ? "Re-analyze" : "Analyze site"}
          </span>
        </button>
      </Form>
    );
  }
  return (
    <Menu
      align="end"
      triggerClassName="btn analyze-control"
      triggerLabel="Choose a client to analyze"
      trigger={
        <>
          <Icon name="refresh" size={15} className={busy ? "spin" : undefined} />
          <span className="analyze-label">{busy ? "Reading the site…" : "Analyze"}</span>
          <Icon name="chevron-down" size={13} />
        </>
      }
    >
      <div className="menu-label">Analyze a client site</div>
      {groups.map((group) => (
        <Form method="post" className="menu-form" key={group.client.id}>
          <input type="hidden" name="clientId" value={group.client.id} />
          <button className="menu-item" type="submit" role="menuitem" disabled={busy}>
            <StateDot state={group.state} />
            <span>{group.client.name}</span>
            <span className="menu-item-note">
              {group.run ? formatRelative(group.run.finishedAt) : "never"}
            </span>
          </button>
        </Form>
      ))}
    </Menu>
  );
}

function FeedEmpty({
  selected,
  groups,
  analyzingId,
  filter,
  openCount,
  closedCount,
  onFilter,
}: {
  selected: Group | null;
  groups: Group[];
  analyzingId: string | null;
  filter: FeedFilter;
  openCount: number;
  closedCount: number;
  onFilter: (value: FeedFilter) => void;
}) {
  const analyzeButton = (clientId: string, label: string) => (
    <Form method="post">
      <input type="hidden" name="clientId" value={clientId} />
      <button className="btn btn-primary" type="submit" disabled={analyzingId !== null}>
        <Icon name="refresh" size={15} className={analyzingId === clientId ? "spin" : undefined} />
        {analyzingId === clientId ? "Reading the site…" : label}
      </button>
    </Form>
  );

  if (filter === "strongest" && openCount > 0) {
    return (
      <EmptyState
        icon="target"
        title="Nothing above 75% confidence"
        inset
        actions={
          <button className="btn" type="button" onClick={() => onFilter("open")}>
            Show all {openCount} open {pluralize(openCount, "finding", "findings")}
          </button>
        }
      >
        The open findings below that bar are still worth a look — they simply carry more judgement
        and less certainty.
      </EmptyState>
    );
  }

  if (selected) {
    if (selected.state === "never") {
      return (
        <EmptyState
          icon="target"
          title={"Nothing read from " + selected.client.domain + " yet"}
          actions={analyzeButton(selected.client.id, "Analyze this site")}
        >
          Axiom Orbit reads the live site, checks what this business sells against what the site
          actually shows, and only surfaces work it can evidence.
        </EmptyState>
      );
    }
    if (selected.state === "inconclusive") {
      return (
        <EmptyState
          icon="alert"
          title="This site could not be read"
          actions={
            <>
              {analyzeButton(selected.client.id, "Try again")}
              <Link className="btn" to={"/clients/" + selected.client.id}>
                Check the domain
              </Link>
            </>
          }
        >
          {selected.run?.limitation ??
            "The evidence was incomplete, so nothing is claimed about this site."}{" "}
          Reporting it as clean would be a guess, not a finding.
        </EmptyState>
      );
    }
    return (
      <EmptyState
        icon="check"
        title={"Nothing billable on " + selected.client.name}
        actions={
          <>
            {analyzeButton(selected.client.id, "Re-analyze")}
            {closedCount > 0 && filter !== "all" && (
              <button className="btn" type="button" onClick={() => onFilter("all")}>
                Show {closedCount} closed
              </button>
            )}
          </>
        }
      >
        {selected.run?.summary ?? "The last analysis found no unmet, billable work on this site."}{" "}
        That is a good result — the site already covers what this business sells.
      </EmptyState>
    );
  }

  const neverAnalyzed = groups.filter((group) => group.state === "never");
  if (neverAnalyzed.length === groups.length) {
    return (
      <EmptyState
        icon="target"
        title="Run the first analysis"
        actions={
          groups.length === 1 && groups[0]
            ? analyzeButton(groups[0].client.id, "Analyze " + groups[0].client.name)
            : undefined
        }
      >
        Pick a client from the list and analyze their site. Findings land here ranked by what the
        work is worth to you.
      </EmptyState>
    );
  }

  // "Everything is clean" is a claim about what was checked, so a site that
  // could not be read has to travel with it. Monitoring makes this matter: a
  // client whose crawl keeps failing would otherwise sit here indefinitely,
  // silently counted as clean by the one screen the agency works from.
  const unreadable = groups.filter((group) => group.state === "inconclusive");
  const readable = groups.length - unreadable.length - neverAnalyzed.length;

  return (
    <EmptyState
      icon={unreadable.length > 0 ? "alert" : "check"}
      title={unreadable.length > 0 ? "Nothing open to work on" : "No open opportunities"}
      actions={
        closedCount > 0 && filter !== "all" ? (
          <button className="btn" type="button" onClick={() => onFilter("all")}>
            Show {closedCount} closed {pluralize(closedCount, "finding", "findings")}
          </button>
        ) : undefined
      }
    >
      {readable > 0
        ? `${readable} ${pluralize(readable, "site", "sites")} read cleanly with nothing billable to raise. `
        : ""}
      {unreadable.length > 0
        ? `${unreadable.length} ${pluralize(unreadable.length, "site", "sites")} could not be read, so nothing is claimed about ${unreadable.length === 1 ? "it" : "them"} either way — pick ${unreadable.length === 1 ? "it" : "one"} from the list to see why.`
        : "Re-analyze a client after they ship changes to their website."}
    </EmptyState>
  );
}
