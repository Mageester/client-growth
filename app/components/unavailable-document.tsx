import { Link } from "react-router";

import { BrandLockup } from "./ui";

export type SharedDocumentKind = "proposal" | "report";

type SharedDocumentCopy = {
  title: string;
  heading: string;
  recovery: string;
  boundary: string;
};

/**
 * Written out per kind rather than interpolated from a noun: a recipient in
 * trouble should read a sentence somebody wrote, and `{noun}s` leaves React's
 * text-node markers mid-word in the delivered HTML.
 */
const DOCUMENTS = {
  proposal: {
    title: "Proposal unavailable · Axiom Orbit",
    heading: "This proposal link is no longer available",
    recovery:
      "The link may have expired, or the agency that sent it may have withdrawn it. Ask the agency that shared this proposal with you for a new link.",
    boundary:
      "Axiom Orbit delivers agency proposals through private links that expire. Without a valid link we cannot show the proposal, and we cannot tell you who sent it.",
  },
  report: {
    title: "Report unavailable · Axiom Orbit",
    heading: "This report link is no longer available",
    recovery:
      "The link may have expired, or the agency that sent it may have withdrawn it. Ask the agency that shared this report with you for a new link.",
    boundary:
      "Axiom Orbit delivers agency reports through private links that expire. Without a valid link we cannot show the report, and we cannot tell you who sent it.",
  },
} as const satisfies Record<SharedDocumentKind, SharedDocumentCopy>;

export function unavailableDocumentTitle(kind: SharedDocumentKind): string {
  return DOCUMENTS[kind].title;
}

/**
 * The state a client sees when an agency's share link has expired.
 *
 * This is the only Axiom Orbit page whose reader is not a customer, which makes
 * anonymity the expensive failure: an untitled, unbranded, headingless 404 makes
 * a legitimate proposal look like a dead or hostile link, and the recipient's
 * reasonable response is to distrust the agency that sent it. So the product
 * identifies itself and says what to do next.
 *
 * What it must never do is describe the link. Whether the token was absent,
 * malformed, expired, or revoked, the page is identical, so it cannot be used
 * to probe which tokens exist. For the same reason the agency and the client
 * are not named: with no valid token there is nothing to look them up from, and
 * guessing would be worse than saying so.
 */
export function UnavailableDocument({ kind }: { kind: SharedDocumentKind }) {
  const document = DOCUMENTS[kind];

  return (
    <main className="document-unavailable">
      <BrandLockup className="document-unavailable-lockup" />
      <h1>{document.heading}</h1>
      <p className="document-unavailable-lead">{document.recovery}</p>
      <p className="document-unavailable-note">{document.boundary}</p>
      <Link className="document-unavailable-action" to="/">
        What is Axiom Orbit?
      </Link>
    </main>
  );
}
