import { Link } from "react-router";

import { LegalPage } from "../components/legal-page";

/**
 * As with the privacy page: this describes the software as built. It has not
 * had legal review — see docs/legal-review.md.
 */
const title = "Terms of service — Axiom Orbit";
const canonical = "https://orbit.getaxiom.ca/terms";

export function meta() {
  return [
    { title },
    {
      name: "description",
      content: "The terms on which Axiom Orbit is provided.",
    },
    { tagName: "link", rel: "canonical", href: canonical },
  ];
}

export default function Terms() {
  return (
    <LegalPage title="Terms of service" updated="6 September 2026">
      <p>
        These terms cover your use of Axiom Orbit. By creating a workspace you agree to
        them.
      </p>

      <h2>What the service does</h2>
      <p>
        Axiom Orbit reviews the public websites of clients you record, compares what it
        reads against the offerings you record, and surfaces work you could offer them. It
        produces evidence and a suggestion. It does not contact your clients, publish
        anything, or make changes to any website. Every action that reaches a client is
        one you take yourself.
      </p>

      <h2>Your responsibility for the sites you analyze</h2>
      <p>
        You are responsible for the websites you add. By adding one you confirm you have a
        legitimate relationship with that business and a reasonable basis for reviewing
        their site on their behalf. The service reads only publicly served pages and obeys{" "}
        <code>robots.txt</code>, but that is a technical courtesy, not a substitute for
        your relationship with the client.
      </p>

      <h2>What the findings are, and are not</h2>
      <p>
        Findings are evidence-backed suggestions, not professional advice and not
        guarantees. The service is deliberately built to say &ldquo;we could not read this
        site&rdquo; rather than to guess, but it can still be wrong, and prices shown are
        the ones you configured in your own catalog. You are responsible for what you put
        in front of a client. Review a finding before you sell it.
      </p>

      <h2>Availability</h2>
      <p>
        The service is provided as it is, without a guaranteed level of availability. It is
        early software: features change, and analysis is subject to daily limits that
        protect both your costs and ours.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Do not use the service to review sites you have no relationship with.</li>
        <li>
          Do not attempt to circumvent its rate limits, analysis limits, or workspace
          isolation.
        </li>
        <li>Do not resell access to a workspace, or share credentials outside your team.</li>
      </ul>

      <h2>Your data</h2>
      <p>
        Your workspace data is yours. You can export it at any time, and delete it. What we
        store and who processes it is set out in the <Link to="/privacy">privacy page</Link>.
      </p>

      <h2>Ending it</h2>
      <p>
        You can stop using the service and ask us to delete your workspace at any time. We
        may suspend an account that breaches these terms, and will say why.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, we are not liable for business losses arising from
        your use of the service — including lost revenue, lost clients, or decisions taken
        on the basis of a finding. Nothing here limits liability that cannot lawfully be
        limited.
      </p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:hello@getaxiom.ca">hello@getaxiom.ca</a>.
      </p>
    </LegalPage>
  );
}
