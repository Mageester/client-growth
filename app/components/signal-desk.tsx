import { useCallback, useRef, useState } from "react";
import { Link } from "react-router";

import type { Client, Opportunity } from "@/core/schema";
import { buildEvidenceCase } from "../lib/evidence";
import { nextAction, statusBadge } from "../lib/portfolio";
import { formatCurrencyRange, formatRelative, Icon } from "./ui";
import { ClientMark, GlyphMark, markForRule } from "./entity-mark";

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

/**
 * The opportunity queue.
 *
 * One row is always the current one, and the arrow keys move it. That is what
 * the highlighted row in the approved reference means: not decoration, and not
 * a stored selection, but the cursor of a work queue you can drive from the
 * keyboard — Down/Up to move, Enter to open, Home/End for the ends. Only the
 * current row is tabbable, so the queue is one Tab stop rather than one per
 * finding.
 */
export function OpportunityQueue({
  entries,
  hrefFor,
}: {
  entries: SignalDeskEntry[];
  hrefFor: (entry: SignalDeskEntry) => string;
}) {
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const focusRow = useCallback((index: number) => {
    const rows = listRef.current?.querySelectorAll<HTMLAnchorElement>(".signal-row-select");
    rows?.[index]?.focus();
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    const last = entries.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowDown") next = Math.min(cursor + 1, last);
    else if (event.key === "ArrowUp") next = Math.max(cursor - 1, 0);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    setCursor(next);
    focusRow(next);
  }

  // The cursor indexes into the list, so a filter or a search that shortens it
  // must not leave the cursor pointing past the end.
  const current = Math.min(cursor, Math.max(entries.length - 1, 0));

  return (
    <ul className="signal-list" ref={listRef} onKeyDown={onKeyDown}>
      {entries.map((entry, index) => (
        <OpportunitySignalRow
          key={entry.opportunity.id}
          entry={entry}
          selected={index === current}
          selectHref={hrefFor(entry)}
          onFocus={() => setCursor(index)}
        />
      ))}
    </ul>
  );
}

export function OpportunitySignalRow({
  entry,
  selected,
  selectHref,
  onFocus,
}: {
  entry: SignalDeskEntry;
  selected: boolean;
  selectHref: string;
  onFocus?: () => void;
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
        tabIndex={onFocus ? (selected ? 0 : -1) : undefined}
        onFocus={onFocus}
      >
        <span className="signal-row-core">
          <GlyphMark {...markForRule(opportunity.ruleId)} size="lg" />
          <span>
            <span className="signal-row-title">{opportunity.title}</span>
            <span className="signal-row-context">
              <span>{serviceName}</span>
              {opportunity.priceMax >= 1500 && <small>High value</small>}
            </span>
          </span>
        </span>
        <span className="signal-row-client">
          <ClientMark name={client.name} seed={client.domain} size="sm" />
          <span className="signal-row-client-name">{client.name}</span>
        </span>
        <span className="signal-row-value">
          <span>{formatCurrencyRange(opportunity.priceMin, opportunity.priceMax)}</span>
        </span>
        <span className="signal-row-confidence">
          <span className={"confidence-dot " + (confidence >= 80 ? "strong" : confidence >= 65 ? "medium" : "low")} />
          <b>{confidence}%</b>
          <small className="sr-only">{confidenceLabel(opportunity.confidence)} evidence</small>
        </span>
        <span className="signal-row-age">{formatRelative(opportunity.updatedAt)}</span>
        <span className={"sr-only signal-status " + badge.tone}>{badge.label}</span>
        <Icon name="chevron-right" size={17} className="signal-row-chevron" />
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
