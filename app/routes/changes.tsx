import { Link } from "react-router";

import { portfolioChanges } from "@/db/portfolioChanges";
import * as repo from "@/db/repositories";
import { buildActionCenter, buildRecentActivity } from "../lib/actionCenter";
import { sumTotals, totalsFor } from "../lib/portfolio";
import {
  formatCompactRange,
  formatCurrencyRange,
  formatRelative,
  Icon,
  PageContextMeta,
  pluralize,
} from "../components/ui";
import { ClientMark } from "../components/entity-mark";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/changes";

export function meta() {
  return [{ title: "Home · Axiom Orbit" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const tenant = await requireTenant(request, context);
  const [changes, clients, runsByClient, opportunitiesByClient] = await Promise.all([
    portfolioChanges(tenant.scope),
    repo.listClients(tenant.scope),
    repo.latestAnalysisRunByClient(tenant.scope),
    repo.listOpportunitiesByClient(tenant.scope),
  ]);
  const actionCenter = buildActionCenter({ clients, opportunitiesByClient, latestRunsByClient: runsByClient });
  const totals = sumTotals(
    clients.map((client) => totalsFor(opportunitiesByClient.get(client.id) ?? [])),
  );

  return {
    ...changes,
    firstName: tenant.user.name.trim().split(/\s+/)[0] || "there",
    actionCenter,
    activity: buildRecentActivity({ ...changes, since: changes.since }),
    portfolio: {
      clients: clients.length,
      ...totals,
    },
  };
}

export function homeRenderClock(until: string): number {
  const parsed = Date.parse(until);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function Changes({ loaderData: data }: Route.ComponentProps) {
  const renderNow = homeRenderClock(data.until);
  const firstName = data.firstName ?? "there";
  const queue = data.actionCenter.queue;
  const pipeline = data.actionCenter.pipeline;
  const activity = data.activity;
  const portfolio = data.portfolio ?? {
    clients: 0,
    open: 0,
    closed: 0,
    priceMin: 0,
    priceMax: 0,
  };

  return (
    <main className="home-page">
      <header className="home-head">
        <div>
          <span className="eyebrow">Home</span>
          <h1 className="title-page">
            {greeting(new Date(renderNow))}, {firstName}.
          </h1>
          <p className="page-statement">
            {queue.length > 0
              ? `${queue.length} ${pluralize(queue.length, "next action", "next actions")} across your clients.`
              : portfolio.clients > 0
                ? "Your portfolio is quiet today."
                : "Start with a client and Orbit will find the next conversation."}
          </p>
        </div>
        <PageContextMeta dateTime={data.until} />
      </header>

      <section className="home-action-center" aria-labelledby="action-center-heading">
        <div className="section-head home-action-head">
          <div>
            <span className="eyebrow">Next up</span>
            <h2 id="action-center-heading" className="title-section">
              Clients worth contacting
            </h2>
          </div>
          <Link to="/opportunities">View all opportunities</Link>
        </div>
        {queue.length === 0 ? (
          portfolio.clients === 0 ? (
            <div className="home-clear home-clear-start">
              <Icon name="users" size={22} />
              <div>
                <b>Start with a client</b>
                <p>Add a name and website. Orbit will read the site and bring back the next conversation.</p>
                <Link className="btn btn-sm" to="/clients">
                  Add client
                </Link>
              </div>
            </div>
          ) : (
            <div className="home-clear">
              <Icon name="check" size={22} />
              <div>
                <b>No client work to review</b>
                <p>Recent analysis has not surfaced an open conversation.</p>
              </div>
            </div>
          )
        ) : (
          <ul className="home-action-list">
            {queue.slice(0, 6).map((item) => (
              <li key={item.id}>
                <Link className={`action-card action-card-${item.kind}`} to={item.href}>
                  <ClientMark name={item.client.name} seed={item.client.domain} size="lg" />
                  <span className="action-card-copy">
                    <b>{item.client.name}</b>
                    <span>{item.title}</span>
                    <small>{item.detail}</small>
                  </span>
                  <span className="action-card-value">
                    <b>
                      {item.kind === "analysis"
                        ? item.analysisState === "inconclusive"
                          ? "Attention"
                          : "Ready"
                        : formatCurrencyRange(item.priceMin, item.priceMax)}
                    </b>
                    <span>
                      {item.kind === "analysis"
                        ? item.analysisState === "inconclusive"
                          ? "Needs a retry"
                          : "Start here"
                        : "Potential value"}
                    </span>
                  </span>
                  <span className="action-card-meta">
                    {item.count > 0 && (
                      <span>
                        {item.count} related {pluralize(item.count, "finding", "findings")}
                      </span>
                    )}
                    <span>{item.action}</span>
                  </span>
                  <Icon name="chevron-right" size={18} className="attention-chevron" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="home-pipeline" aria-labelledby="pipeline-heading">
        <div className="section-head home-pipeline-head">
          <div>
            <span className="eyebrow">Pipeline</span>
            <h2 id="pipeline-heading" className="title-section">
              Work in motion
            </h2>
          </div>
          <p>Dismissed work is not counted as a client loss.</p>
        </div>
        <dl className="pipeline-grid">
          <div><dt>New</dt><dd>{pipeline.newCount}</dd></div>
          <div><dt>Accepted</dt><dd>{pipeline.acceptedCount}</dd></div>
          <div><dt>Pitched</dt><dd>{pipeline.pitchedCount}</dd></div>
          <div><dt>Sold</dt><dd>{pipeline.soldCount}</dd></div>
          <div><dt>Lost</dt><dd>{pipeline.lostCount}</dd></div>
          <div><dt>Close rate</dt><dd>{pipeline.closeRate === null ? "—" : `${Math.round(pipeline.closeRate * 100)}%`}</dd></div>
          <div>
            <dt>Sold revenue</dt>
            <dd>
              {pipeline.soldCount === 0 || pipeline.soldRevenue === null
                ? "—"
                : formatCurrencyRange(pipeline.soldRevenue, pipeline.soldRevenue)}
            </dd>
          </div>
          <div>
            <dt>Open potential</dt>
            <dd>{pipeline.openCount > 0 ? formatCompactRange(pipeline.openPriceMin, pipeline.openPriceMax) : "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="home-weekly" aria-labelledby="weekly-heading">
        <div className="section-head">
          <div>
            <span className="eyebrow">Recent activity</span>
            <h2 id="weekly-heading" className="title-section">
              What changed
            </h2>
          </div>
          <Link to="/operations">Review site health</Link>
        </div>
        {activity.length === 0 ? (
          <p className="prose faint">
            No recent analysis to show. This does not mean every site is clean.
          </p>
        ) : (
          <ul className="weekly-list">
            {activity.slice(0, 6).map((item) => (
              <li key={item.id}>
                <div className="weekly-row">
                  <Link to={item.href}>{item.clientName}</Link>
                  <time dateTime={item.at}>{formatRelative(item.at, renderNow)}</time>
                </div>
                <p>{item.label}</p>
                <p className="weekly-drift">{item.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
