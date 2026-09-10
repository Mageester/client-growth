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

export const PROPOSAL_CURRENCIES = ["CAD", "USD", "GBP"] as const;
export type ProposalCurrency = (typeof PROPOSAL_CURRENCIES)[number];

export interface ReviewedProposal {
  title: string;
  scope: string[];
  priceMin: number;
  priceMax: number;
  currency: ProposalCurrency;
  nextStep: string;
}

function section(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => new RegExp(`^#{1,3}\\s+${heading}\\s*$`, "i").test(line.trim()),
  );
  if (start < 0) return [];
  const values: string[] = [];
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (/^#{1,3}\s+/.test(line)) break;
    if (line) values.push(line);
  }
  return values;
}

function amount(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseReviewedProposal(markdown: string): ReviewedProposal | null {
  const titleLine = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#\s+/.test(line));
  const title = titleLine?.replace(/^#\s+/, "").replace(/^Proposal:\s*/i, "").trim() ?? "";
  const scope = section(markdown, "Proposed scope")
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
  const investment = section(markdown, "Investment").join(" ");
  const currentPrice = /\b(CAD|USD|GBP)\b\s*\$\s*([\d,]+(?:\.\d{1,2})?)(?:\s*[–-]\s*\$?\s*([\d,]+(?:\.\d{1,2})?))?/i.exec(
    investment,
  );
  // Proposals persisted before the reviewed-field editor did not record a
  // currency and put the range after a service label. They are still durable
  // user content: read those commitments as USD (the only legacy currency)
  // instead of replacing the whole proposal with a newly generated fallback.
  const legacyInvestment = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /\*\*Estimated investment:\*\*/i.test(line));
  const legacyPrice = /\$\s*([\d,]+(?:\.\d{1,2})?)(?:\s*[–-]\s*\$?\s*([\d,]+(?:\.\d{1,2})?))?/i.exec(
    [legacyInvestment, investment].filter(Boolean).join(" "),
  );
  const priceMin = amount(currentPrice?.[2] ?? legacyPrice?.[1]);
  const priceMax = amount(currentPrice?.[3] ?? currentPrice?.[2] ?? legacyPrice?.[2] ?? legacyPrice?.[1]);
  const currency = currentPrice?.[1]
    ? (currentPrice[1].toUpperCase() as ProposalCurrency)
    : legacyPrice
      ? "USD"
      : undefined;
  const nextStep = section(markdown, "Next step").join(" ").trim();
  if (!title || scope.length === 0 || priceMin === null || priceMax === null || !currency || !nextStep) {
    return null;
  }
  return { title, scope, priceMin, priceMax, currency, nextStep };
}

export function formatReviewedProposal(proposal: ReviewedProposal): string {
  return [
    `# ${proposal.title.trim()}`,
    "",
    "## Proposed scope",
    "",
    ...proposal.scope.map((line) => `- ${line.trim()}`).filter((line) => line !== "- "),
    "",
    "## Investment",
    "",
    proposal.priceMin === proposal.priceMax
      ? `${proposal.currency} ${money(proposal.priceMin)}`
      : `${proposal.currency} ${money(proposal.priceMin)}–${money(proposal.priceMax)}`,
    "",
    "## Next step",
    "",
    proposal.nextStep.trim(),
    "",
  ].join("\n");
}

export function proposalWithFallback(
  markdown: string,
  fallback: Omit<ReviewedProposal, "currency"> & { currency?: ProposalCurrency },
): ReviewedProposal {
  return parseReviewedProposal(markdown) ?? { ...fallback, currency: fallback.currency ?? "USD" };
}

function professionalTitle(opportunity: Opportunity): string {
  const missingPage = /^No page for\s+(.+)$/i.exec(opportunity.title.trim());
  if (missingPage?.[1]) {
    return `${missingPage[1][0]!.toUpperCase()}${missingPage[1].slice(1)} service page`;
  }
  if (opportunity.ruleId === "broken-conversion-path") return "Booking journey repair";
  return opportunity.title;
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

  void client;
  void service;
  void evidenceLines;
  void navRefs;
  return formatReviewedProposal({
    title: professionalTitle(opportunity),
    scope,
    priceMin: opportunity.priceMin,
    priceMax: opportunity.priceMax,
    currency: "USD",
    nextStep: "Reply to approve the reviewed scope and price, then we’ll schedule the work.",
  });
}
