import type { Client, EvidenceBundle } from "@/core/schema";

/**
 * Replaceable boundary #1. Anything that can produce website evidence for a
 * client: local fixtures now, a real crawl now (minimal), a richer scanner or
 * an external evidence source (e.g. Axiom) later.
 */
export interface EvidenceProvider {
  getEvidence(client: Client): Promise<EvidenceBundle>;
}
