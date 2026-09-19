// app/lib/visual-review.server.ts
function visualReviewAvailable(env2) {
  return env2.AI_PROVIDER === "deepseek" && typeof env2.DEEPSEEK_API_KEY === "string" && Boolean(env2.DEEPSEEK_API_KEY.trim()) && Boolean(env2.BROWSER);
}
__name(visualReviewAvailable, "visualReviewAvailable");
function visualServices(catalog) {
  return catalog.filter(
    (s) => s.active && (s.tags.includes("visual-review") || s.tags.some(
      (t) => [
        "landing-page",
        "service-pages-build",
        "conversion-fix",
        "competitor-gap"
      ].includes(t)
    ) || /web(?:site)? design|redesign|conversion|ux|user experience/i.test(
      s.name
    ))
  );
}
__name(visualServices, "visualServices");
async function reviewClientVisually(t, env2, client, catalog, evidence, captureOptions, signal, onAnalysisStart, fetchImpl) {
  const captured = await new CloudflareVisualCapture(
    env2.BROWSER
  ).capture(client, evidence, { ...captureOptions, signal });
  evidence.evidenceAvailability = [
    ...evidence.evidenceAvailability ?? [],
    ...captured.availability
  ].slice(0, 20);
  if (!captured.screenshots.length)
    return {
      status: "unavailable",
      model: "",
      summary: "The website could not be reviewed visually.",
      strengths: [],
      findings: [],
      screenshots: [],
      limitations: captured.limitations,
      accounting: {
        state: "unavailable",
        suggestions: 0,
        accepted: 0,
        rejected: 0,
        truncated: 0,
        capped: false,
        limitations: captured.limitations.slice(0, 100)
      }
    };
  await onAnalysisStart?.();
  const reviewer = new DeepSeekVisualReviewer({
    apiKey: String(env2.DEEPSEEK_API_KEY),
    model: typeof env2.DEEPSEEK_VISION_MODEL === "string" ? env2.DEEPSEEK_VISION_MODEL : void 0,
    baseUrl: typeof env2.DEEPSEEK_BASE_URL === "string" ? env2.DEEPSEEK_BASE_URL : void 0,
    fetchImpl
  });
  const mappedServices = visualServices(catalog);
  const review = await reviewer.review({
    client,
    catalog: mappedServices,
    screenshots: captured.screenshots,
    renderedPages: captured.renderedPages,
    contextPages: evidence.site.pages,
    signal,
    mode: mappedServices.length > 0 ? "legacy" : "shadow"
  });
  signal.throwIfAborted();
  const accepted = captured.screenshots.filter(
    (s) => review.screenshots.some((meta3) => meta3.id === s.id)
  );
  const acceptedScreenshotIds = new Set(accepted.map((s) => s.id));
  evidence.renderedPages = captured.renderedPages.filter(
    (page) => acceptedScreenshotIds.has(page.screenshotId)
  );
  await saveVisualScreenshots(t, client.id, accepted);
  if (evidence.site.coverage) {
    evidence.site.coverage.renderedUrls = new Set(accepted.map((shot) => shot.pageUrl)).size;
    evidence.site.coverage.screenshotsCaptured = accepted.length;
  }
  for (const shot of accepted) {
    const existing = evidence.site.pages.find(
      (p) => crawlKey(p.url) === crawlKey(shot.pageUrl)
    );
    if (!existing || existing.wordCount === 0) {
      evidence.site.pages = evidence.site.pages.filter(
        (p) => crawlKey(p.url) !== crawlKey(shot.pageUrl)
      );
      evidence.site.pages.push(shot.page);
      evidence.site.crawlExhaustive = false;
    }
  }
  const limitations = [...captured.limitations, ...review.limitations].slice(0, 12);
  return {
    ...review,
    status: captured.limitations.length ? "partial" : review.status,
    limitations,
    accounting: review.accounting ? {
      ...review.accounting,
      state: captured.limitations.length > 0 ? "partial" : review.accounting.state,
      limitations: [
        ...captured.limitations,
        ...review.accounting.limitations
      ].slice(0, 100)
    } : review.accounting
  };
}
__name(reviewClientVisually, "reviewClientVisually");
