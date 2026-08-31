import type { Client, EvidenceBundle, EvidencePage } from "@/core/schema";

/** Result of a single-URL status check (see EvidenceProvider.probe). */
export interface ProbeResult {
  requestedUrl: string;
  /** HTTP status after following redirects. 0 means the request could not be
   *  completed (DNS/TLS/timeout) and must be treated as inconclusive. */
  status: number;
  finalUrl: string;
  ok: boolean;
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
  fetchPage?(url: string): Promise<EvidencePage | null>;
  probe?(url: string): Promise<ProbeResult>;
}
