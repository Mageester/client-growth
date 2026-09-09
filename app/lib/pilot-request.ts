const PILOT_BODY = [
  "Agency name:",
  "Client sites managed:",
  "Current client-review process:",
  "What you want the review to help with:",
].join("\n");

export function pilotRequestHref(): string {
  const query = new URLSearchParams({
    subject: "Axiom Orbit agency pilot request",
    body: PILOT_BODY,
  });
  return `mailto:hello@getaxiom.ca?${query.toString()}`;
}
