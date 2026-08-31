import type { Client, Opportunity, Service } from "@/core/schema";

export interface ProposalInputs {
  opportunity: Opportunity;
  client: Client;
  service: Service;
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

/**
 * A first-draft proposal in Markdown, built entirely from the evidence and the
 * opportunity. Intended to be edited by the agency before it goes anywhere —
 * nothing here is sent or published.
 */
export function generateProposalDraft({ opportunity, client, service }: ProposalInputs): string {
  const scope = opportunity.suggestedScope.length
    ? opportunity.suggestedScope
    : [`Design and build a dedicated page for ${opportunity.title}.`];

  const evidenceLines = opportunity.evidenceRefs
    .filter((ref) => !ref.startsWith("nav:"))
    .slice(0, 12)
    .map((ref) => `- ${ref}`);
  const navRefs = opportunity.evidenceRefs
    .filter((ref) => ref.startsWith("nav:"))
    .map((ref) => ref.slice(4));

  return [
    `# Proposal: ${opportunity.title}`,
    ``,
    `**Prepared for:** ${client.name} (${client.domain})`,
    `**Suggested service:** ${service.name}`,
    `**Estimated investment:** ${money(opportunity.priceMin)}–${money(opportunity.priceMax)}`,
    ``,
    `## What we found`,
    ``,
    opportunity.detected,
    ``,
    `## Why it matters`,
    ``,
    opportunity.rationale,
    ``,
    `## Proposed scope`,
    ``,
    ...scope.map((line) => `- ${line}`),
    ``,
    `## Evidence reviewed`,
    ``,
    ...(evidenceLines.length ? evidenceLines : ["- (no page URLs recorded)"]),
    navRefs.length ? `` : null,
    navRefs.length ? `Navigation checked: ${navRefs.join(", ")}` : null,
    ``,
    `## Investment`,
    ``,
    `${service.name}: ${money(opportunity.priceMin)}–${money(opportunity.priceMax)}.`,
    service.description ? `` : null,
    service.description ? `_${service.description}_` : null,
    ``,
    `## Next step`,
    ``,
    `Reply to approve and we'll schedule the work. This draft is editable before sending.`,
    ``,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
