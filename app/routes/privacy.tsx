import { Link } from "react-router";

import { LegalPage } from "../components/legal-page";

/**
 * Every factual claim here is traceable to code:
 *  - what is stored: src/db/schema.ts
 *  - what leaves for the evaluator: src/adapters/evaluator/prompt.ts
 *  - what the crawler requests: src/adapters/evidence/HttpEvidenceProvider.ts
 *  - what an export contains: app/routes/export.workspace.tsx
 * Correct this page when those change. It has not had legal review.
 */
const title = "Privacy — Axiom Orbit";
const canonical = "https://orbit.getaxiom.ca/privacy";

export function meta() {
  return [
    { title },
    {
      name: "description",
      content: "What Axiom Orbit stores, what leaves the service, and who processes it.",
    },
    { tagName: "link", rel: "canonical", href: canonical },
  ];
}

export default function Privacy() {
  return (
    <LegalPage title="Privacy" updated="6 September 2026">
      <p>
        Axiom Orbit is used by digital agencies to review the websites of clients they
        already work with. This page says what the service stores, what leaves it, and who
        else processes it. It describes the software as built, not an intention.
      </p>

      <h2>What we store about you</h2>
      <ul>
        <li>
          <strong>Your account.</strong> Email address, name, a hashed password, and session
          records. Passwords are never stored in a readable form.
        </li>
        <li>
          <strong>Your workspace.</strong> Its name, and optionally an agency name and logo
          you save for use on proposals.
        </li>
        <li>
          <strong>Your client records.</strong> For each client you add: name, website
          domain, the offerings you record, your own notes, and optionally a typical job
          value. This is information you enter, about businesses you already work with.
        </li>
        <li>
          <strong>Analysis results.</strong> The findings produced for each client, the
          evidence they rest on, your decisions about them, and the outcome you record.
        </li>
      </ul>

      <h2>What we read from client websites</h2>
      <p>
        When you run an analysis, the service makes ordinary HTTP requests to the public
        pages of the website you named — the same requests any browser or search engine
        makes. It identifies itself as <code>AxiomOrbitBot</code> with a contact address,
        reads and obeys that site&rsquo;s <code>robots.txt</code>, and requests at most a
        few dozen pages per analysis. It does not sign in, submit forms, execute
        JavaScript, or attempt to reach anything not publicly served.
      </p>
      <p>
        It stores the parts of those pages the analysis needs: titles, headings, link
        targets and anchor text, meta descriptions, structured-data types, image alt
        attributes, form shapes, and word counts. A page we were asked not to read is
        recorded as unread, never as empty.
      </p>

      <h2>Who else processes this data</h2>
      <ul>
        <li>
          <strong>Cloudflare</strong> hosts the service and stores its database. All data
          described above lives there.
        </li>
        <li>
          <strong>Resend</strong> delivers email. It receives the recipient address and the
          message.
        </li>
        <li>
          <strong>DeepSeek</strong> is the AI provider. Two separate features send it data,
          and they send different things; the inventory below says exactly what each one
          sends.
        </li>
      </ul>

      <h2>What leaves the service, feature by feature</h2>
      <p>
        This list is per feature on purpose. An earlier version of this page described one
        feature&rsquo;s narrow transfer as though it covered the provider, which was not
        true of the catalog assistant &mdash; and that feature sends data about your agency,
        not about a client.
      </p>
      <ul>
        <li>
          <strong>Candidate evaluation</strong> (DeepSeek). When an analysis judges whether
          a candidate finding is genuinely sellable work, it sends the client&rsquo;s
          business name, their website domain, the single subject being judged &mdash; for
          example the words &ldquo;heat pump installation&rdquo; &mdash; and the bounded
          supporting evidence needed to judge it. It does not send your notes, your catalog,
          or your prices.
        </li>
        <li>
          <strong>AI catalog assistant</strong> (DeepSeek). When you ask it to draft your
          service catalog, it sends the summary you write and, if you give it your agency
          website, the URL, page title, headings and short text excerpts of the public pages
          it read there. This is information about your agency. Nothing it proposes is
          saved until you review the names, descriptions and prices.
        </li>
        <li>
          <strong>Account email</strong> (Resend). Verification links, password resets and
          team invitations: the recipient address and the account or recovery content of the
          message.
        </li>
        <li>
          <strong>Monitoring digest</strong> (Resend). Where monitoring is enabled and email
          delivery is configured: the recipient address you set, and a summary of what
          changed across the clients in your portfolio.
        </li>
      </ul>
      <p>
        What a provider does with what it receives is governed by that provider&rsquo;s own
        terms, which we cannot observe from here and therefore do not restate as a promise.
      </p>

      <h2>What we do not do</h2>
      <p>
        We do not sell data, share it with advertisers, or use it to train models. We do
        not use tracking or advertising cookies; the only cookie the service sets is the
        one that keeps you signed in. Workspaces are isolated from one another at the
        database level — no workspace can read another&rsquo;s data.
      </p>

      <h2>Getting your data out, and deleting it</h2>
      <p>
        You can export everything in your workspace at any time from Settings. The export
        excludes authentication records and secret values. Deleting a client removes that
        client and everything derived from them. To close an account and delete a
        workspace entirely, email us and we will do it.
      </p>

      <h2>Retention</h2>
      <p>
        Your data is kept while your account is open. Evidence and analysis history are
        retained so the service can tell what changed on a client&rsquo;s site over time —
        which is the point of monitoring — and are removed when you delete the client or
        the workspace.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this page, or a request about your data, go to{" "}
        <a href="mailto:privacy@getaxiom.ca">privacy@getaxiom.ca</a>. See also our{" "}
        <Link to="/terms">terms of service</Link>.
      </p>
    </LegalPage>
  );
}
