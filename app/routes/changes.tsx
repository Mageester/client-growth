import { Link } from "react-router";

import { portfolioChanges } from "@/db/portfolioChanges";
import * as repo from "@/db/repositories";
import { byPotentialValue, isOpen, sumTotals, totalsFor } from "../lib/portfolio";
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
  const [changes, clients, services, opportunitiesByClient] = await Promise.all([
    portfolioChanges(tenant.scope),
    repo.listClients(tenant.scope),
    repo.listServices(tenant.scope),
    repo.listOpportunitiesByClient(tenant.scope),
  ]);
  const serviceNames = new Map(services.map((service) => [service.id, service.name]));
  const attention = clients
    .flatMap((client) =>
      (opportunitiesByClient.get(client.id) ?? [])
        .filter(isOpen)
        .map((opportunity) => ({
          client,
          opportunity,
          serviceName:
            serviceNames.get(opportunity.suggestedServiceId) ?? opportunity.suggestedServiceId,
        })),
    )
    .sort((a, b) => byPotentialValue(a.opportunity, b.opportunity))
    .slice(0, 3);
  const totals = sumTotals(
    clients.map((client) => totalsFor(opportunitiesByClient.get(client.id) ?? [])),
  );

  return {
    ...changes,
    firstName: tenant.user.name.trim().split(/\s+/)[0] || "there",
    attention,
    portfolio: { clients: clients.length, ...totals },
  };
}

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function Changes({ loaderData: data }: Route.ComponentProps) {
  const summary = data.summary;
  const firstName = data.firstName ?? "there";
  const attention = data.attention ?? [];
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
            {greeting()}, {firstName}.
          </h1>
          <p className="page-statement">
            {attention.length > 0
              ? `${attention.length} ${pluralize(attention.length, "thing deserves", "things deserve")} attention.`
              : "Your portfolio is quiet today."}
          </p>
        </div>
        <PageContextMeta dateTime={data.until} />
      </header>

      <section className="home-attention" aria-labelledby="attention-heading">
        <h2 id="attention-heading" className="sr-only">
          What deserves your attention
        </h2>
        {attention.length === 0 ? (
          <div className="home-clear">
            <Icon name="check" size={22} />
            <div>
              <b>Nothing urgent right now</b>
              <p>Recent checks have not surfaced open work that needs a conversation.</p>
            </div>
          </div>
        ) : (
          <ul>
            {attention.map(({ opportunity, client, serviceName }) => (
              <li key={opportunity.id}>
                <Link
                  className="attention-row"
                  to={`/opportunities/${encodeURIComponent(opportunity.id)}`}
                >
                  <ClientMark name={client.name} seed={client.domain} size="lg" />
                  <span className="attention-copy">
                    <b>{client.name}</b>
                    <span>{opportunity.title}</span>
                  </span>
                  <span className="attention-value">
                    <b>{formatCurrencyRange(opportunity.priceMin, opportunity.priceMax)}</b>
                    <span>Potential revenue</span>
                  </span>
                  <Icon name="chevron-right" size={18} className="attention-chevron" />
                  <small className="attention-tags">
                    <span>{serviceName}</span>
                    <span>{Math.round(opportunity.confidence * 100)}% confidence</span>
                  </small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="portfolio-summary" aria-label="Portfolio summary">
        <div>
          <Icon name="users" size={24} />
          <p>
            <b>{portfolio.clients}</b>
            <span>Clients</span>
            <small>{summary.clientsChecked} checked this week</small>
          </p>
        </div>
        <div>
          <Icon name="target" size={24} />
          <p>
            <b>{portfolio.open}</b>
            <span>Open opportunities</span>
            <small>{summary.newFindings} new this week</small>
          </p>
        </div>
        <div>
          <Icon name="signal" size={24} />
          <p>
            <b>
              {portfolio.open > 0
                ? formatCompactRange(portfolio.priceMin, portfolio.priceMax)
                : "—"}
            </b>
            <span>Potential revenue</span>
            <small>
              Across {portfolio.open} {pluralize(portfolio.open, "opportunity", "opportunities")}
            </small>
          </p>
        </div>
        <blockquote>
          “Find the revenue that’s already there.”<cite>Axiom Orbit</cite>
        </blockquote>
      </section>

      <section className="home-weekly" aria-labelledby="weekly-heading">
        <div className="section-head">
          <div>
            <span className="eyebrow">This week</span>
            <h2 id="weekly-heading" className="title-section">
              Portfolio changes
            </h2>
          </div>
          <Link to="/operations">Check health</Link>
        </div>
        {data.runs.length === 0 ? (
          <p className="prose faint">
            No checks completed in the last seven days. This does not mean every site is clean.
          </p>
        ) : (
          <ul className="weekly-list">
            {data.runs.slice(0, 5).map((run) => (
              <li key={run.id}>
                <div className="weekly-row">
                  <Link to={`/clients/${encodeURIComponent(run.clientId)}`}>{run.clientName}</Link>
                  <time dateTime={run.finishedAt}>{formatRelative(run.finishedAt)}</time>
                </div>
                <p>
                  {run.outcome === "inconclusive"
                    ? "Could not fully assess"
                    : `${run.newCount} new · ${run.resolvedCount} confirmed fixed`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
