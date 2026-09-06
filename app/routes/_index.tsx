import { Link, redirect } from "react-router";
import type { CSSProperties } from "react";

import { getWorkspaceForUser } from "@/db/workspaces";
import { MarketingLayout } from "../components/marketing-layout";
import { OpportunityEvidenceVisual } from "../components/marketing-visuals";
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

const landingTitle = "Axiom Orbit — Grow the clients you’ve already won.";
const landingDescription =
  "Axiom Orbit reviews the client sites your agency already manages, finds work worth a conversation, and keeps the next review in view.";
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

const steps = [
  {
    number: "01",
    title: "Watch",
    copy: "Choose the clients you want monitored. Each week, Orbit checks their sites and records what changed.",
  },
  {
    number: "02",
    title: "Find",
    copy: "Evidence-backed checks cover commercial gaps, conversion failures, and technical content issues — then Orbit shows the source evidence.",
  },
  {
    number: "03",
    title: "Prepare",
    copy: "Review the case, draft the conversation, and deliberately create an expiring share link. Nothing is sent automatically.",
  },
] as const;

export default function Index() {
  return (
    <MarketingLayout>
      <div className="marketing-landing">
        <section className="marketing-hero marketing-container" aria-labelledby="landing-title">
          <div className="marketing-hero-copy">
            <h1 id="landing-title" data-reveal>
              Grow the clients you’ve already won.
            </h1>
            <div className="marketing-hero-deck" data-reveal style={{ "--reveal-delay": "110ms" } as CSSProperties}>
              <p>{landingDescription}</p>
              <p>
                Pipeline Engine finds new clients. Orbit grows the ones you already have.
              </p>
            </div>
            <div className="marketing-cta-row" data-reveal style={{ "--reveal-delay": "220ms" } as CSSProperties}>
              <Link className="marketing-button marketing-button-primary" to="/signup">
                Request pilot access
              </Link>
              <Link className="marketing-button" to="/product">
                Explore the product
              </Link>
            </div>
            <p className="marketing-trust-line" data-reveal style={{ "--reveal-delay": "330ms" } as CSSProperties}>
              <span aria-hidden="true" /> Real evidence. Human review. Optional weekly checks.
            </p>
          </div>
          <div className="marketing-hero-visual" data-reveal style={{ "--reveal-delay": "150ms" } as CSSProperties}>
            <OpportunityEvidenceVisual compact />
          </div>
        </section>

        <section className="marketing-section marketing-section--problem" aria-labelledby="portfolio-problem-title">
          <div className="marketing-container marketing-two-column" data-reveal>
            <div>
              <p className="marketing-section-label">THE PORTFOLIO PROBLEM</p>
              <h2 id="portfolio-problem-title">The work is already in your accounts.</h2>
            </div>
            <div className="marketing-section-copy">
              <p>
                A client site changes between reviews. A quote path breaks. A service they sell has no page. Across a portfolio, those gaps are easy to miss.
              </p>
              <p className="marketing-bridge-line">Orbit turns each review into a short list your team can act on.</p>
            </div>
          </div>
        </section>

        <section className="marketing-section marketing-section--steps" aria-labelledby="steps-title">
          <div className="marketing-container">
            <div className="marketing-section-heading" data-reveal>
              <p className="marketing-section-label">HOW IT WORKS</p>
              <h2 id="steps-title">Watch, find, prepare.</h2>
              <p>Three steps. Your judgment stays in charge.</p>
            </div>
            <div className="marketing-steps" data-reveal>
              <div className="marketing-steps-line" aria-hidden="true">
                <span className="marketing-steps-line-fill" />
              </div>
              <ol className="marketing-steps-list">
                {steps.map((step, index) => (
                  <li className="marketing-steps-item" key={step.title}>
                    <span className="marketing-steps-number" style={{ "--step-index": index } as CSSProperties}>
                      {step.number}
                    </span>
                    <h3>{step.title}</h3>
                    <p>{step.copy}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="marketing-section marketing-section--honest" aria-labelledby="honest-title">
          <div className="marketing-container marketing-two-column" data-reveal>
            <div>
              <p className="marketing-section-label">STRAIGHT ANSWERS</p>
              <h2 id="honest-title">Straight answers. No invented wins.</h2>
            </div>
            <div className="marketing-section-copy">
              <p>
                If Orbit can’t read a site clearly, it says <strong>Inconclusive</strong> — it never turns missing evidence into a confident opportunity.
              </p>
              <div className="marketing-availability" aria-label="Current and future capabilities">
                <div>
                  <span className="marketing-availability-label">Available now</span>
                  <p>
                    Orbit runs evidence-backed checks across commercial gaps, conversion failures, technical content issues,
                    evidence review, proposal drafting and sharing, and opt-in weekly monitoring.
                  </p>
                </div>
                <div>
                  <span className="marketing-availability-label marketing-availability-label--direction">Direction</span>
                  <p>Outcome and revenue tracking are direction — not current results.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="marketing-section marketing-section--economic" aria-labelledby="economic-title">
          <div className="marketing-container marketing-two-column" data-reveal>
            <div>
              <p className="marketing-section-label">FOR YOUR AGENCY</p>
              <h2 id="economic-title">Build more value from the relationships already on your books.</h2>
            </div>
            <div className="marketing-section-copy">
              <p>
                Orbit keeps the review of existing clients visible: real site changes, work your agency sells, and a decision about the next conversation.
              </p>
              <p>
                Potential value comes from your own price list — not booked revenue, a forecast, or a guarantee.
              </p>
            </div>
          </div>
        </section>

        <section className="marketing-section marketing-section--pilot" aria-labelledby="pilot-title">
          <div className="marketing-container marketing-pilot-card" data-reveal>
            <p className="marketing-section-label">THE NEXT REVIEW</p>
            <h2 id="pilot-title">Give every client account a next review.</h2>
            <p>Start with the sites you already manage. Request pilot access to Axiom Orbit.</p>
            <div className="marketing-cta-row marketing-cta-row--centered">
              <Link className="marketing-button marketing-button-primary" to="/signup">
                Request pilot access
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
