/** Diagnostic: show 1-vote tallies for fully-readable sets (min=1, not product behavior). */
import { findCompetitorGaps } from "@/core/competitorGaps";
import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { ClientSchema, type EvidenceBundle } from "@/core/schema";
import { createCachingFetch } from "../analyzability/cache";

const SETS: Record<string, { domain: string; offerings: string[]; competitors: string[] }> = {
  cambridgeheating: { domain: "cambridgeheating.ca", offerings: ["Furnace repair", "Air conditioning installation", "Water heater replacement", "Duct cleaning"], competitors: ["www.reliancehomecomfort.com", "www.enercare.ca"] },
  bellbrothers: { domain: "www.bellbrothers.com", offerings: ["air conditioning repair", "furnace replacement", "heat pump installation", "water heater installation", "sewer line replacement", "duct sealing"], competitors: ["www.bonney.com", "www.foxandsons.com"] },
  russelllandscape: { domain: "www.russelllandscape.com", offerings: ["commercial landscape maintenance", "landscape installation", "irrigation management", "erosion control", "seasonal color", "athletic field maintenance"], competitors: ["www.brightview.com", "www.ruppertlandscape.com"] },
  interstateroofing: { domain: "www.interstateroofing.com", offerings: ["roof replacement", "storm damage repair", "hail damage restoration", "gutter replacement", "siding installation", "commercial roofing"], competitors: ["www.longhome.com", "www.eriehome.com"] },
  activegreenross: { domain: "www.activegreenross.com", offerings: ["tire replacement", "oil changes", "brake service", "wheel alignment", "battery replacement", "exhaust repair"], competitors: ["www.tirecraft.com", "www.kaltire.com"] },
};

async function main() {
  const { fetchImpl } = createCachingFetch({ dir: ".analyzability-cache", allowNetwork: false, maxLiveRequests: 0 });
  const provider = new HttpEvidenceProvider({ fetchImpl });
  const mk = (domain: string) => ClientSchema.parse({ id: "probe", name: domain, domain, offerings: [], notes: "" });

  for (const [name, set] of Object.entries(SETS)) {
    const clientEvidence = await provider.getEvidence(mk(set.domain)).catch(() => null);
    const competitors = [];
    for (const d of set.competitors) {
      const ev = await provider.getEvidence(mk(d)).catch(() => null);
      const readable = ev && ev.site.pages.filter((p) => p.status === 200 && p.wordCount > 0).length >= 2 ? ev : null;
      competitors.push({ domain: d, evidence: readable });
    }
    const relaxed = findCompetitorGaps({ clientOfferings: [...set.offerings], clientEvidence, competitors, minCompetitors: 1, max: 40 });
    console.log(`\n== ${name}: ${relaxed.gaps.length} relaxed tallies (product requires 2 votes)`);
    for (const g of relaxed.gaps.slice(0, 12)) console.log(`   ${g.competitorDomains.length}v [${g.label}] <- ${g.competitorDomains.join(", ")}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
