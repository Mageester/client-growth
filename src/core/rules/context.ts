import type { Candidate, Client, EvidenceBundle, EvidencePage, Service } from "@/core/schema";
import type { PageFetcher } from "@/core/absenceVerification";
import type { CoverageAssessment } from "@/core/absenceVerification";
import type { ProbeResult } from "@/ports/EvidenceProvider";
import type { TechnicalRuleId } from "@/core/rules/technical";

export type { PageFetcher, ProbeResult };

export interface RuleContext {
  client: Client;
  catalog: Service[];
  evidence: EvidenceBundle;

  /** Crawl service-coverage assessment (gates missing-service-page only). */
  coverage?: CoverageAssessment;

  /** Optional: pull one specific page during targeted absence verification. */
  fetchPage?: PageFetcher;
  /** Shared fetch budget across all offerings in one analysis run. */
  verifyBudget?: { remaining: number };

  /** Optional: HEAD/GET status check for one URL (broken-conversion-path). */
  probe?: (url: string) => Promise<ProbeResult>;
  /** Shared probe budget for one analysis run. */
  probeBudget?: { remaining: number };

  /**
   * Page evidence carried from dismissed legacy technical rows. Applied only
   * after the individual technical rules observe literal defects, so it never
   * weakens crawling or absence verification for any other rule.
   */
  technicalSuppressedEvidenceRefsByRule?: Partial<
    Record<TechnicalRuleId, readonly string[]>
  >;
}

export type Rule = (ctx: RuleContext) => Promise<Candidate[]>;
export type { EvidencePage };
