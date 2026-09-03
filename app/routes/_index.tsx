import { Link } from "react-router";

import { MarketingLayout } from "../components/marketing-layout";
import {
  MarketingIcon,
  MonitoringTimeline,
  OpportunityEvidenceVisual,
  OrbitLoop,
} from "../components/marketing-visuals";

const landingTitle = "Axiom Orbit — Grow the clients you’ve already won.";
const landingDescription =
  "Axiom Orbit reviews the client sites your agency already manages, finds evidence-backed work worth a conversation, and keeps the next review in view.";
const landingCanonical = "https://orbit.getaxiom.ca/";
const socialImage = "https://orbit.getaxiom.ca/brand/axiom-orbit-social-1200x630.png";

export function meta() {
  return [
    { title: landingTitle },
    { name: "description", content: landingDescription },
    { tagName: "link", rel: "canonical", href: landingCanonical },
    { property: "og:title", content: landingTitle },
    { property: "og:description", content: landingDescription },
    { property: "og:url", content: landingCanonical },
    { property: "og:image", content: socialImage },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: landingTitle },
    { name: "twitter:description", content: landingDescription },
    { name: "twitter:image", content: socialImage },
  ];
}

const watchItems = [
  {
    title: "Recurring site review",
    copy: "Revisit the client sites your agency chooses to monitor and record what is New, Still open, Resolved, or Inconclusive.",
    icon: "recurring",
  },
  {
    title: "Broken conversion paths",
    copy: "Check quote request, booking, contact, and click-to-call paths when a break can be established from the site evidence.",
    icon: "path",
  },
  {
    title: "Service coverage",
    copy: "Compare what a client says it sells with the pages the site actually gives those offerings.",
    icon: "coverage",
  },
  {
    title: "Honest opportunity states",
    copy: "Map a surfaced opportunity to your service catalog and contract coverage before calling it billable work.",
    icon: "states",
  },
] as const;

const workflowItems = [
  {
    title: "Review",
    copy: "Open the finding and inspect What was found, Why it matters to the client, and Evidence.",
    icon: "review",
  },
  {
    title: "Qualify",
    copy: "Keep only legitimate, distinct, commercially actionable work.",
    icon: "qualify",
  },
  {
    title: "Price",
    copy: "Use the agency’s service catalog, Potential value configured there, and contract coverage. Covered work does not become a billable upsell.",
    icon: "price",
  },
  {
    title: "Prepare",
    copy: "Edit a Proposal draft in Orbit and take it to the client yourself.",
    icon: "prepare",
  },
] as const;

export default function Index() {
  return (
    <MarketingLayout>
      <div className="marketing-landing">
        <section className="marketing-hero marketing-container" aria-labelledby="landing-title">
          <div className="marketing-hero-copy">
            <h1 id="landing-title">Grow the clients you’ve already won.</h1>
            <div className="marketing-hero-deck">
              <p>{landingDescription}</p>
              <p>
                Pipeline Engine helps agencies acquire new clients. Orbit helps you grow and retain existing ones.
              </p>
            </div>
            <div className="marketing-cta-row">
              <Link className="marketing-button marketing-button-primary" to="/signup">
                Request access
              </Link>
              <Link className="marketing-button" to="/product">
                Explore the product
              </Link>
            </div>
            <p className="marketing-trust-line">
              <span aria-hidden="true" /> Evidence-backed opportunities. Human review. Optional Weekly monitoring.
            </p>
          </div>
          <div className="marketing-hero-visual">
            <OpportunityEvidenceVisual compact />
          </div>
        </section>

        <section className="marketing-section marketing-section--problem" aria-labelledby="portfolio-problem-title">
          <div className="marketing-container marketing-two-column">
            <div>
              <p className="marketing-section-label">THE PORTFOLIO PROBLEM</p>
              <h2 id="portfolio-problem-title">The work is already in your accounts.</h2>
            </div>
            <div className="marketing-section-copy">
              <p>
                A client site can change between reviews. A quote path can break. A service the client sells can remain without a dedicated page. Across a portfolio, those gaps are easy to miss—and become missed conversations.
              </p>
              <p className="marketing-bridge-line">Orbit turns the review into a visible, evidence-backed queue your team can qualify.</p>
            </div>
          </div>
        </section>

        <section className="marketing-section marketing-section--loop" aria-labelledby="orbit-loop-title">
          <div className="marketing-container">
            <div className="marketing-section-heading">
              <p className="marketing-section-label">THE ORBIT LOOP</p>
              <h2 id="orbit-loop-title">A review loop for the clients you already serve.</h2>
              <p>Orbit handles the reading. Your agency decides what happens next.</p>
            </div>
            <OrbitLoop />
          </div>
        </section>

        <section className="marketing-section marketing-section--evidence" aria-labelledby="evidence-title">
          <div className="marketing-container marketing-two-column marketing-two-column--evidence">
            <div className="marketing-section-heading">
              <p className="marketing-section-label">EVIDENCE BEFORE ACTION</p>
              <h2 id="evidence-title">Start with what the site actually returned.</h2>
              <p>
                An opportunity is not a score looking for a story. It starts with evidence the product inspected: a page the crawl read, a conversion path it probed, or an offering checked against the site. Orbit keeps the observation, the client rationale, and the agency’s next step together.
              </p>
              <p className="marketing-honesty-line">
                If Orbit cannot read enough to conclude, it says <strong>Inconclusive</strong>. It does not turn missing evidence into a confident opportunity.
              </p>
            </div>
            <OpportunityEvidenceVisual />
          </div>
        </section>

        <section className="marketing-section marketing-section--watch" aria-labelledby="watch-title">
          <div className="marketing-container">
            <div className="marketing-section-heading marketing-section-heading--wide">
              <p className="marketing-section-label">WHAT ORBIT WATCHES</p>
              <h2 id="watch-title">Know which account signals are worth reviewing.</h2>
              <p>Orbit stays close to observable site behavior and the commercial context your agency supplies.</p>
            </div>
            <div className="marketing-watch-grid">
              {watchItems.map((item) => (
                <article className="marketing-watch-card" key={item.title}>
                  <span className="marketing-card-icon"><MarketingIcon name={item.icon} /></span>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </article>
              ))}
            </div>
            <p className="marketing-operating-note">
              Monitoring is opt-in per client. The default is <strong>Off</strong>; the selectable recurring cadence is <strong>Weekly</strong>. A client is also checked when an agency presses <strong>Analyze site</strong>.
            </p>
          </div>
        </section>

        <section className="marketing-section marketing-section--monitoring" aria-labelledby="monitoring-title">
          <div className="marketing-container">
            <div className="marketing-section-heading">
              <p className="marketing-section-label">CONTINUOUS MONITORING</p>
              <h2 id="monitoring-title">Review the portfolio again—on purpose.</h2>
              <p>
                For a client you choose, turn monitoring on and select Weekly. Orbit revisits the site, records the run as Monitoring checked, and makes the change legible to your team.
              </p>
            </div>
            <MonitoringTimeline />
          </div>
        </section>

        <section className="marketing-section marketing-section--workflow" aria-labelledby="workflow-title">
          <div className="marketing-container">
            <div className="marketing-section-heading marketing-section-heading--wide">
              <p className="marketing-section-label">THE AGENCY WORKFLOW</p>
              <h2 id="workflow-title">Evidence in. Conversation out.</h2>
              <p>Orbit prepares the workbench; your team owns the commercial judgment.</p>
            </div>
            <div className="marketing-workflow-grid">
              {workflowItems.map((item) => (
                <article className="marketing-workflow-card" key={item.title}>
                  <span className="marketing-card-icon"><MarketingIcon name={item.icon} /></span>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </article>
              ))}
            </div>
            <p className="marketing-draft-note">
              Nothing here is sent. Drafts stay inside Axiom Orbit until you copy them out.
            </p>
            <div className="marketing-availability" aria-label="Current and future capabilities">
              <div>
                <span className="marketing-availability-label">Available now</span>
                <p>Site analysis, evidence, opportunities, service catalog, contract coverage, proposal drafts, and opt-in Weekly monitoring.</p>
              </div>
              <div>
                <span className="marketing-availability-label marketing-availability-label--direction">Direction</span>
                <p>Account-growth lifecycle, outcome tracking, and revenue tracking are product direction—not current results.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="marketing-section marketing-section--economic" aria-labelledby="economic-title">
          <div className="marketing-container marketing-two-column">
            <div>
              <p className="marketing-section-label">THE ECONOMIC CASE</p>
              <h2 id="economic-title">Build more value from the relationships already on your books.</h2>
            </div>
            <div className="marketing-section-copy">
              <p>Orbit is a system for inspecting the accounts you already won: see a real site change, connect it to work your agency sells, and decide whether it belongs in the next conversation.</p>
              <p>Potential value is the price range configured in your service catalog—not booked revenue, a forecast, or a guarantee. The value is the review discipline and the commercial context your agency brings to it.</p>
            </div>
          </div>
        </section>

        <section className="marketing-section marketing-section--pilot" aria-labelledby="pilot-title">
          <div className="marketing-container marketing-pilot-card">
            <p className="marketing-section-label">THE NEXT REVIEW</p>
            <h2 id="pilot-title">Give every client account a next review.</h2>
            <p>Start with the sites you already manage. Request access to the Axiom Orbit pilot.</p>
            <div className="marketing-cta-row marketing-cta-row--centered">
              <Link className="marketing-button marketing-button-primary" to="/signup">
                Request access
              </Link>
              <Link className="marketing-button marketing-button-quiet" to="/login">
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}
