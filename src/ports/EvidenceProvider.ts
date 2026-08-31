import type { Client, EvidenceBundle, EvidencePage } from "@/core/schema";

/**
 * Replaceable boundary #1. Anything that can produce website evidence for a
 * client: local fixtures now, a real crawl now (minimal), a richer scanner or
 * an external evidence source (e.g. Axiom) later.
 *
 * `fetchPage` is optional: providers that can cheaply pull one more page expose
 * it so the missing-service-page rule can confirm a suspected existing page
 * during absence verification. Fixture providers omit it.
 */
export interface EvidenceProvider {
  getEvidence(client: Client): Promise<EvidenceBundle>;
  fetchPage?(url: string): Promise<EvidencePage | null>;
}
