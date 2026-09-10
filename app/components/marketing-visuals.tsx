import type { ReactNode } from "react";

export type MarketingIconName =
  | "portfolio"
  | "monitor"
  | "understand"
  | "find"
  | "review"
  | "act"
  | "recurring"
  | "path"
  | "coverage"
  | "states"
  | "qualify"
  | "price"
  | "prepare";

const iconPaths: Record<MarketingIconName, string> = {
  portfolio: "M8.5 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 8.5c.5-3 2.2-4.5 5-4.5s4.5 1.5 5 4.5m-.5-9a2.5 2.5 0 1 0 0-5m3 5.5c2.3.2 3.5 1.5 4 4",
  monitor: "M3.5 4.5h17v11h-17zM8 19.5h8M12 15.5v4",
  understand: "M10.5 15.5a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm3.5-1.5 5 5",
  find: "M4.5 5.5h11v11h-11zM8 9h4m-4 3h3m7-5v6m0 0-2-2m2 2 2-2",
  review: "M7 4.5h10v15H7zM9.5 3.5h5v3h-5zM9.5 11h5m-5 3h5",
  act: "M3.5 12h14m-4-4 4 4-4 4M3.5 5.5h5m-5 13h5",
  recurring: "M20 8.5a8 8 0 0 0-14.5-2L3.5 9m0 0 4.5-.5M3.5 9l.5-4.5M4 15.5a8 8 0 0 0 14.5 2l2-2.5m0 0-4.5.5m4.5-.5-.5 4.5",
  path: "M9.5 14.5 8 16a3.5 3.5 0 0 1-5-5l2.5-2.5a3.5 3.5 0 0 1 5 0m2-3L14 4a3.5 3.5 0 0 1 5 5l-2.5 2.5a3.5 3.5 0 0 1-5 0m-5 1.5 7-3",
  coverage: "M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z",
  states: "m12 3 7 3v5.5c0 4.2-2.8 7.6-7 9.5-4.2-1.9-7-5.3-7-9.5V6l7-3Zm-3 8.5 2 2 4-4",
  qualify: "M12 13.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 6c.6-3.2 2.9-4.8 7-4.8s6.4 1.6 7 4.8",
  price: "M4.5 5.5h15v13h-15zM8 9.5h8m-8 3h5m-5 3h3",
  prepare: "M6 3.5h9l3 3v14H6zM15 3.5v4h3m-9 4h6m-6 3h6m-6 3h4",
};

export function MarketingIcon({ name }: { name: MarketingIconName }) {
  return (
    <svg
      className="marketing-inline-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}

type EvidenceVisualProps = {
  compact?: boolean;
};

const loopSteps = [
  {
    title: "Client portfolio",
    copy: "Add the client sites and the offerings those businesses sell.",
    icon: "portfolio",
  },
  {
    title: "Monitor",
    copy: "Run Analyze site, or opt a chosen client into Weekly monitoring.",
    icon: "monitor",
  },
  {
    title: "Understand",
    copy: "Keep crawl evidence, client context, services, and contract coverage together.",
    icon: "understand",
  },
  {
    title: "Find",
    copy: "Surface missing service coverage or a broken conversion path when evidence supports it.",
    icon: "find",
  },
  {
    title: "Review",
    copy: "Inspect what was found, why it matters, the evidence strength, and the mapped service.",
    icon: "review",
  },
  {
    title: "Act",
    copy: "Mark it covered, dismiss or snooze it, reopen it later, or prepare a proposal draft.",
    icon: "act",
  },
] as const;

const monitoringStates = [
  {
    label: "New",
    copy: "A finding is surfaced for the first time or returns.",
  },
  {
    label: "Still open",
    copy: "A known finding remains present.",
  },
  {
    label: "Resolved",
    copy: "Re-analysis confirms the client fixed it.",
  },
  {
    label: "Inconclusive",
    copy: "The site could not be read well enough to claim anything.",
  },
] as const;

function EvidenceField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="marketing-evidence-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function OpportunityEvidenceVisual({ compact = false }: EvidenceVisualProps) {
  return (
    <article
      className={`marketing-evidence-card${compact ? " marketing-evidence-card--compact" : ""}`}
      aria-label="Illustrative product view"
    >
      <header className="marketing-evidence-header">
        <div>
          <p className="marketing-visual-label">Illustrative product view</p>
          <p className="marketing-evidence-title">Opportunity detail</p>
        </div>
        <span className="marketing-visual-note">Illustrative data — not customer proof.</span>
      </header>

      {compact ? (
        <div className="marketing-evidence-compact-record">
          <dl>
            <EvidenceField label="Account">Northstar HVAC</EvidenceField>
            <EvidenceField label="Signal">Broken quote path</EvidenceField>
            <EvidenceField label="Mapped service">Conversion optimisation</EvidenceField>
            <div className="marketing-evidence-compact-status">
              <EvidenceField label="Status">
                <span className="marketing-status marketing-status--open">Open</span>
              </EvidenceField>
              <EvidenceField label="Evidence strength">
                <span className="marketing-status marketing-status--strong">Strong evidence</span>
              </EvidenceField>
            </div>
          </dl>
        </div>
      ) : (
        <div className="marketing-evidence-grid">
          <div className="marketing-evidence-summary">
            <dl>
              <EvidenceField label="Account">Northstar HVAC</EvidenceField>
              <EvidenceField label="Signal">Broken quote path</EvidenceField>
              <EvidenceField label="Mapped service">Conversion optimisation</EvidenceField>
              <EvidenceField label="Status">
                <span className="marketing-status marketing-status--open">Open</span>
              </EvidenceField>
              <EvidenceField label="Evidence strength">
                <span className="marketing-status marketing-status--strong">Strong evidence</span>
              </EvidenceField>
            </dl>
          </div>

          <div className="marketing-evidence-case">
            <div className="marketing-evidence-block">
              <span className="marketing-evidence-label">What was found</span>
              <p>Quote request page returns an error.</p>
            </div>
            <div className="marketing-evidence-block">
              <span className="marketing-evidence-label">Why it matters to the client</span>
              <p>Visitors may abandon the path before they can request a quote.</p>
            </div>
            <div className="marketing-evidence-block">
              <span className="marketing-evidence-label">What the work would be</span>
              <p>Repair and validate the quote request journey.</p>
            </div>
          </div>
        </div>
      )}

      <div className="marketing-evidence-sources">
        <div>
          <span className="marketing-evidence-label">Evidence</span>
          <strong>Checked source paths</strong>
        </div>
        <ul aria-label="Checked source paths">
          <li><span aria-hidden="true">↗</span> northstarhvac.ca/contact</li>
          <li><span aria-hidden="true">↗</span> northstarhvac.ca/services</li>
        </ul>
      </div>

      <footer className="marketing-evidence-footer">
        <div>
          <span className="marketing-evidence-label">Recommended next step</span>
          <p>Review the evidence, then prepare a proposal.</p>
        </div>
        <button type="button" className="marketing-evidence-action" disabled>
          Review &amp; prepare proposal
        </button>
      </footer>
    </article>
  );
}

export function OrbitLoop() {
  return (
    <div className="marketing-orbit-loop">
      <p className="marketing-loop-sequence" aria-hidden="true">
        {loopSteps.map((step, index) => (
          <span key={step.title} className="marketing-loop-sequence-item">
            {step.title}
            {index < loopSteps.length - 1 && <span aria-hidden="true">→</span>}
          </span>
        ))}
      </p>
      <ol className="marketing-loop-list">
        {loopSteps.map((step, index) => (
          <li key={step.title} className="marketing-loop-item">
            <div className="marketing-loop-marker"><MarketingIcon name={step.icon} /></div>
            <h3>{step.title}</h3>
            <p>{step.copy}</p>
            {index < loopSteps.length - 1 && (
              <span className="marketing-loop-arrow" aria-hidden="true">→</span>
            )}
          </li>
        ))}
      </ol>
      <p className="marketing-loop-note">The agency remains the decision-maker.</p>
    </div>
  );
}

export function MonitoringTimeline() {
  return (
    <div className="marketing-monitoring-timeline">
      <div className="marketing-monitoring-controls" aria-label="Monitoring setup">
        <div>
          <span className="marketing-evidence-label">Analyze site</span>
          <strong>Read the client site and capture evidence</strong>
        </div>
        <div>
          <span className="marketing-evidence-label">Monitoring on · Weekly</span>
          <strong>Revisit the chosen client on its cadence</strong>
        </div>
        <div>
          <span className="marketing-evidence-label">Monitoring checked</span>
          <strong>Record the completed run and its outcome</strong>
        </div>
      </div>

      <ol className="marketing-monitoring-states">
        {monitoringStates.map((state, index) => (
          <li key={state.label} className={`marketing-monitoring-state marketing-monitoring-state--${index + 1}`}>
            <span className="marketing-monitoring-dot" aria-hidden="true" />
            <h3>{state.label}</h3>
            <p>{state.copy}</p>
          </li>
        ))}
      </ol>

      <p className="marketing-monitoring-note">
        A healthy weekly check can stay quiet. An incomplete read stays visible as Inconclusive.
      </p>
    </div>
  );
}

type ProductVisualFrameProps = {
  children: ReactNode;
  className?: string;
};

function ProductVisualFrame({ children, className = "" }: ProductVisualFrameProps) {
  return (
    <figure className={`marketing-product-visual ${className}`.trim()} aria-label="Illustrative product view">
      <figcaption className="marketing-product-visual-label">Illustrative product view</figcaption>
      {children}
    </figure>
  );
}

const productMonitorStates = [
  { date: "APR 07", label: "New", tone: "new" },
  { date: "APR 14", label: "Still open", tone: "open" },
  { date: "APR 21", label: "Still open", tone: "open" },
  { date: "APR 28", label: "Resolved", tone: "resolved" },
  { date: "MAY 05", label: "Inconclusive", tone: "inconclusive" },
] as const;

export function ProductMonitorVisual() {
  return (
    <ProductVisualFrame className="marketing-product-visual--monitor">
      <div className="marketing-product-visual-header">
        <div>
          <strong>Northstar HVAC</strong>
          <span>northstarhvac.example</span>
        </div>
        <div className="marketing-product-visual-header-meta">
          <strong>Monitoring · Weekly</strong>
          <span>Opt-in · default Off</span>
        </div>
      </div>
      <ol className="marketing-product-monitor-timeline" aria-label="Illustrative monitoring history">
        {productMonitorStates.map((state, index) => (
          <li key={`${state.date}-${state.label}`} className={`marketing-product-monitor-state marketing-product-monitor-state--${state.tone}`}>
            <span className="marketing-product-monitor-date">{state.date}</span>
            <span className="marketing-product-monitor-point" aria-hidden="true" />
            <span className="marketing-product-monitor-status">{state.label}</span>
            {index === 0 && <span className="marketing-product-monitor-detail">Finding surfaced</span>}
            {index === 3 && <span className="marketing-product-monitor-detail">Re-analysis confirms</span>}
            {index === 4 && <span className="marketing-product-monitor-detail">Read was incomplete</span>}
          </li>
        ))}
      </ol>
      <p className="marketing-product-visual-footnote">The agency chooses the client and cadence. A healthy check can stay quiet.</p>
    </ProductVisualFrame>
  );
}

export function ProductUnderstandVisual() {
  return (
    <ProductVisualFrame className="marketing-product-visual--understand">
      <div className="marketing-product-visual-header marketing-product-visual-header--compact">
        <div>
          <strong>Northstar HVAC</strong>
          <span>Public-site evidence</span>
        </div>
        <span className="marketing-product-visual-header-status">Bounded read</span>
      </div>
      <div className="marketing-product-understand-grid">
        <div className="marketing-product-source-list">
          <span className="marketing-product-field-label">Source URLs</span>
          <ul aria-label="Illustrative public source URLs">
            <li>https://northstarhvac.example/</li>
            <li>https://northstarhvac.example/about</li>
            <li>https://northstarhvac.example/services</li>
            <li>https://northstarhvac.example/contact</li>
          </ul>
          <span className="marketing-product-source-note">Observed facts stay attached to their source.</span>
        </div>
        <dl className="marketing-product-context-list">
          <div>
            <dt>Recorded offerings</dt>
            <dd>Heating · Maintenance · Heat pumps</dd>
          </div>
          <div>
            <dt>Service catalog</dt>
            <dd>Agency services and matching context</dd>
          </div>
          <div>
            <dt>Contract coverage</dt>
            <dd>Covered work stays distinct from a billable gap</dd>
          </div>
        </dl>
      </div>
      <p className="marketing-product-visual-footnote">Suggestions stay suggestions until a person confirms them.</p>
    </ProductVisualFrame>
  );
}

const productFindCategories = [
  {
    title: "Commercial gaps",
    copy: "A service the client sells has no page of its own for the demand it attracts.",
    icon: "find",
  },
  {
    title: "Conversion failures",
    copy: "A form, CTA, or journey does not complete.",
    icon: "path",
  },
  {
    title: "Technical content issues",
    copy: "Titles, headings, descriptions, links, or schema the public read shows are missing or broken.",
    icon: "understand",
  },
  {
    title: "Evidence review",
    copy: "Source URLs and observed facts stay attached to the finding.",
    icon: "review",
  },
  {
    title: "Proposal drafting and sharing",
    copy: "Turn a reviewed finding into an editable draft and expiring share link.",
    icon: "act",
  },
  {
    title: "Opt-in monitoring",
    copy: "Revisit a chosen client and keep new, open, resolved, or inconclusive states visible.",
    icon: "monitor",
  },
  {
    title: "Evidence-gated checks",
    copy: "A site with no service pages is claimed only when the read supports it; otherwise Orbit stays inconclusive.",
    icon: "states",
  },
] as const;

export function ProductFindVisual() {
  return (
    <ProductVisualFrame className="marketing-product-visual--find">
      <div className="marketing-product-visual-header marketing-product-visual-header--compact">
        <div>
          <strong>Signal desk</strong>
          <span>Checks backed by website sources</span>
        </div>
        <span className="marketing-product-visual-header-status">Evidence gate</span>
      </div>
      <ul className="marketing-product-find-list" aria-label="Orbit checks backed by website sources">
        {productFindCategories.map((category) => (
          <li key={category.title}>
            <span className="marketing-product-find-icon"><MarketingIcon name={category.icon} /></span>
            <span className="marketing-product-find-copy">
              <strong>{category.title}</strong>
              <span>{category.copy}</span>
            </span>
            <button type="button" className="marketing-product-fragment-action" disabled>
              View
            </button>
          </li>
        ))}
      </ul>
      <p className="marketing-product-visual-footnote">Every current check needs reviewable evidence; anything beyond those checks is direction, not a live claim.</p>
    </ProductVisualFrame>
  );
}

const productActReviewItems = [
  { title: "What we found", copy: "Broken quote path", icon: "find" },
  { title: "Why it matters", copy: "Visitors may abandon the request", icon: "understand" },
  { title: "Proof from the site", copy: "Screenshots · source URLs", icon: "review" },
  { title: "Recommended approach", copy: "Repair and validate", icon: "act" },
] as const;

export function ProductActVisual() {
  return (
    <ProductVisualFrame className="marketing-product-visual--act">
      <div className="marketing-product-act-grid">
        <section className="marketing-product-act-review" aria-labelledby="product-act-review-title">
          <div className="marketing-product-panel-heading">
            <span className="marketing-product-field-label">Evidence review</span>
            <strong id="product-act-review-title">Broken quote path</strong>
          </div>
          <ol>
            {productActReviewItems.map((item) => (
              <li key={item.title}>
                <MarketingIcon name={item.icon} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.copy}</small>
                </span>
                <span className="marketing-product-review-chevron" aria-hidden="true">›</span>
              </li>
            ))}
          </ol>
          <div className="marketing-product-potential-value">
            <span className="marketing-product-field-label">Potential value · agency catalog</span>
            <strong>$300–$900</strong>
            <small>Illustrative range, not revenue.</small>
          </div>
        </section>
        <section className="marketing-product-proposal" aria-labelledby="product-proposal-title">
          <div className="marketing-product-panel-heading">
            <span className="marketing-product-field-label">Editable proposal</span>
            <strong id="product-proposal-title">Draft and share link</strong>
          </div>
          <label>
            Mapped service
            <input readOnly value="Website service page" aria-label="Mapped service" />
          </label>
          <label>
            Scope
            <input readOnly value="Strategy, copy, design, build" aria-label="Proposal scope" />
          </label>
          <label>
            Next step
            <input readOnly value="Discovery call" aria-label="Proposal next step" />
          </label>
          <p className="marketing-product-proposal-boundary">Review, then create an expiring share link. Nothing is sent automatically.</p>
        </section>
      </div>
      <p className="marketing-product-visual-footnote">Review and save the draft, then deliberately create an expiring share link.</p>
    </ProductVisualFrame>
  );
}

const productGrowSteps = [
  { title: "Signal", copy: "Issue detected", icon: "states", direction: false },
  { title: "Review", copy: "Evidence validated", icon: "review", direction: false },
  { title: "Proposal", copy: "Draft prepared", icon: "prepare", direction: false },
  { title: "Outcome", copy: "Revenue and outcome tracking", icon: "coverage", direction: true },
] as const;

export function ProductGrowVisual() {
  return (
    <ProductVisualFrame className="marketing-product-visual--grow">
      <ol className="marketing-product-grow-flow" aria-label="Orbit product direction">
        {productGrowSteps.map((step, index) => (
          <li key={step.title} className={step.direction ? "marketing-product-grow-step--direction" : undefined}>
            <div className="marketing-product-grow-icon"><MarketingIcon name={step.icon} /></div>
            <div className="marketing-product-grow-copy">
              {step.direction && <span className="marketing-product-direction-label">Direction</span>}
              <strong>{step.title}</strong>
              <span>{step.copy}</span>
            </div>
            {index < productGrowSteps.length - 1 && <span className="marketing-product-grow-arrow" aria-hidden="true">→</span>}
          </li>
        ))}
      </ol>
      <p className="marketing-product-visual-footnote">Today’s product gives you finding history and potential value; outcomes belong to the next layer.</p>
    </ProductVisualFrame>
  );
}
