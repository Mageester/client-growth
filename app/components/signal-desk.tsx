import { Link } from "react-router";

import type { Client, Opportunity } from "@/core/schema";
import { buildEvidenceCase } from "../lib/evidence";
import { nextAction, statusBadge } from "../lib/portfolio";
import { formatCurrencyRange, Icon } from "./ui";

export interface SignalDeskEntry {
  client: Pick<Client, "id" | "name" | "domain">;
  opportunity: Opportunity;
  serviceName: string;
}

function confidenceLabel(value: number): string {
  if (value >= 0.8) return "Strong";
  if (value >= 0.6) return "Moderate";
  return "Limited";
}

export function OpportunitySignalRow({
  entry,
  selected,
  selectHref,
}: {
  entry: SignalDeskEntry;
  selected: boolean;
  selectHref: string;
}) {
  const { opportunity, client, serviceName } = entry;
  const badge = statusBadge(opportunity);
  const confidence = Math.round(opportunity.confidence * 100);

  return (
    <li className={"signal-row" + (selected ? " is-selected" : "")}>
      <Link
        to={selectHref}
        className="signal-row-select"
        aria-current={selected ? "true" : undefined}
      >
        <span className="signal-row-core">
          <span className="signal-row-title">{opportunity.title}</span>
          <span className="signal-row-context">
            <span>{client.name}</span>
            <span aria-hidden="true">·</span>
            <span>{serviceName}</span>
          </span>
        </span>
        <span className="signal-row-value">
          <span>{formatCurrencyRange(opportunity.priceMin, opportunity.priceMax)}</span>
          <small>potential</small>
        </span>
        <span className="signal-row-confidence">
          <b>{confidence}%</b>
          <small>{confidenceLabel(opportunity.confidence)} evidence</small>
        </span>
        <span className={"signal-status badge " + badge.tone}>{badge.label}</span>
      </Link>
    </li>
  );
}

export function OpportunityInspector({
  entry,
  closeHref,
  openOnMobile = false,
}: {
  entry: SignalDeskEntry;
  closeHref: string;
  openOnMobile?: boolean;
}) {
  const { opportunity, client, serviceName } = entry;
  const evidence = buildEvidenceCase(opportunity);
  const badge = statusBadge(opportunity);
  const confidence = Math.round(opportunity.confidence * 100);
  const proposalReady = opportunity.status === "proposal_prepared";

  return (
    <aside
      className={"signal-inspector" + (openOnMobile ? " is-mobile-open" : "")}
      aria-label="Selected opportunity"
    >
      <header className="inspector-head">
        <div>
          <p className="eyebrow">Selected signal</p>
          <span className={"badge " + badge.tone}>{badge.label}</span>
        </div>
        <Link className="icon-btn inspector-close" to={closeHref} aria-label="Close inspector">
          <Icon name="x" size={16} />
        </Link>
      </header>

      <div className="inspector-scroll">
        <div className="inspector-intro">
          <h2>{opportunity.title}</h2>
          <Link to={`/clients/${client.id}`} className="inspector-account">
            <span>{client.name}</span>
            <small>{client.domain}</small>
          </Link>
        </div>

        <dl className="inspector-metrics">
          <div>
            <dt>Potential value</dt>
            <dd>{formatCurrencyRange(opportunity.priceMin, opportunity.priceMax)}</dd>
          </div>
          <div>
            <dt>Evidence strength</dt>
            <dd>
              <span>
                {confidence}% · {confidenceLabel(opportunity.confidence).toLowerCase()}
              </span>
            </dd>
          </div>
          <div>
            <dt>Mapped service</dt>
            <dd>{serviceName}</dd>
          </div>
        </dl>

        <section className="inspector-section">
          <p className="inspector-label">Why it matters</p>
          <p>{opportunity.rationale}</p>
          <p className="inspector-detected">{opportunity.detected}</p>
        </section>

        <section className="inspector-section">
          <div className="inspector-section-head">
            <p className="inspector-label">Evidence</p>
            <span>{evidence.inspectedCount} checked</span>
          </div>
          <p className="inspector-evidence-summary">{evidence.headline}</p>
          <ul className="inspector-evidence-list">
            {evidence.primary.slice(0, 3).map((item, index) => (
              <li key={`${item.url ?? item.title}-${index}`}>
                <span className="evidence-icon" aria-hidden="true">
                  <Icon name={item.url ? "globe" : "document"} size={14} />
                </span>
                <span>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.title}
                    </a>
                  ) : (
                    <b>{item.title}</b>
                  )}
                  <small>{item.note}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="inspector-section inspector-service">
          <p className="inspector-label">Services</p>
          <div className="service-match">
            <span className="service-match-icon" aria-hidden="true">
              <Icon name="briefcase" size={16} />
            </span>
            <span>
              <b>{serviceName}</b>
              <small>{opportunity.suggestedScope.slice(0, 3).join(" · ")}</small>
            </span>
          </div>
        </section>
      </div>

      <footer className="inspector-actions">
        <p>
          <span>Recommended next step</span>
          {nextAction(opportunity)}
        </p>
        <Link to={`/opportunities/${opportunity.id}`} className="btn btn-primary full">
          {proposalReady ? "Open proposal draft" : "Review & prepare proposal"}
          <Icon name="arrow-right" size={15} />
        </Link>
      </footer>
    </aside>
  );
}
