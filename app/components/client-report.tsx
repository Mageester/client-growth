import type { ReactNode } from "react";

import type {
  ClientReportEvidenceSnapshot,
  ClientReportProjectSnapshot,
  ClientReportPublicSnapshot,
} from "@/core/clientReport";
import { normalizeAndValidateUrl } from "@/adapters/evidence/urlPolicy";
import { formatCurrencyRange, formatDate } from "./ui";

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const result = normalizeAndValidateUrl(value);
  return result.ok ? result.url.toString() : null;
}

function safeLogo(value: string | null): string | null {
  if (!value) return null;
  if (/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]*={0,2}$/i.test(value)) return value;
  return safeHttpUrl(value);
}

function EvidenceItem({ item }: { item: ClientReportEvidenceSnapshot }) {
  const url = safeHttpUrl(item.url);
  return (
    <li className="client-report-evidence-item">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <span>{item.label}</span>
          <span className="client-report-evidence-url">{url}</span>
        </a>
      ) : (
        <span>{item.label}</span>
      )}
      {item.note && <small>{item.note}</small>}
    </li>
  );
}

function ValueFact({ project }: { project: ClientReportProjectSnapshot }) {
  const value = project.underlyingOpportunityValue;
  if (!value) return null;
  return (
    <div className="client-report-fact">
      <dt>Underlying opportunity value</dt>
      <dd>{formatCurrencyRange(value.min, value.max)}</dd>
      <small>Sum of the existing service ranges included here; this is not a package quote.</small>
    </div>
  );
}

function PackagePriceFact({ project }: { project: ClientReportProjectSnapshot }) {
  return (
    <div className="client-report-fact">
      <dt>Package price</dt>
      <dd>
        {project.packagePrice
          ? formatCurrencyRange(project.packagePrice.amount, project.packagePrice.amount)
          : "Pricing to be confirmed"}
      </dd>
      {project.packagePrice && <small>Confirmed by the agency for this discussion.</small>}
    </div>
  );
}

function ReportProject({
  project,
  number,
  supporting = false,
}: {
  project: ClientReportProjectSnapshot;
  number?: number;
  supporting?: boolean;
}) {
  const evidence = project.findings
    .flatMap((finding) => finding.evidence)
    .filter((item, index, items) => {
      const key = `${item.url ?? ""}|${item.label}|${item.note}`;
      return items.findIndex((candidate) => `${candidate.url ?? ""}|${candidate.label}|${candidate.note}` === key) === index;
    });
  return (
    <article className={supporting ? "client-report-project is-supporting" : "client-report-project"}>
      <header className="client-report-project-head">
        <div>
          {number !== undefined && <span className="client-report-project-number">0{number}</span>}
          <h3>{project.title}</h3>
          <p>{project.rationale}</p>
        </div>
        <span className="client-report-project-label">{supporting ? "Supporting work" : "Recommended"}</span>
      </header>

      <div className="client-report-project-grid">
        <section>
          <h4>What we observed</h4>
          <p>{project.observed}</p>
        </section>
        <section>
          <h4>Recommended scope</h4>
          <ul className="client-report-scope-list">
            {project.scope.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
        </section>
      </div>

      <section className="client-report-findings">
        <div className="client-report-section-label">
          <h4>Included opportunities</h4>
          <span>{project.findings.length} {project.findings.length === 1 ? "item" : "items"}</span>
        </div>
        <div className="client-report-finding-list">
          {project.findings.map((finding, index) => (
            <div className="client-report-finding" key={`${finding.title}-${index}`}>
              <strong>{finding.title}</strong>
              <p>{finding.observed}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="client-report-evidence">
        <div className="client-report-section-label">
          <h4>Supporting evidence</h4>
          <span>Pages reviewed</span>
        </div>
        {evidence.length > 0 ? (
          <ul>
            {evidence.map((item, index) => <EvidenceItem key={`${index}-${item.label}`} item={item} />)}
          </ul>
        ) : (
          <p className="client-report-muted">No public page link was retained for this item.</p>
        )}
      </section>

      <dl className="client-report-facts">
        <ValueFact project={project} />
        <PackagePriceFact project={project} />
      </dl>
    </article>
  );
}

function ReportSection({
  eyebrow,
  title,
  children,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`client-report-section ${className}`.trim()}>
      {eyebrow && <span className="client-report-eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/**
 * The public document projection. It intentionally accepts only the public
 * snapshot type, so internal provenance cannot accidentally cross into HTML.
 */
export function ClientReportDocument({
  snapshot,
  publicView = false,
}: {
  snapshot: ClientReportPublicSnapshot;
  publicView?: boolean;
}) {
  const logo = safeLogo(snapshot.agency.logo);
  const summary = snapshot.executiveSummary;
  const evidenceDate = snapshot.evidenceReviewedAt;

  return (
    <article
      className={`client-report-document${publicView ? " is-public" : ""}`}
      data-report-theme={snapshot.agency.theme}
    >
      <section className="client-report-cover">
        <div className="client-report-brand">
          {logo && <img src={logo} alt={`${snapshot.agency.name} logo`} referrerPolicy="no-referrer" />}
          <div>
            <span className="client-report-eyebrow">Prepared by</span>
            <h1>{snapshot.agency.name}</h1>
          </div>
        </div>
        <div className="client-report-cover-title">
          <span className="client-report-eyebrow">Client growth review</span>
          <h2>{snapshot.client.name}</h2>
          <p>{snapshot.client.domain}</p>
        </div>
        <dl className="client-report-cover-meta">
          <div><dt>Prepared by</dt><dd>{snapshot.preparedBy}</dd></div>
          <div><dt>Prepared</dt><dd><time dateTime={snapshot.generatedAt}>{formatDate(snapshot.generatedAt)}</time></dd></div>
          <div><dt>Evidence reviewed</dt><dd>{evidenceDate ? <time dateTime={evidenceDate}>{formatDate(evidenceDate)}</time> : "Not recorded"}</dd></div>
        </dl>
        <p className="client-report-notice">{snapshot.notice}</p>
      </section>

      <ReportSection eyebrow="01 / Overview" title="Executive summary" className="client-report-summary">
        <p className="client-report-lede">
          {summary.recommendedProjectCount > 0
            ? <>We identified {summary.recommendedProjectCount} {summary.recommendedProjectCount === 1 ? "recommended project" : "recommended projects"}
                {summary.strongestCommercialArea ? <> with the clearest starting point in <strong>{summary.strongestCommercialArea}</strong>.</> : "."}</>
            : "No commercial priorities were selected for this report. Supporting website improvements are shown separately."}
        </p>
        <div className="client-report-summary-at-a-glance" aria-label="Report at a glance">
          <div>
            <span>Recommended projects</span>
            <strong>{String(summary.recommendedProjectCount).padStart(2, "0")}</strong>
          </div>
          <div>
            <span>Strongest starting point</span>
            <strong>{summary.strongestCommercialArea ?? "Supporting work"}</strong>
          </div>
        </div>
        {summary.underlyingOpportunityValue && (
          <div className="client-report-summary-value">
            <span>Underlying opportunity value</span>
            <strong>{formatCurrencyRange(summary.underlyingOpportunityValue.min, summary.underlyingOpportunityValue.max)}</strong>
            <small>Sum of the included existing service ranges, not a package quote.</small>
          </div>
        )}
        {snapshot.agencyNote && (
          <div className="client-report-agency-note">
            <span className="client-report-eyebrow">A note from the agency</span>
            <p>{snapshot.agencyNote}</p>
          </div>
        )}
      </ReportSection>

      {snapshot.recommendedProjects.length > 0 && (
        <ReportSection eyebrow="02 / Priorities" title="Recommended projects" className="client-report-projects">
          <p className="client-report-section-intro">These are the priorities selected for discussion, ordered by the agency.</p>
          <div className="client-report-project-list">
            {snapshot.recommendedProjects.map((project, index) => (
              <ReportProject key={`${project.title}-${index}`} project={project} number={index + 1} />
            ))}
          </div>
        </ReportSection>
      )}

      {snapshot.supportingProjects.length > 0 && (
        <ReportSection eyebrow="03 / Supporting work" title="Supporting website improvements" className="client-report-supporting">
          <p className="client-report-section-intro">These improvements support the priorities above and can be scheduled separately.</p>
          <div className="client-report-project-list">
            {snapshot.supportingProjects.map((project, index) => (
              <ReportProject key={`${project.title}-${index}`} project={project} supporting />
            ))}
          </div>
        </ReportSection>
      )}

      <ReportSection eyebrow="04 / Next step" title="A practical next step" className="client-report-next-step">
        <p>{snapshot.nextStep}</p>
        <div className="client-report-next-step-checklist" aria-label="Next step checklist">
          <span>Review priorities</span>
          <span>Confirm scope</span>
          <span>Confirm pricing</span>
        </div>
      </ReportSection>

      <ReportSection eyebrow="05 / Freshness" title="Freshness and limitations" className="client-report-limitations">
        <p>
          This report was generated on <time dateTime={snapshot.generatedAt}>{formatDate(snapshot.generatedAt)}</time>{evidenceDate ? <> using evidence reviewed on <time dateTime={evidenceDate}>{formatDate(evidenceDate)}</time>.</> : ". The evidence review date was not recorded."}
        </p>
        {snapshot.limitations.length > 0 ? (
          <ul>
            {snapshot.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}
          </ul>
        ) : (
          <p className="client-report-muted">No additional analysis limitation was recorded for this report.</p>
        )}
      </ReportSection>

      <footer className="client-report-footer">
        <span>{snapshot.agency.name}</span>
        <span>Prepared for {snapshot.client.name}</span>
        <span>For discussion; pricing and outcomes require confirmation.</span>
      </footer>
    </article>
  );
}
