/**
 * The one action a visitor who is not yet invited can take.
 *
 * The audit followed the advertised path — home, "Request pilot access",
 * signup — and found a page whose only control was "Already invited? Log in".
 * Everyone that CTA is aimed at is, by definition, not invited. There was no
 * bell on the door.
 *
 * This is a mailto rather than a form on purpose. A public write endpoint means
 * a lead table, a spam surface, a rate limiter and a moderation habit, all to
 * replace an email a person reads by hand either way. Invitation-only admission
 * is unchanged: this asks for an invitation, it does not grant one.
 *
 * The body is a set of prompts, not a questionnaire — enough that a reply can
 * be useful on the first exchange, few enough that nobody abandons it.
 */
const PILOT_ADDRESS = "hello@getaxiom.ca";

export const PILOT_REQUEST_SUBJECT = "Axiom Orbit agency pilot request";

const PILOT_BODY = [
  "Agency name:",
  "Client sites managed:",
  "Current client-review process:",
  "What you want the review to help with:",
].join("\n");

/** What the pilot actually is, stated the same way everywhere it is offered. */
export const PILOT_OFFER = {
  scope: "14-day assisted review",
  limit: "up to ten client sites",
  responseTime: "within two business days",
} as const;

export function pilotRequestHref(): string {
  // URLSearchParams encodes once, correctly, including the newlines in the
  // body — hand-built mailto links are where those get double-escaped.
  const query = new URLSearchParams({
    subject: PILOT_REQUEST_SUBJECT,
    body: PILOT_BODY,
  });
  return `mailto:${PILOT_ADDRESS}?${query.toString()}`;
}
