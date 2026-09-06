import type { Client, Opportunity, Service } from "@/core/schema";
import { describeEvidenceRef, isDefectRef, parseEvidenceRef } from "@/core/evidenceRef";
import { rationaleForOpportunity } from "@/core/rules/deterministicEvaluation";

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

  // This section goes in front of the client, so every line has to read as a
  // fact rather than as the internal tag it is stored as. The defect's own
  // facts (element, target, HTTP status) are listed after the pages, because
  // they are the point of the finding rather than more provenance.
  const parsed = opportunity.evidenceRefs.map(parseEvidenceRef);
  const elementHref = parsed.find((ref) => ref.kind === "element")?.value;
  const seen = new Set<string>();
  const pageLines: string[] = [];
  const defectLines: string[] = [];
  for (const ref of parsed) {
    if (ref.kind === "nav") continue;
    // A CTA's element and its resolved target are usually the same address;
    // listing it twice under two labels reads like the draft was not checked.
    if (ref.kind === "target" && ref.value === elementHref) continue;
    const line = describeEvidenceRef(ref);
    if (seen.has(line)) continue;
    seen.add(line);
    (isDefectRef(ref) ? defectLines : pageLines).push(`- ${line}`);
  }
  const evidenceLines = [...pageLines.slice(0, 12), ...defectLines];
  const navRefs = parsed.filter((ref) => ref.kind === "nav").map((ref) => ref.value);

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
    rationaleForOpportunity(opportunity),
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
