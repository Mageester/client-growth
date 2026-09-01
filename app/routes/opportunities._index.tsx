import { Form, Link, useNavigation, useSearchParams } from "react-router";

import type { Opportunity } from "@/core/schema";
import * as repo from "@/db/repositories";
import { formatCurrencyRange, formatDate, getInitials, Icon } from "../components/ui";
import { runAnalysis } from "../lib/analysis.server";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/opportunities._index";

export function meta() {
  return [{ title: "Opportunities · Client Growth" }];
}

function isActive(o: Opportunity): boolean {
  return (
    o.billableStatus === "billable" &&
    (o.status === "new" || o.status === "proposal_prepared")
  );
}

function latestDate(values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, time: new Date(value).getTime() }))
    .filter((entry) => !Number.isNaN(entry.time))
    .sort((a, b) => b.time - a.time)[0]?.value ?? null;
}

function confidenceTone(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

function statusLabel(opp: Opportunity): { label: string; tone: string } {
  if (opp.status === "proposal_prepared") return { label: "Proposal ready", tone: "proposal" };
  if (opp.status === "dismissed") return { label: "Dismissed", tone: "dismissed" };
  if (opp.status === "snoozed") return { label: "Snoozed", tone: "snoozed" };
  if (opp.billableStatus === "already_covered" || opp.status === "already_covered") {
    return { label: "Already covered", tone: "covered" };
  }
  return { label: "New", tone: "billable" };
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

export default function OpportunitiesIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { groups, serviceName } = loaderData;
  const navigation = useNavigation();
  const [params, setParams] = useSearchParams();
  const showAll = params.get("show") === "all";
  const totalActive = groups.reduce(
    (count, group) => count + group.opportunities.filter(isActive).length,
    0,
  );
  const totalMin = groups.reduce(
    (total, group) =>
      total + group.opportunities.filter(isActive).reduce((sum, opp) => sum + opp.priceMin, 0),
    0,
  );
  const totalMax = groups.reduce(
    (total, group) =>
      total + group.opportunities.filter(isActive).reduce((sum, opp) => sum + opp.priceMax, 0),
    0,
  );
  const lastActivity = latestDate(
    groups.flatMap((group) => [
      group.lastCapturedAt,
      ...group.opportunities.map((opp) => opp.updatedAt),
    ]),
  );
  const selectedId = params.get("client");
  const selectedGroup =
    groups.find((group) => group.client.id === selectedId) ??
    groups.find((group) => group.opportunities.some(isActive)) ??
    groups[0];
  const isSubmitting = navigation.state !== "idle";

  function setShowAll(value: boolean) {
    const next = new URLSearchParams(params);
    if (value) next.set("show", "all");
    else next.delete("show");
    setParams(next);
  }

  return (
    <div className="opportunities-page">
      <div className="page-head">
        <div className="page-head-copy">
          <h1>Opportunities</h1>
          <div className="sub">
            Evidence-backed revenue opportunities across your existing client portfolio.
          </div>
        </div>
        {selectedGroup && (
          <Form method="post" className="inline">
            <input type="hidden" name="clientId" value={selectedGroup.client.id} />
            <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
              <Icon name="refresh" size={16} />
              {isSubmitting ? "Analyzing…" : "Analyze"}
            </button>
          </Form>
        )}
      </div>

      {actionData?.ok && (
        <div className="notice ok" role="status">
          <Icon name="check" size={17} />
          <span>
            Analysis complete — {actionData.surfaced} surfaced from {actionData.stats.candidates}{" "}
            candidates. {actionData.stats.aiCalls} evaluator call
            {actionData.stats.aiCalls === 1 ? "" : "s"} made.
          </span>
        </div>
      )}
      {actionData && !actionData.ok && (
        <div className="notice err" role="alert">
          <Icon name="x" size={17} />
          <span>{actionData.error}</span>
        </div>
      )}

      {groups.length === 0 ? (
        <section className="empty-state compact">
          <span className="empty-icon"><Icon name="search" size={20} /></span>
          <h2>No opportunities yet</h2>
          <p>Add a client and analyze their site to find legitimate revenue opportunities.</p>
          <Link className="btn btn-primary" to="/clients">
            <Icon name="plus" size={16} />
            Add a client
          </Link>
        </section>
      ) : (
        <>
          <section className="metric-strip" aria-label="Opportunity summary">
            <div className="metric">
              <div className="metric-label">Active opportunities</div>
              <div className="metric-value">{totalActive}</div>
              <div className="metric-note">Requiring review</div>
            </div>
            <div className="metric">
              <div className="metric-label">Estimated potential value</div>
              <div className="metric-value">
                {totalActive > 0 ? formatCurrencyRange(totalMin, totalMax) : "—"}
              </div>
              <div className="metric-note">From billable opportunity ranges</div>
            </div>
            <div className="metric">
              <div className="metric-label">Clients monitored</div>
              <div className="metric-value">{groups.length}</div>
              <div className="metric-note">In your portfolio</div>
            </div>
            <div className="metric">
              <div className="metric-label">Last analysis</div>
              <div className="metric-value metric-value-date">{formatDate(lastActivity, true)}</div>
              <div className="metric-note">Across all clients</div>
            </div>
          </section>

          <section className="opportunity-layout" aria-label="Client opportunities">
            <aside className="client-rail">
              <div className="client-rail-header">
                <span className="client-rail-label">Client portfolio</span>
                <span className="cell-muted">{groups.length}</span>
              </div>
              <nav className="client-list" aria-label="Clients with opportunities">
                {groups.map(({ client, opportunities }) => {
                  const count = opportunities.filter(isActive).length;
                  const active = client.id === selectedGroup?.client.id;
                  const next = new URLSearchParams(params);
                  next.set("client", client.id);
                  return (
                    <Link
                      className={"client-item" + (active ? " active" : "")}
                      key={client.id}
                      to={"?" + next.toString()}
                      aria-current={active ? "page" : undefined}
                    >
                      <span className="avatar">{getInitials(client.name)}</span>
                      <span className="client-item-copy">
                        <span className="client-item-name">{client.name}</span>
                        <span className="client-item-domain">{client.domain}</span>
                      </span>
                      <span className="client-count">{count}</span>
                    </Link>
                  );
                })}
              </nav>
              <div className="client-rail-footer">
                <label className="show-all-control">
                  <input
                    type="checkbox"
                    checked={showAll}
                    onChange={(event) => setShowAll(event.currentTarget.checked)}
                  />
                  Show covered and closed
                </label>
              </div>
            </aside>

            <section className="opportunity-main">
              {selectedGroup ? (
                <SelectedClient
                  group={selectedGroup}
                  serviceName={serviceName}
                  showAll={showAll}
                  isSubmitting={isSubmitting}
                  onShowAllChange={setShowAll}
                />
              ) : (
                <div className="empty-state">
                  <span className="empty-icon"><Icon name="search" size={20} /></span>
                  <h2>No opportunities yet</h2>
                  <p>Add a client and analyze their site to get started.</p>
                </div>
              )}
            </section>
          </section>
        </>
      )}
    </div>
  );
}

function SelectedClient({
  group,
  serviceName,
  showAll,
  isSubmitting,
  onShowAllChange,
}: {
  group: Awaited<ReturnType<typeof loader>>["groups"][number];
  serviceName: Record<string, string>;
  showAll: boolean;
  isSubmitting: boolean;
  onShowAllChange: (value: boolean) => void;
}) {
  const active = group.opportunities.filter(isActive);
  const other = group.opportunities.filter((opp) => !isActive(opp));
  const shown = showAll ? [...active, ...other] : active;
  const activity = latestDate([
    group.lastCapturedAt,
    ...group.opportunities.map((opp) => opp.updatedAt),
  ]);

  return (
    <>
      <div className="opportunity-main-head">
        <div className="section-heading">
          <div>
            <h2>{group.client.name}</h2>
            <div className="opportunity-main-meta">
              <span>{active.length} active opportunit{active.length === 1 ? "y" : "ies"}</span>
              <span className="meta-dot">•</span>
              <span>{activity ? "Last analyzed " + formatDate(activity) : "Not analyzed yet"}</span>
            </div>
          </div>
          <Link className="btn btn-secondary btn-sm" to={"/clients/" + group.client.id}>
            Open client
            <Icon name="arrow-up-right" size={15} />
          </Link>
        </div>
        <div className="row-actions">
          <label className="show-all-control">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(event) => onShowAllChange(event.currentTarget.checked)}
            />
            <span>Show covered and closed</span>
          </label>
          <span className="cell-muted">{group.client.domain}</span>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon"><Icon name="search" size={20} /></span>
          <h2>{group.opportunities.length === 0 ? "No opportunities yet" : "No active opportunities"}</h2>
          <p>
            {group.opportunities.length === 0
              ? "Analyze this client's site to find evidence-backed revenue opportunities."
              : "Closed and covered decisions are hidden. Turn on the portfolio filter to review them."}
          </p>
          <Form method="post">
            <input type="hidden" name="clientId" value={group.client.id} />
            <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
              <Icon name="refresh" size={16} />
              {isSubmitting ? "Analyzing…" : "Analyze"}
            </button>
          </Form>
        </div>
      ) : (
        <div className="opportunity-table-wrap">
          <table className="opportunity-table">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Evidence / reason</th>
                <th>Confidence</th>
                <th>Est. billable range</th>
                <th>Status</th>
                <th>Next action</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((opp) => (
                <OpportunityRow
                  key={opp.id}
                  opp={opp}
                  serviceName={serviceName[opp.suggestedServiceId] ?? opp.suggestedServiceId}
                  isSubmitting={isSubmitting}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function OpportunityRow({
  opp,
  serviceName,
  isSubmitting,
}: {
  opp: Opportunity;
  serviceName: string;
  isSubmitting: boolean;
}) {
  const status = statusLabel(opp);
  const confidence = Math.round(opp.confidence * 100);
  return (
    <tr className={isActive(opp) ? undefined : "is-suppressed"}>
      <td>
        <Link className="opp-title" to={"/opportunities/" + opp.id}>
          {opp.title}
        </Link>
        <span className="opp-client">{serviceName}</span>
      </td>
      <td>
        <span className="evidence-copy">{opp.detected}</span>
        <span className="evidence-copy">{opp.rationale}</span>
      </td>
      <td>
        <span className={"confidence-value " + confidenceTone(opp.confidence)}>{confidence}%</span>
      </td>
      <td>
        <span className="range-value">{formatCurrencyRange(opp.priceMin, opp.priceMax)}</span>
        <span className="range-note">Configured range</span>
      </td>
      <td><span className={"status " + status.tone}>{status.label}</span></td>
      <td>
        <div className="table-actions">
          {isActive(opp) ? (
            <Form method="post" action={"/opportunities/" + opp.id} className="inline">
              <input type="hidden" name="intent" value="prepare-proposal" />
              <button className="btn btn-primary btn-sm" type="submit" disabled={isSubmitting}>
                <Icon name="document" size={15} />
                {opp.proposalMd ? "Regenerate draft" : "Prepare proposal"}
              </button>
            </Form>
          ) : (
            <Link className="btn btn-secondary btn-sm" to={"/opportunities/" + opp.id}>
              Review
            </Link>
          )}
          <Link
            className="btn btn-secondary btn-icon"
            to={"/opportunities/" + opp.id}
            aria-label={"Open " + opp.title}
          >
            <Icon name="arrow-up-right" size={15} />
          </Link>
        </div>
      </td>
    </tr>
  );
}
