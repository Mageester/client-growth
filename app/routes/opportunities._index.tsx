import type { ReactNode } from "react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";

import type { Opportunity } from "@/core/schema";
import { changeHeadline, type MonitoringOutcome } from "@/core/monitoring";
import * as monitoringRepo from "@/db/monitoring";
import * as repo from "@/db/repositories";
import {
  CLIENT_STATE_LABEL,
  CLIENT_STATE_ORDER,
  byPotentialValue,
  clientState,
  isOpen,
  nextAction,
  statusBadge,
  sumTotals,
  totalsFor,
} from "../lib/portfolio";
import { buildEvidenceCase } from "../lib/evidence";
import {
  AnalysisBanner,
  AnalysisRunning,
  EmptyState,
  EvidenceStrip,
  Icon,
  Menu,
  Meter,
  StateDot,
  formatCompactRange,
  formatCurrencyRange,
  formatDue,
  formatRelative,
  pluralize,
} from "../components/ui";
import { runAnalysis } from "../lib/analysis.server";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/opportunities._index";

export function meta() {
  return [{ title: "Opportunities · Client Growth" }];
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
  return {
    groups,
    serviceName,
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
    const result = await runAnalysis(t.scope, context.cloudflare.env as never, clientId);
    return {
      ok: true as const,
      clientId,
      outcome: result.verdict.outcome,
      summary: result.verdict.summary,
      limitation: result.verdict.limitation,
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

/** "Recently" for the portfolio summary. Long enough that a weekly client counts. */
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type Group = Awaited<ReturnType<typeof loader>>["groups"][number];
type Entry = { opp: Opportunity; group: Group };
type FeedFilter = "open" | "strongest" | "all";

const STRONG_CONFIDENCE = 0.75;

export default function OpportunitiesIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { groups, serviceName, monitoring } = loaderData;
  const navigation = useNavigation();
  const [params, setParams] = useSearchParams();

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
    .sort((a, b) => byPotentialValue(a.opp, b.opp));
  const closed: Entry[] = scoped
    .flatMap((group) =>
      group.opportunities.filter((opp) => !isOpen(opp)).map((opp) => ({ opp, group })),
    )
    .sort((a, b) => byPotentialValue(a.opp, b.opp));

  const shown =
    filter === "all"
      ? [...open, ...closed]
      : filter === "strongest"
        ? open.filter((entry) => entry.opp.confidence >= STRONG_CONFIDENCE)
        : open;

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
    const query = next.toString();
    return query ? "?" + query : "?";
  }

  function setFilter(value: FeedFilter) {
    const next = new URLSearchParams(params);
    if (value === "open") next.delete("show");
    else next.set("show", value);
    setParams(next, { preventScrollReset: true });
  }

  if (groups.length === 0) {
    return (
      <div>
        <PageHead>
          <p className="lede">
            Client Growth reads the sites you already look after and tells you where there is
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
    <div>
      <PageHead>
        <p className="summary-line">
          <b className="num">{totals.open}</b>
          <span>
            open {pluralize(totals.open, "opportunity", "opportunities")}
            {totals.open > 0 ? " worth" : ""}
          </span>
          {totals.open > 0 && (
            <b className="num">{formatCompactRange(totals.priceMin, totals.priceMax)}</b>
          )}
          <span className="dot-sep">·</span>
          <span>
            {selected
              ? selected.client.domain
              : `${groups.length} ${pluralize(groups.length, "client", "clients")} watched`}
          </span>
          <span className="dot-sep">·</span>
          <span>{lastRun ? "last analyzed " + formatRelative(lastRun) : "never analyzed"}</span>
        </p>
        <MonitoringSummary monitoring={monitoring} />
      </PageHead>

      {analyzingClient && (
        <AnalysisRunning
          clientName={analyzingClient.client.name}
          domain={analyzingClient.client.domain}
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
        <div className="notice err" role="alert">
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}

      <div className="portfolio">
        <aside className="rail" aria-label="Portfolio">
          <div className="rail-head">
            <span className="eyebrow">Clients</span>
            <span className="rail-head-note">
              {needsAttention > 0
                ? `${needsAttention} need${needsAttention === 1 ? "s" : ""} attention`
                : "all clear"}
            </span>
          </div>
          <nav aria-label="Filter by client">
            <ul className="rail-list">
              <li>
                <Link
                  className={"rail-item" + (selected ? "" : " active")}
                  to={withParam("client", null)}
                  preventScrollReset
                  aria-current={selected ? undefined : "page"}
                >
                  <span className="rail-item-name">All clients</span>
                  <span className={"rail-count" + (portfolioTotals.open > 0 ? " has" : "")}>
                    {portfolioTotals.open}
                  </span>
                </Link>
              </li>
              {[...groups]
                .sort(
                  (a, b) =>
                    CLIENT_STATE_ORDER[a.state] - CLIENT_STATE_ORDER[b.state] ||
                    b.totals.open - a.totals.open ||
                    a.client.name.localeCompare(b.client.name),
                )
                .map((group) => {
                  const active = group.client.id === selected?.client.id;
                  return (
                    <li key={group.client.id}>
                      <Link
                        className={"rail-item" + (active ? " active" : "")}
                        to={withParam("client", group.client.id)}
                        preventScrollReset
                        aria-current={active ? "page" : undefined}
                        title={group.client.name + " — " + CLIENT_STATE_LABEL[group.state]}
                      >
                        <StateDot state={group.state} />
                        <span className="rail-item-name">{group.client.name}</span>
                        <span className={"rail-count" + (group.totals.open > 0 ? " has" : "")}>
                          {group.totals.open > 0 ? group.totals.open : "—"}
                        </span>
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </nav>
          <div className="rail-foot">
            <Link className="btn btn-ghost btn-sm" to="/clients">
              <Icon name="plus" size={14} />
              Add client
            </Link>
          </div>
        </aside>

        <section aria-label="Opportunities" className="feed">
          <div className="feed-head">
            <div className="feed-head-copy">
              <h2>{selected ? selected.client.name : "Everything worth a conversation"}</h2>
              <div className="feed-head-meta">
                {selected ? (
                  <>
                    <a
                      href={"https://" + selected.client.domain}
                      target="_blank"
                      rel="noreferrer"
                      className="row-tight"
                    >
                      {selected.client.domain}
                      <Icon name="external" size={12} />
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
                    {unreadable > 0 ? ` · ${unreadable} could not be read` : ""} · ranked by
                    potential value
                  </span>
                )}
              </div>
            </div>
            <div className="feed-head-actions">
              {open.length > 0 && (
                <div className="segmented" role="group" aria-label="Filter findings">
                  <button
                    type="button"
                    className={filter === "open" ? "on" : undefined}
                    aria-pressed={filter === "open"}
                    onClick={() => setFilter("open")}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className={filter === "strongest" ? "on" : undefined}
                    aria-pressed={filter === "strongest"}
                    onClick={() => setFilter("strongest")}
                  >
                    Strongest
                  </button>
                  <button
                    type="button"
                    className={filter === "all" ? "on" : undefined}
                    aria-pressed={filter === "all"}
                    onClick={() => setFilter("all")}
                  >
                    All
                  </button>
                </div>
              )}
              <AnalyzeControl groups={groups} selected={selected} analyzingId={analyzingId} />
            </div>
          </div>

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
            <ul className="findings">
              {shown.map((entry) => (
                <Finding
                  key={entry.opp.id}
                  entry={entry}
                  showClient={!selected}
                  serviceName={
                    serviceName[entry.opp.suggestedServiceId] ?? entry.opp.suggestedServiceId
                  }
                />
              ))}
            </ul>
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

function PageHead({ children }: { children: ReactNode }) {
  return (
    <div className="pagehead">
      <div className="pagehead-copy">
        <span className="eyebrow">Portfolio</span>
        <h1 className="title-page">Opportunities</h1>
        {children}
      </div>
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
        <button className="btn btn-primary" type="submit" disabled={busy}>
          <Icon name="refresh" size={15} className={running ? "spin" : undefined} />
          {running ? "Reading the site…" : selected.run ? "Re-analyze" : "Analyze site"}
        </button>
      </Form>
    );
  }
  return (
    <Menu
      align="end"
      triggerClassName="btn btn-primary"
      triggerLabel="Choose a client to analyze"
      trigger={
        <>
          <Icon name="refresh" size={15} className={busy ? "spin" : undefined} />
          {busy ? "Reading the site…" : "Analyze"}
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
          Client Growth reads the live site, checks what this business sells against what the site
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

function Finding({
  entry,
  showClient,
  serviceName,
}: {
  entry: Entry;
  showClient: boolean;
  serviceName: string;
}) {
  const { opp } = entry;
  const client = entry.group.client;
  const live = isOpen(opp);
  const badge = statusBadge(opp);
  const evidence = buildEvidenceCase(opp);
  const href = "/opportunities/" + opp.id;

  return (
    <li className={"finding" + (live ? "" : " is-quiet")}>
      <div className="finding-body">
        <div className="finding-top">
          {showClient && (
            <>
              <Link className="finding-client" to={"/clients/" + client.id}>
                {client.name}
              </Link>
              <span className="dot-sep">·</span>
            </>
          )}
          <span className="finding-service">{serviceName}</span>
          {(!live || opp.status === "proposal_prepared") && (
            <span className={"pill " + badge.tone}>{badge.label}</span>
          )}
        </div>

        <h3 className="finding-title-row">
          <Link className="finding-title" to={href}>
            {opp.title}
          </Link>
        </h3>
        <p className="finding-detected">{opp.detected}</p>
        <p className="finding-why">
          <b>Why it matters.</b> {opp.rationale}
        </p>

        <EvidenceStrip evidence={evidence} href={href} />
      </div>

      <div className="finding-side">
        <div className="finding-value-block">
          <div className="finding-value num">{formatCurrencyRange(opp.priceMin, opp.priceMax)}</div>
          <div className="finding-value-note">potential value</div>
        </div>
        <div className="finding-confidence">
          <Meter value={opp.confidence} />
          <span>{Math.round(opp.confidence * 100)}% confident</span>
        </div>
        <Link className={"btn btn-block" + (live ? " btn-primary" : "")} to={href}>
          {live ? (opp.proposalMd ? "Open draft" : "Review & propose") : "Review"}
        </Link>
        <p className="finding-next">{nextAction(opp)}</p>
      </div>
    </li>
  );
}
