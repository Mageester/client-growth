// src/adapters/evidence/FixtureEvidenceProvider.ts
var FixtureEvidenceProvider = class {
  static {
    __name(this, "FixtureEvidenceProvider");
  }
  bundles;
  constructor(bundles) {
    const parsed = bundles.map((b) => EvidenceBundleSchema.parse(b));
    this.bundles = new Map(parsed.map((b) => [b.clientId, b]));
  }
  getEvidence(client) {
    const bundle = this.bundles.get(client.id);
    if (!bundle) {
      return Promise.reject(
        new Error(`FixtureEvidenceProvider: no fixture evidence for client "${client.id}"`)
      );
    }
    return Promise.resolve(bundle);
  }
};
