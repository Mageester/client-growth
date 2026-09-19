// src/core/rules/missingServicePage.ts
function count2(n, singular, plural3 = singular + "s") {
  return `${n} ${n === 1 ? singular : plural3}`;
}
__name(count2, "count");
async function detectMissingServicePageDiagnostic(ctx) {
  const { client, evidence } = ctx;
  if (ctx.coverage && !ctx.coverage.analyzable) {
    return [
      legacyDiagnosticDraft({
        detectorId: "missing-service-page",
        problemType: "missing_service_path",
        subject: { kind: "site", key: client.domain },
        observation: `Service coverage is incomplete (${ctx.coverage.reason || "reason not recorded"}); a missing service page cannot be established.`,
        legacyEvidenceRefs: evidence.site.pages.map((page) => page.url),
        rawConfidence: 0,
        state: "unknown"
      })
    ];
  }
  const pageCount = evidence.site.pages.length;
  const diagnostics = [];
  for (const offering of client.offerings) {
    if (significantTokens(offering).length === 0) continue;
    const verification = await verifyOfferingAbsence({
      offering,
      allOfferings: client.offerings,
      evidence,
      fetchPage: ctx.fetchPage,
      budget: ctx.verifyBudget
    });
    if (verification.conclusion === "present") continue;
    const siteObserved = offeringIsSiteObserved({
      offering,
      offerings: client.offerings,
      evidence
    });
    const inspectedNote = verification.inspectedUrls.length > 0 ? ` Verification fetched ${count2(verification.inspectedUrls.length, "candidate page")}; none covered it.` : "";
    const consideredNote = verification.closeMatches.length > 0 ? ` Nearest matches considered: ${verification.closeMatches.map((m) => `"${m.value}"`).slice(0, 4).join(", ")}.` : "";
    const coverageFactor = Math.min(1, pageCount / 8);
    const rawConfidence = Math.min(
      0.8,
      0.45 + coverageFactor * 0.2 + (verification.closeMatches.length === 0 ? 0.1 : 0)
    );
    const observed = verification.conclusion === "absent";
    const detected = observed ? `The client offers "${offering}" but targeted verification found no dedicated page for it. Checked ${count2(pageCount, "crawled page")}, ${count2(evidence.site.nav.length, "navigation label")}, ${count2(evidence.site.links.length, "discovered link")}` + (evidence.site.sitemapUrls.length > 0 ? `, and ${count2(evidence.site.sitemapUrls.length, "sitemap URL")}` : "") + `.${inspectedNote}${consideredNote}` + (siteObserved ? "" : " The site's own pages, navigation, links and sitemap do not mention this offering anywhere, so this is a client-record gap rather than an observed website defect.") : `Targeted verification could not establish whether the client offers "${offering}" a dedicated page. ${verification.reason}`;
    diagnostics.push(
      legacyDiagnosticDraft({
        detectorId: "missing-service-page",
        problemType: "missing_service_path",
        subject: { kind: "page", key: offering },
        observation: detected,
        legacyEvidenceRefs: [
          ...evidence.site.pages.map((p) => p.url),
          ...verification.inspectedUrls.map((u) => `verified:${u}`),
          ...verification.closeMatches.filter((m) => m.url).map((m) => `considered:${m.url}`)
        ],
        rawConfidence: observed ? rawConfidence : 0,
        state: observed ? "observed" : "unknown",
        details: {
          kind: "verification",
          verification,
          offeringProvenance: siteObserved ? "SITE_OBSERVED" : "CLIENT_PROFILE"
        }
      })
    );
  }
  return diagnostics;
}
__name(detectMissingServicePageDiagnostic, "detectMissingServicePageDiagnostic");
