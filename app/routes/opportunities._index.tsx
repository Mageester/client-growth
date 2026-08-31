import { Form, Link, useSearchParams } from "react-router";

import * as repo from "@/db/repositories";
import type { Opportunity } from "@/core/schema";
import { getDb, rawEnv } from "../lib/context";
import { runAnalysis } from "../lib/analysis.server";
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

export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(context);
  const [clients, services] = await Promise.all([
    repo.listClients(db),
    repo.listServices(db),
  ]);
  const serviceName = Object.fromEntries(services.map((s) => [s.id, s.name]));
  const groups = await Promise.all(
    clients.map(async (client) => ({
      client,
      opportunities: await repo.listOpportunities(db, client.id),
    })),
  );
  return { groups, serviceName };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const clientId = String(form.get("clientId") ?? "");
  if (!clientId) return { ok: false as const, error: "Missing client" };
  try {
    const result = await runAnalysis(getDb(context), rawEnv(context), clientId);
    return {
      ok: true as const,
      clientId,
      stats: result.stats,
      surfaced: result.opportunities.length,
    };
  } catch (err) {
    const error =
      err instanceof Response
        ? `${err.status} ${err.statusText}`
        : err instanceof Error
          ? err.message
          : "Analysis failed";
    return { ok: false as const, error };
  }
}

export default function OpportunitiesIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { groups, serviceName } = loaderData;
  const [params, setParams] = useSearchParams();
  const showAll = params.get("show") === "all";

  const totalActive = groups.reduce(
    (n, g) => n + g.opportunities.filter(isActive).length,
    0,
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Opportunities</h1>
          <div className="sub">
            {totalActive} billable {totalActive === 1 ? "opportunity" : "opportunities"} across{" "}
            {groups.length} {groups.length === 1 ? "client" : "clients"}
          </div>
        </div>
        <label className="row-actions" style={{ fontWeight: 400 }}>
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.currentTarget.checked) next.set("show", "all");
              else next.delete("show");
              setParams(next);
            }}
            style={{ width: "auto" }}
          />
          Show covered / dismissed / snoozed
        </label>
      </div>

      {actionData?.ok && (
        <div className="notice ok">
          Analysis complete — {actionData.surfaced} surfaced. Candidates:{" "}
          {actionData.stats.candidates}, passed threshold:{" "}
          {actionData.stats.passedEvidenceThreshold}, AI calls: {actionData.stats.aiCalls},
          suppressed by coverage: {actionData.stats.suppressedByCoverage}, by prior decision:{" "}
          {actionData.stats.suppressedByPriorDecision}.
        </div>
      )}
      {actionData && !actionData.ok && (
        <div className="notice err">{actionData.error}</div>
      )}

      {groups.length === 0 && (
        <div className="card">
          <div className="empty">
            No clients yet. <Link to="/clients">Add a client</Link> to get started.
          </div>
        </div>
      )}

      {groups.map(({ client, opportunities }) => {
        const active = opportunities.filter(isActive);
        const other = opportunities.filter((o) => !isActive(o));
        const shown = showAll ? [...active, ...other] : active;
        return (
          <section className="card" key={client.id}>
            <div className="card-head">
              <div>
                <h2>
                  <Link to={`/clients/${client.id}`}>{client.name}</Link>
                </h2>
                <small>{client.domain}</small>
              </div>
              <Form method="post">
                <input type="hidden" name="clientId" value={client.id} />
                <button className="primary" type="submit">
                  Analyze
                </button>
              </Form>
            </div>

            {shown.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                {opportunities.length === 0
                  ? "Not analyzed yet."
                  : "No billable opportunities right now."}
              </p>
            ) : (
              shown.map((o) => (
                <div
                  className={`opp-row${isActive(o) ? "" : " is-suppressed"}`}
                  key={o.id}
                >
                  <div>
                    <div className="title">
                      <Link to={`/opportunities/${o.id}`}>{o.title}</Link>
                    </div>
                    <div className="meta">
                      {serviceName[o.suggestedServiceId] ?? o.suggestedServiceId} ·{" "}
                      ${o.priceMin.toLocaleString()}–${o.priceMax.toLocaleString()}
                    </div>
                  </div>
                  <div className="row-actions">
                    <span className="confidence">{Math.round(o.confidence * 100)}%</span>
                    <StatusBadge opp={o} />
                  </div>
                </div>
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

function StatusBadge({ opp }: { opp: Opportunity }) {
  if (opp.status === "proposal_prepared")
    return <span className="badge proposal">Proposal drafted</span>;
  if (opp.status === "dismissed") return <span className="badge dismissed">Dismissed</span>;
  if (opp.status === "snoozed") return <span className="badge snoozed">Snoozed</span>;
  if (opp.billableStatus === "already_covered")
    return <span className="badge covered">Already covered</span>;
  return <span className="badge billable">Billable</span>;
}
