import type { EvidenceProvider } from "@/ports/EvidenceProvider";
import {
  EvidenceBundleSchema,
  type Client,
  type EvidenceBundle,
} from "@/core/schema";

/**
 * Evidence from saved fixtures. Zero cost, zero network. This is the default in
 * development and the only provider used by the default test suite.
 */
export class FixtureEvidenceProvider implements EvidenceProvider {
  private readonly bundles: Map<string, EvidenceBundle>;

  constructor(bundles: Array<EvidenceBundle | unknown>) {
    const parsed = bundles.map((b) => EvidenceBundleSchema.parse(b));
    this.bundles = new Map(parsed.map((b) => [b.clientId, b]));
  }

  getEvidence(client: Client): Promise<EvidenceBundle> {
    const bundle = this.bundles.get(client.id);
    if (!bundle) {
      return Promise.reject(
        new Error(`FixtureEvidenceProvider: no fixture evidence for client "${client.id}"`),
      );
    }
    return Promise.resolve(bundle);
  }
}
