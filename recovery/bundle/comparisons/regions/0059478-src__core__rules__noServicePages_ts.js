// src/core/rules/noServicePages.ts
var MIN_PAGES_FOR_CLAIM = 3;
function count3(n, singular, plural3 = singular + "s") {
  return `${n} ${n === 1 ? singular : plural3}`;
}
__name(count3, "count");
async function detectNoServicePagesDiagnostic(ctx) {
  const { client, evidence, coverage } = ctx;
  if (!coverage || coverage.analyzable) return [];
  const readablePages = evidence.site.pages.filter(
    (page) => page.status >= 200 && page.status < 300 && page.wordCount > 0
  ).length;
  const corroborated = readablePages >= MIN_PAGES_FOR_CLAIM || evidence.site.sitemapUrls.length > 0;
  if (coverage.limitation !== "site-too-thin" || readablePages === 0 || !corroborated) {
    return [
      legacyDiagnosticDraft({
        detectorId: "no-service-pages",
        problemType: "no_service_section",
        subject: { kind: "site", key: client.domain },
        observation: `The site's service section is unassessed (${coverage.reason || "reason not recorded"}); the crawl did not provide enough readable, independent evidence to claim no service pages.`,
        legacyEvidenceRefs: evidence.site.pages.map((page) => page.url),
        rawConfidence: 0,
        state: "unknown"
      })
    ];
  }
  if (client.offerings.length === 0) return [];
  const offerings = client.offerings;
  const named = offerings.length <= 3 ? offerings.join(", ") : `${offerings.slice(0, 3).join(", ")} and ${offerings.length - 3} more`;
  return [
    legacyDiagnosticDraft({
      detectorId: "no-service-pages",
      problemType: "no_service_section",
      subject: { kind: "site", key: client.domain },
      observation: `The crawl followed every link on ${client.domain} and read ${count3(readablePages, "page")}, and not one of them is dedicated to a single service this business sells. Nothing was blocked and nothing was left unread, so this is the whole site. The client is recorded as offering ${named}, so a visitor searching for any one of those has no page to land on.`,
      legacyEvidenceRefs: evidence.site.pages.map((page) => page.url),
      rawConfidence: 0.9,
      state: "observed"
    })
  ];
}
__name(detectNoServicePagesDiagnostic, "detectNoServicePagesDiagnostic");
