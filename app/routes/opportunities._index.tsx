import { Form, Link, useNavigation, useSearchParams } from "react-router";

import type { Opportunity } from "@/core/schema";
import * as repo from "@/db/repositories";
import {
  EmptyState,
  Icon,
  Menu,
  Meter,
  formatCompactRange,
  formatCurrencyRange,
  formatDate,
  pluralize,
  shortUrl,
} from "../components/ui";
import { runAnalysis } from "../lib/analysis.server";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/opportunities._index";

export function meta() {
  return [{ title: "Opportunities · Client Growth" }];
}

function isOpen(o: Opportunity): boolean {
  return (
    o.billableStatus === "billable" &&
    (o.status === "new" || o.status === "proposal_prepared")
  );
}

function latestDate(values: Array<string | null | undefined>): string | null {
  return (
    values
      .filter((value): value is string => Boolean(value))
      .map((value) => ({ value, time: new Date(value).getTime() }))
      .filter((entry) => !Number.isNaN(entry.time))
      .sort((a, b) => b.time - a.time)[0]?.value ?? null
  );
}

function statusLabel(opp: Opportunity): { label: string; tone: string } {
  if (opp.status === "proposal_prepared") return { label: "Proposal ready", tone: "pos" };
  if (opp.status === "dismissed") return { label: "Dismissed", tone: "quiet" };
  if (opp.status === "snoozed") return { label: "Snoozed", tone: "quiet" };
  if (opp.billableStatus === "already_covered" || opp.status === "already_covered") {
    return { label: "Already covered", tone: "warn" };
  }
  return { label: "Open", tone: "" };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  const [clients, services] = await Promise.all([
    repo.listClients(t.scope),
    repo.listServices(t.scope),
  ]);
  const serviceName = Object.fromEntries(services.map((s) => [s.id, s.name]));
  const groups = await Promise.all(
    clients.map(async (client) => {
      const [opportunities, evidence] = await Promise.all([
        repo.listOpportunities(t.scope, client.id),
        repo.getLatestEvidence(t.scope, client.id),
      ]);
      return {
        client,
        opportunities,
        lastCapturedAt: evidence?.capturedAt ?? null,
      };
    }),
  );
  return { groups, serviceName };
}

export async function action({ request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const form = await request.formData();
  const clientId = String(form.get("clientId") ?? "");
  if (!clientId) return { ok: false as const, error: "Missing client" };
  try {
    const result = await runAnalysis(t.scope, context.cloudflare.env as never, clientId);
    return {
      ok: true as const,
      clientId,
      stats: result.stats,
      surfaced: result.opportunities.length,
    };
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

type Group = Awaited<ReturnType<typeof loader>>["groups"][number];
type Entry = { opp: Opportunity; client: Group["client"] };

export default function OpportunitiesIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { groups, serviceName } = loaderData;
  const navigation = useNavigation();
  const [params, setParams] = useSearchParams();
  const busy = navigation.state !== "idle";

  const showAll = params.get("show") === "all";
  const selectedId = params.get("client");
  const selected = groups.find((group) => group.client.id === selectedId) ?? null;
  const scoped = selected ? [selected] : groups;

  const open: Entry[] = scoped
    .flatMap((group) =>
      group.opportunities.filter(isOpen).map((opp) => ({ opp, client: group.client })),
    )
    .sort((a, b) => b.opp.priceMax - a.opp.priceMax || b.opp.confidence - a.opp.confidence);
  const closed: Entry[] = scoped
    .flatMap((group) =>
      group.opportunities.filter((opp) => !isOpen(opp)).map((opp) => ({ opp, client: group.client })),
    )
    .sort((a, b) => b.opp.priceMax - a.opp.priceMax);
  const shown = showAll ? [...open, ...closed] : open;

  const totalMin = open.reduce((sum, entry) => sum + entry.opp.priceMin, 0);
  const totalMax = open.reduce((sum, entry) => sum + entry.opp.priceMax, 0);
  const lastActivity = latestDate(
    scoped.flatMap((group) => [
      group.lastCapturedAt,
      ...group.opportunities.map((opp) => opp.updatedAt),
    ]),
  );
  const analyzedCount = groups.filter((group) => group.lastCapturedAt).length;
  // When the feed is empty its own empty state owns the analyze action, so the
  // page header never repeats it.
  const emptyOwnsAnalyze =
    shown.length === 0 &&
    (Boolean(selected) ||
      (groups.length === 1 && groups.every((group) => !group.lastCapturedAt)));

  function setShowAll(value: boolean) {
    const next = new URLSearchParams(params);
    if (value) next.set("show", "all");
    else next.delete("show");
    setParams(next, { preventScrollReset: true });
  }

  function clientHref(id: string | null): string {
    const next = new URLSearchParams(params);
    if (id) next.set("client", id);
    else next.delete("client");
    const query = next.toString();
    return query ? "?" + query : "?";
  }

  return (
    <div>
      <div className="pagehead">
        <div className="pagehead-copy">
          <span className="eyebrow">Portfolio</span>
          <h1 className="title-page">Opportunities</h1>
          {groups.length === 0 ? (
            <p className="lede">
              Evidence-backed revenue hiding in the client sites you already look after.
            </p>
          ) : (
            <p className="summary-line">
              <b>{open.length}</b>
              <span>
                open {pluralize(open.length, "opportunity", "opportunities")}
                {open.length > 0 ? " worth" : ""}
              </span>
              {open.length > 0 && <b>{formatCompactRange(totalMin, totalMax)}</b>}
              <span className="dot-sep">·</span>
              <span>
                {selected
                  ? selected.client.domain
                  : `${groups.length} ${pluralize(groups.length, "client", "clients")} monitored`}
              </span>
              <span className="dot-sep">·</span>
              <span>
                {lastActivity ? "last analyzed " + formatDate(lastActivity) : "not analyzed yet"}
              </span>
            </p>
          )}
        </div>
        {groups.length > 0 && !emptyOwnsAnalyze && (
          <div className="pagehead-actions">
            <AnalyzeControl groups={groups} selected={selected} busy={busy} />
          </div>
        )}
      </div>

      {actionData?.ok && (
        <div className="notice ok" role="status">
          <Icon name="check" size={15} />
          <span>
            Analysis complete — {actionData.surfaced} surfaced from {actionData.stats.candidates}{" "}
            {pluralize(actionData.stats.candidates, "candidate", "candidates")}.{" "}
            {actionData.stats.aiCalls} evaluator{" "}
            {pluralize(actionData.stats.aiCalls, "call", "calls")} made.
          </span>
        </div>
      )}
      {actionData && !actionData.ok && (
        <div className="notice err" role="alert">
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon="users"
          title="Your portfolio is empty"
          actions={
            <Link className="btn btn-primary" to="/clients">
              <Icon name="plus" size={15} />
              Add your first client
            </Link>
          }
        >
          Add the client sites you already look after. Client Growth analyzes each one and surfaces
          only work that is evidenced and genuinely billable.
        </EmptyState>
      ) : (
        <div className="portfolio">
          <aside className="rail">
            <div className="rail-head">
              <span className="eyebrow">Clients</span>
              <span className="faint num" style={{ fontSize: "0.75rem" }}>
                {groups.length}
              </span>
            </div>
            <nav aria-label="Filter by client">
              <ul className="rail-list">
                <li>
                  <Link
                    className={"rail-item" + (selected ? "" : " active")}
                    to={clientHref(null)}
                    preventScrollReset
                    aria-current={selected ? undefined : "page"}
                  >
                    <span className="rail-item-name">All clients</span>
                    <span className={"rail-count" + (open.length && !selected ? " has" : "")}>
                      {groups.reduce(
                        (count, group) => count + group.opportunities.filter(isOpen).length,
                        0,
                      )}
                    </span>
                  </Link>
                </li>
                {groups.map((group) => {
                  const count = group.opportunities.filter(isOpen).length;
                  const active = group.client.id === selected?.client.id;
                  return (
                    <li key={group.client.id}>
                      <Link
                        className={"rail-item" + (active ? " active" : "")}
                        to={clientHref(group.client.id)}
                        preventScrollReset
                        aria-current={active ? "page" : undefined}
                      >
                        <span className="rail-item-name">{group.client.name}</span>
                        <span className={"rail-count" + (count > 0 ? " has" : "")}>{count}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <div className="rail-foot">
              <label className="toggle-inline">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(event) => setShowAll(event.currentTarget.checked)}
                />
                <span>Show covered &amp; closed</span>
              </label>
              <Link className="btn btn-ghost btn-sm" to="/clients">
                <Icon name="plus" size={14} />
                Add client
              </Link>
            </div>
          </aside>

          <section aria-label="Opportunities">
            <div className="feed-head">
              <div>
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
                      <span>
                        {selected.lastCapturedAt
                          ? "Analyzed " + formatDate(selected.lastCapturedAt, true)
                          : "Never analyzed"}
                      </span>
                    </>
                  ) : (
                    <span>
                      {analyzedCount} of {groups.length}{" "}
                      {pluralize(groups.length, "client", "clients")} analyzed · ranked by potential
                      value
                    </span>
                  )}
                </div>
              </div>
              {selected && (
                <div className="feed-head-actions">
                  <Link className="btn btn-sm" to={"/clients/" + selected.client.id}>
                    Open client
                    <Icon name="arrow-up-right" size={13} />
                  </Link>
                </div>
              )}
            </div>

            {shown.length === 0 ? (
              <FeedEmpty
                selected={selected}
                groups={groups}
                busy={busy}
                hasClosed={closed.length > 0}
                showAll={showAll}
                onShowAll={() => setShowAll(true)}
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
                    busy={busy}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function AnalyzeControl({
  groups,
  selected,
  busy,
}: {
  groups: Group[];
  selected: Group | null;
  busy: boolean;
}) {
  if (selected) {
    return (
      <Form method="post">
        <input type="hidden" name="clientId" value={selected.client.id} />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          <Icon name="refresh" size={15} className={busy ? "spin" : undefined} />
          {busy ? "Analyzing…" : "Analyze site"}
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
          {busy ? "Analyzing…" : "Analyze a client"}
          <Icon name="chevron-down" size={13} />
        </>
      }
    >
      <div className="menu-label">Analyze site</div>
      {groups.map((group) => (
        <Form method="post" className="menu-form" key={group.client.id}>
          <input type="hidden" name="clientId" value={group.client.id} />
          <button className="menu-item" type="submit" role="menuitem" disabled={busy}>
            <span>{group.client.name}</span>
            <span className="menu-item-note">
              {group.lastCapturedAt ? formatDate(group.lastCapturedAt) : "never"}
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
  busy,
  hasClosed,
  showAll,
  onShowAll,
}: {
  selected: Group | null;
  groups: Group[];
  busy: boolean;
  hasClosed: boolean;
  showAll: boolean;
  onShowAll: () => void;
}) {
  const analyzeButton = (clientId: string, label: string) => (
    <Form method="post">
      <input type="hidden" name="clientId" value={clientId} />
      <button className="btn btn-primary" type="submit" disabled={busy}>
        <Icon name="refresh" size={15} className={busy ? "spin" : undefined} />
        {busy ? "Analyzing…" : label}
      </button>
    </Form>
  );

  if (selected && !selected.lastCapturedAt) {
    return (
      <EmptyState
        icon="target"
        title={selected.client.name + " has not been analyzed yet"}
        actions={analyzeButton(selected.client.id, "Analyze " + selected.client.domain)}
      >
        Client Growth reads the live site, checks the offerings this client sells against what the
        site actually shows, and only surfaces work backed by evidence.
      </EmptyState>
    );
  }

  if (selected) {
    return (
      <EmptyState
        icon="check"
        title={"Nothing billable on " + selected.client.name}
        actions={
          <>
            {analyzeButton(selected.client.id, "Re-analyze site")}
            {hasClosed && !showAll && (
              <button className="btn" type="button" onClick={onShowAll}>
                Show covered &amp; closed
              </button>
            )}
          </>
        }
      >
        The last analysis found no unmet, billable work on this site. That is a good result — it
        means the client's site already covers what they sell.
      </EmptyState>
    );
  }

  const neverAnalyzed = groups.every((group) => !group.lastCapturedAt);
  if (neverAnalyzed) {
    return (
      <EmptyState
        icon="target"
        title="Nothing analyzed yet"
        actions={
          groups.length === 1 && groups[0]
            ? analyzeButton(groups[0].client.id, "Analyze " + groups[0].client.name)
            : undefined
        }
      >
        Pick a client and run the first analysis. Findings land here ranked by how much the work is
        worth to you.
      </EmptyState>
    );
  }

  return (
    <EmptyState
      icon="check"
      title="No open opportunities"
      actions={
        hasClosed && !showAll ? (
          <button className="btn" type="button" onClick={onShowAll}>
            Show covered &amp; closed
          </button>
        ) : undefined
      }
    >
      Every analyzed site in your portfolio is clean right now. Re-analyze a client after they ship
      changes to their site.
    </EmptyState>
  );
}

function Finding({
  entry,
  showClient,
  serviceName,
  busy,
}: {
  entry: Entry;
  showClient: boolean;
  serviceName: string;
  busy: boolean;
}) {
  const { opp, client } = entry;
  const live = isOpen(opp);
  const status = statusLabel(opp);
  const pages = opp.evidenceRefs.filter((ref) => !ref.startsWith("nav:"));
  const visible = pages.slice(0, 2);
  const hidden = pages.length - visible.length;

  return (
    <li className={"finding" + (live ? "" : " is-quiet")}>
      <div>
        <div className="finding-top">
          {showClient && (
            <>
              <Link className="finding-client" to={"/clients/" + client.id}>
                {client.name}
              </Link>
              <span className="dot-sep">·</span>
            </>
          )}
          <span>{serviceName}</span>
          {!live && <span className={"pill " + status.tone}>{status.label}</span>}
          {live && opp.status === "proposal_prepared" && (
            <span className="pill pos">Proposal ready</span>
          )}
        </div>

        <Link className="finding-title" to={"/opportunities/" + opp.id}>
          {opp.title}
        </Link>
        <p className="finding-detected">{opp.detected}</p>
        <p className="finding-why">
          <b>Why it matters.</b> {opp.rationale}
        </p>

        {visible.length > 0 && (
          <div className="evidence-chips">
            {visible.map((ref) => (
              <a className="chip" key={ref} href={ref} target="_blank" rel="noreferrer" title={ref}>
                <Icon name="link" size={11} />
                <span>{shortUrl(ref)}</span>
              </a>
            ))}
            {hidden > 0 && (
              <Link className="chip" to={"/opportunities/" + opp.id}>
                <span>+{hidden} more</span>
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="finding-side">
        <div>
          <div className="finding-value">{formatCurrencyRange(opp.priceMin, opp.priceMax)}</div>
          <div className="finding-value-note">potential value</div>
        </div>
        <div className="finding-confidence">
          <Meter value={opp.confidence} />
          <span>{Math.round(opp.confidence * 100)}% confident</span>
        </div>
        {live ? (
          <Form method="post" action={"/opportunities/" + opp.id} style={{ width: "100%" }}>
            <input type="hidden" name="intent" value="prepare-proposal" />
            <button className="btn btn-block" type="submit" disabled={busy}>
              <Icon name="document" size={14} />
              {opp.proposalMd ? "Regenerate draft" : "Prepare proposal"}
            </button>
          </Form>
        ) : (
          <Link className="btn" to={"/opportunities/" + opp.id}>
            Review
          </Link>
        )}
      </div>
    </li>
  );
}
