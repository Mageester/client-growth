import type { Client, EvidenceBundle, EvidencePage } from "@/core/schema";

/** A page fetch failed for a network-policy or transport reason. */
export interface PageFetchFailure {
  kind: "network-failure";
  requestedUrl: string;
  outcome: "blocked" | "inconclusive";
  reason: string;
}

export type PageFetchResult = EvidencePage | PageFetchFailure | null;

/** Result of a single-URL status check (see EvidenceProvider.probe). */
export interface ProbeResult {
  requestedUrl: string;
  /** HTTP status after validated redirects. 0 means no trustworthy status was
   * obtained and must be treated as inconclusive. */
  status: number;
  finalUrl: string;
  ok: boolean;
  /** Explicit network outcome for policy failures; absent for older providers. */
  outcome?: "complete" | "blocked" | "inconclusive";
  /** Safe diagnostic reason for a blocked/inconclusive result. */
  reason?: string;
  /** Number of validated redirect hops followed for this probe. */
  redirects?: number;
}

/**
 * Replaceable boundary #1. Anything that can produce website evidence for a
 * client: local fixtures now, a real crawl now (minimal), a richer scanner or
 * an external evidence source (e.g. Axiom) later.
 *
 * `fetchPage` and `probe` are optional: providers that can cheaply reach one
 * more URL expose them so the rules can confirm a suspected page (absence
 * verification) or a suspected broken conversion target. Fixture providers omit
 * them; tests inject stubs.
 */
export interface EvidenceProvider {
  getEvidence(client: Client): Promise<EvidenceBundle>;
  fetchPage?(url: string): Promise<PageFetchResult>;
  probe?(url: string): Promise<ProbeResult>;
}
