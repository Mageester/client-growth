import { definitionForProblemType, MODEL_ANCHORED_PROBLEM_TYPES } from "@/core/insightTaxonomy";
import { DiagnosticDraftSchema, type DiagnosticDraft, type EvidenceRef } from "@/core/insightSchema";
import type { ProblemDraft } from "@/core/siteUnderstandingSchema";

export const SEMANTIC_DETECTOR_ID = "site-understanding";
export const SEMANTIC_DRAFT_CONFIDENCE = 0.8;

function pageKeyFor(draft: ProblemDraft, byId: Map<string, EvidenceRef>): string {
  const cited = draft.evidenceIds.map((id) => byId.get(id)).filter((entry): entry is EvidenceRef => entry !== undefined);
  const page = cited.find((entry) => entry.kind === "page")?.locator ?? cited.find((entry) => entry.pageUrl !== undefined)?.pageUrl;
  return page ?? draft.canonicalSurface;
}

export function semanticDiagnosticDrafts(drafts: readonly ProblemDraft[], ledger: readonly EvidenceRef[]): DiagnosticDraft[] {
  const byId = new Map(ledger.map((entry) => [entry.id, entry]));
  const built: DiagnosticDraft[] = [];
  for (const draft of drafts) {
    if (draft.diagnosticIds.length > 0 || !MODEL_ANCHORED_PROBLEM_TYPES.has(draft.problemType)) continue;
    const evidenceIds = draft.evidenceIds.filter((id) => byId.has(id));
    if (evidenceIds.length === 0) continue;
    built.push(DiagnosticDraftSchema.parse({
      detectorId: SEMANTIC_DETECTOR_ID,
      detectorVersion: "1",
      category: definitionForProblemType(draft.problemType).category,
      problemType: draft.problemType,
      subject: { kind: "page", key: pageKeyFor(draft, byId) },
      observation: draft.statement,
      legacyEvidenceRefs: evidenceIds,
      rawConfidence: SEMANTIC_DRAFT_CONFIDENCE,
      state: "observed",
      origin: "SOURCE_HTTP",
      details: {
        kind: "semantic",
        source: "site-understanding",
        reason: `A bounded site-understanding pass read the cited ${evidenceIds.length} evidence row(s) and reported this condition.`,
      },
    }));
  }
  return built;
}

export function isSemanticDiagnostic(diagnostic: { detectorId: string }): boolean {
  return diagnostic.detectorId === SEMANTIC_DETECTOR_ID;
}
