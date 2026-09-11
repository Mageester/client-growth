import { Link, redirect } from "react-router";

import { getWorkspaceForUser } from "@/db/workspaces";
import { MarketingLayout } from "../components/marketing-layout";
import { HomepageDemo } from "../components/homepage-demo";
import { Icon } from "../components/ui";
import "../styles/homepage.css";
import { d1Db } from "../lib/d1.server";
import { getSession } from "../lib/session.server";
import type { Route } from "./+types/_index";

/**
 * `/` is the public showcase for a signed-out visitor and a doorway for a
 * signed-in one: an agency that already has an account should land on this
 * week's portfolio changes, not on the copy that sold them the product. The
 * decision stays here rather than in the root loader so one route owns it.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const authed = await getSession(request, context);
  if (!authed) return null;
  const ws = await getWorkspaceForUser(d1Db(context.cloudflare.env.DB as never), authed.userId);
  throw redirect(ws ? "/changes" : "/onboarding");
}

const landingTitle = "Axiom Orbit — Your next project. Already a client.";
const landingDescription =
  "Orbit finds work worth proposing on the client sites your agency already manages. Grounded in website evidence. Matched to the services you sell.";
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

const accountContext = [
  { title: "What your client sells", copy: "Confirmed offerings give every review its context." },
  { title: "What your agency delivers", copy: "Findings map to your services and your own price ranges." },
  { title: "What’s already covered", copy: "Work included in the contract stays out of the opportunity queue." },
];

const workflow = [
  { title: "Start with a client", copy: "Add their site, confirm what they offer, and bring your service catalog." },
  { title: "Review what matters", copy: "Check the sources behind each finding. Accept, dismiss, snooze, or mark it covered." },
  { title: "Prepare the conversation", copy: "Turn a reviewed opportunity into an editable proposal. You decide when to share it." },
];

export default function Index() {
  return (
    <MarketingLayout className="orbit-home">
      <div className="home-container">
        <section className="home-hero" aria-labelledby="landing-title">
          <h1 id="landing-title">Your next project.<br /><span>Already a client.</span></h1>
          <div className="home-hero-copy">
            <p>{landingDescription}</p>
            <div className="home-actions">
              <Link className="home-button" to="/signup">Request pilot access <Icon name="arrow-right" size={16} /></Link>
              <a className="home-text-link" href="#example">See an example <Icon name="arrow-right" size={17} /></a>
            </div>
          </div>
        </section>

        <HomepageDemo />
        <div className="home-demo-caption">
          <span>Built for web &amp; digital agencies.</span>
        </div>

        <section className="home-context home-section" aria-labelledby="context-title">
          <div className="home-section-intro">
            <h2 id="context-title">A website check sees a page.<br /><span>Orbit sees the account.</span></h2>
            <p>A missing page is only an opportunity if the client offers the service, your agency can deliver it, and the work isn’t already covered.</p>
            <Link className="home-text-link" to="/product">Explore the product <Icon name="arrow-right" size={18} /></Link>
          </div>
          <ol className="home-context-list">
            {accountContext.map((item, index) => (
              <li key={item.title}>
                <span className="home-number" aria-hidden="true">0{index + 1}</span>
                <div><h3>{item.title}</h3><p>{item.copy}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section className="home-workflow home-section" aria-labelledby="workflow-title">
          <h2 id="workflow-title">A better reason to get back in touch.</h2>
          <ol className="home-workflow-list">
            {workflow.map((item, index) => (
              <li key={item.title}>
                <span className="home-number" aria-hidden="true">0{index + 1}</span>
                <h3>{item.title}</h3><p>{item.copy}</p>
              </li>
            ))}
          </ol>
          <p className="home-workflow-note"><Icon name="shield" size={17} /> Proposal drafting and sharing stays in your hands. Nothing is sent automatically.</p>
        </section>

        <section className="home-monitor" aria-labelledby="monitor-title">
          <div className="home-monitor-copy">
            <Icon name="refresh" size={21} />
            <div><h2 id="monitor-title">Keep the next review in view.</h2><p>Optional weekly monitoring revisits the clients you choose, when enabled for your workspace.</p></div>
          </div>
          <div className="home-monitor-states">
            <ul aria-label="Monitoring outcomes">
              <li><span className="home-dot home-dot-blue" />New</li>
              <li><span className="home-dot home-dot-amber" />Still open</li>
              <li><span className="home-dot" />Resolved</li>
              <li><span className="home-dot home-dot-muted" />Inconclusive</li>
            </ul>
            <p>An incomplete read stays visible. It never becomes a confident claim.</p>
          </div>
        </section>

        <section className="home-close" aria-labelledby="pilot-title">
          <h2 id="pilot-title">Start with the clients<br /><span>who already trust you.</span></h2>
          <div>
            <p>Bring your portfolio to Orbit. Find the work worth discussing, with the evidence to back it up.</p>
            <Link className="home-button" to="/signup">Request pilot access <Icon name="arrow-right" size={16} /></Link>
            <small>Currently an invitation-only pilot.</small>
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}
