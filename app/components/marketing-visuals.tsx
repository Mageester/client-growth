import type { ReactNode } from "react";

type EvidenceVisualProps = {
  compact?: boolean;
};

const loopSteps = [
  {
    title: "Client portfolio",
    copy: "Add the client sites and the offerings those businesses sell.",
  },
  {
    title: "Monitor",
    copy: "Run Analyze site, or opt a chosen client into Weekly monitoring.",
  },
  {
    title: "Understand",
    copy: "Keep crawl evidence, client context, services, and contract coverage together.",
  },
  {
    title: "Find",
    copy: "Surface missing service coverage or a broken conversion path when evidence supports it.",
  },
  {
    title: "Review",
    copy: "Inspect what was found, why it matters, the evidence strength, and the mapped service.",
  },
  {
    title: "Act",
    copy: "Mark it covered, dismiss or snooze it, reopen it later, or prepare a proposal draft.",
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
          <h3>Opportunity detail</h3>
        </div>
        <span className="marketing-visual-note">Illustrative data — not customer proof.</span>
      </header>

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
      <p className="marketing-loop-sequence" aria-label="Client portfolio, Monitor, Understand, Find, Review, Act">
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
            <div className="marketing-loop-marker">
              <span>{String(index + 1).padStart(2, "0")}</span>
            </div>
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
