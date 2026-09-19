// src/adapters/evidence/CloudflareVisualCapture.ts
var ASSET_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "static.wixstatic.com",
  "images.squarespace-cdn.com",
  "cdn.prod.website-files.com",
  "assets-global.website-files.com"
];
var escapeRegex = /* @__PURE__ */ __name((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "escapeRegex");
async function awaitWithAbort(operation, signal) {
  if (!signal) return operation;
  if (signal.aborted) throw signal.reason ?? new Error("Operation aborted");
  let onAbort;
  const abort = new Promise((_, reject) => {
    onAbort = /* @__PURE__ */ __name(() => reject(signal.reason ?? new Error("Operation aborted")), "onAbort");
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, abort]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
__name(awaitWithAbort, "awaitWithAbort");
var ANNOTATE_RENDERED_ELEMENTS = `(() => {
  const round = (value) => Math.round(Math.max(0, value) * 100) / 100;
  const selectors = 'a[href],button,input,select,textarea,label,header,nav,main,aside,footer,[role]';
  const counts = new Map();
  for (const element of document.querySelectorAll(selectors)) {
    const tag = element.tagName.toLowerCase();
    const index = counts.get(tag) || 0;
    counts.set(tag, index + 1);
    const rect = element.getBoundingClientRect();
    const horizontalClipped = rect.left < -1 || rect.right > window.innerWidth + 1;
    const verticalClipped = rect.top < -1 || rect.bottom > window.innerHeight + 1;
    const kind = tag === 'a' ? 'anchor' : tag === 'button' ? 'button' :
      ['input', 'select', 'textarea'].includes(tag) ? 'form-control' :
      tag === 'label' ? 'label' : 'landmark';
    element.setAttribute('data-orbit-element-key', tag + ':' + index);
    element.setAttribute('data-orbit-element-kind', kind);
    element.setAttribute('data-orbit-rect', [round(rect.left), round(rect.top), round(rect.width), round(rect.height), window.innerWidth, window.innerHeight].join(','));
    element.setAttribute('data-orbit-horizontal-clipped', String(horizontalClipped));
    element.setAttribute('data-orbit-vertical-clipped', String(verticalClipped));
  }
})();`;
function isVisualCaptureOptions(value) {
  return typeof value === "object" && value !== null && typeof value.runId === "string" && "budget" in value;
}
__name(isVisualCaptureOptions, "isVisualCaptureOptions");
function abortSignal(value) {
  if (!value || typeof value !== "object") return void 0;
  const candidate = value;
  return typeof candidate.aborted === "boolean" && typeof candidate.addEventListener === "function" ? value : void 0;
}
__name(abortSignal, "abortSignal");
function reserveRenderSlot(budget3, label) {
  return budget3 ? budget3.reserve(label, 1) : true;
}
__name(reserveRenderSlot, "reserveRenderSlot");
function sha256Hex(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto is unavailable for screenshot identity");
  return subtle.digest("SHA-256", new TextEncoder().encode(value)).then(
    (digest2) => [...new Uint8Array(digest2)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}
__name(sha256Hex, "sha256Hex");
async function screenshotIdentity(runId, pageUrl, viewport) {
  return `shot_${await sha256Hex(`${runId}|${crawlKey(pageUrl)}|${viewport}`)}`;
}
__name(screenshotIdentity, "screenshotIdentity");
function availability(state, observedCount, reason) {
  return {
    kind: "screenshot",
    state,
    observedCount,
    ...reason ? { reason } : {}
  };
}
__name(availability, "availability");
function htmlAttribute(openTag, name) {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`,
    "i"
  ).exec(openTag);
  return match?.[1] ?? match?.[2] ?? "";
}
__name(htmlAttribute, "htmlAttribute");
function boundedVisibleText(value) {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&(?:amp|#38);/gi, "&").replace(/&(?:lt|#60);/gi, "<").replace(/&(?:gt|#62);/gi, ">").replace(/\s+/g, " ").trim().slice(0, 500);
}
__name(boundedVisibleText, "boundedVisibleText");
function renderedElementsFromHtml(html2) {
  const labels = /* @__PURE__ */ new Map();
  const labelPattern = /<label\b([^>]*)>([\s\S]*?)<\/label>/gi;
  let labelMatch;
  while ((labelMatch = labelPattern.exec(html2)) !== null) {
    const target = htmlAttribute(labelMatch[1] ?? "", "for").trim();
    if (target) labels.set(target, boundedVisibleText(labelMatch[2] ?? ""));
  }
  const elements = [];
  const elementPattern = /<(a|button|input|select|textarea|label|header|nav|main|aside|footer|[a-z][a-z0-9-]*)\b([^>]*)>/gi;
  let match;
  while ((match = elementPattern.exec(html2)) !== null && elements.length < 250) {
    const openTag = match[2] ?? "";
    const elementKey = htmlAttribute(openTag, "data-orbit-element-key").trim();
    const kind = htmlAttribute(openTag, "data-orbit-element-kind").trim();
    if (!elementKey || !["anchor", "button", "form-control", "label", "landmark"].includes(kind)) continue;
    const rectValues = htmlAttribute(openTag, "data-orbit-rect").split(",").map((value) => Number(value));
    if (rectValues.length !== 6 || rectValues.some((value) => !Number.isFinite(value)) || rectValues[4] <= 0 || rectValues[5] <= 0) continue;
    const tag2 = (match[1] ?? "").toLowerCase();
    const id = htmlAttribute(openTag, "id").trim();
    const ariaLabel = htmlAttribute(openTag, "aria-label").trim().slice(0, 500);
    const title2 = htmlAttribute(openTag, "title").trim().slice(0, 500);
    const placeholder = htmlAttribute(openTag, "placeholder").trim().slice(0, 500);
    const name = htmlAttribute(openTag, "name").trim().slice(0, 500);
    const associatedLabel = id ? labels.get(id) ?? "" : "";
    const bodyStart = (match.index ?? 0) + match[0].length;
    const close = new RegExp(`</${tag2}\\s*>`, "i").exec(html2.slice(bodyStart));
    const innerText = close ? boundedVisibleText(html2.slice(bodyStart, bodyStart + close.index)) : "";
    const label = tag2 === "label" ? innerText : associatedLabel;
    const accessibleName = ariaLabel || label || innerText || title2 || placeholder || name;
    const labelState = kind === "landmark" ? accessibleName ? "present" : "not-applicable" : kind === "label" ? innerText ? "present" : "empty" : accessibleName ? "present" : "missing";
    elements.push({
      runId: "",
      screenshotId: "",
      pageUrl: "",
      viewport: "desktop",
      viewportWidth: Math.trunc(rectValues[4]),
      viewportHeight: Math.trunc(rectValues[5]),
      elementKey,
      kind,
      geometry: {
        left: Math.max(0, rectValues[0]),
        top: Math.max(0, rectValues[1]),
        width: rectValues[2],
        height: rectValues[3],
        horizontallyClipped: htmlAttribute(openTag, "data-orbit-horizontal-clipped") === "true",
        verticallyClipped: htmlAttribute(openTag, "data-orbit-vertical-clipped") === "true"
      },
      label,
      accessibleName,
      labelState,
      source: "rendered"
    });
  }
  return elements;
}
__name(renderedElementsFromHtml, "renderedElementsFromHtml");
function renderedPageObservation(runId, screenshot, html2) {
  const elements = renderedElementsFromHtml(html2).map((element) => ({
    ...element,
    runId,
    screenshotId: screenshot.id,
    pageUrl: screenshot.pageUrl,
    viewport: screenshot.viewport,
    viewportWidth: screenshot.width,
    viewportHeight: screenshot.height
  }));
  return RenderedPageObservationSchema.parse({
    runId,
    screenshotId: screenshot.id,
    pageUrl: screenshot.pageUrl,
    viewport: screenshot.viewport,
    width: screenshot.width,
    height: screenshot.height,
    capturedAt: screenshot.capturedAt,
    elements,
    source: "rendered"
  });
}
__name(renderedPageObservation, "renderedPageObservation");
function snapshotRequest(url, viewport, assetUrls = []) {
  const checked = normalizeAndValidateUrl(url);
  if (!checked.ok || checked.url.port && !["80", "443"].includes(checked.url.port))
    throw new Error("Unsafe screenshot destination");
  const host = checked.url.hostname.replace(/^www\./, "");
  const hosts = /* @__PURE__ */ new Set([host, "www." + host, ...ASSET_HOSTS]);
  for (const raw of assetUrls.slice(0, 40)) {
    const asset = normalizeAndValidateUrl(raw, checked.url);
    if (asset.ok && !asset.url.port && isSameSite(asset.url, checked.url)) {
      hosts.add(asset.url.hostname);
    }
  }
  const mobile = viewport === "mobile";
  return {
    url: checked.url.href,
    // Restrict all browser requests, including redirects, to the website and
    // observed image hosts. No authenticated cookies or arbitrary headers.
    allowRequestPattern: [...hosts].map((h) => `^https?://${escapeRegex(h)}/`),
    rejectResourceTypes: ["media", "websocket", "eventsource", "ping"],
    viewport: {
      width: mobile ? 390 : 1440,
      height: mobile ? 844 : 1e3,
      deviceScaleFactor: 1,
      isMobile: mobile,
      hasTouch: mobile
    },
    // Annotate the exact DOM used for this screenshot. These inert data
    // attributes let the deterministic gate disprove false horizontal clipping
    // claims without making a second browser request or trusting model geometry.
    addScriptTag: [{ content: ANNOTATE_RENDERED_ELEMENTS }],
    screenshotOptions: { type: "jpeg", quality: 65, fullPage: false },
    gotoOptions: { waitUntil: "networkidle2", timeout: 12e3 },
    actionTimeout: 4e3,
    bestAttempt: false
  };
}
__name(snapshotRequest, "snapshotRequest");
var CloudflareVisualCapture = class {
  constructor(browser) {
    this.browser = browser;
  }
  browser;
  static {
    __name(this, "CloudflareVisualCapture");
  }
  async capture(client, evidence, optionsOrSignal) {
    const modern = isVisualCaptureOptions(optionsOrSignal);
    const signal = modern ? optionsOrSignal.signal : abortSignal(optionsOrSignal);
    const budget3 = modern ? optionsOrSignal.budget : void 0;
    const runId = modern ? optionsOrSignal.runId : "legacy-capture";
    const unavailable5 = /* @__PURE__ */ __name((limitations2) => modern ? {
      screenshots: [],
      renderedPages: [],
      limitations: limitations2,
      availability: [availability("unavailable", 0, limitations2[0])],
      providerCalls: 0
    } : { screenshots: [], limitations: limitations2 }, "unavailable");
    const root2 = normalizeAndValidateUrl(
      client.domain.includes("://") ? client.domain : `https://${client.domain}/`
    );
    if (!root2.ok)
      return unavailable5(["The website address was not safe to capture."]);
    if (evidence.networkEvents.some(
      (e) => e.code === "robots" || e.code === "policy"
    )) {
      return unavailable5(["The website's access policy prevented visual capture."]);
    }
    const homepage = evidence.site.pages.find(
      (p) => isSameSite(p.url, root2.url) && new URL(p.url).pathname === "/"
    )?.url ?? root2.url.href;
    const detailUrl = evidence.site.pages.find(
      (p) => p.status >= 200 && p.status < 300 && isSameSite(p.url, root2.url) && crawlKey(p.url) !== crawlKey(homepage) && looksLikeServiceUrl(p.url)
    )?.url ?? evidence.site.sitemapUrls.flatMap((url) => {
      const checked = normalizeAndValidateUrl(url, root2.url);
      return checked.ok ? [checked.url] : [];
    }).find(
      (url) => isSameSite(url, root2.url) && crawlKey(url.href) !== crawlKey(homepage) && looksLikeServiceUrl(url.href)
    )?.href ?? evidence.site.pages.find(
      (p) => isSameSite(p.url, root2.url) && /contact|book|appointment|quote/i.test(new URL(p.url).pathname) && p.status === 200
    )?.url;
    const targets = [
      { url: homepage, viewport: "desktop", label: "Homepage \xB7 Desktop" },
      { url: homepage, viewport: "mobile", label: "Homepage \xB7 Mobile" },
      ...detailUrl ? [
        {
          url: detailUrl,
          viewport: "mobile",
          label: "Service / enquiry page \xB7 Mobile"
        }
      ] : []
    ];
    const assets = evidence.site.pages.flatMap(
      (p) => (p.images ?? []).map((i) => i.src)
    );
    const screenshots = [];
    const renderedPages = [];
    const limitations = [];
    let providerCalls = 0;
    const captures3 = await Promise.allSettled(
      targets.map(async (target) => {
        signal?.throwIfAborted();
        if (!reserveRenderSlot(budget3, `visual:${crawlKey(target.url)}:${target.viewport}`)) {
          throw new Error("render budget exhausted");
        }
        providerCalls += 1;
        const options = snapshotRequest(target.url, target.viewport, assets);
        const response = await awaitWithAbort(
          this.browser.quickAction("snapshot", options),
          signal
        );
        signal?.throwIfAborted();
        if (!response.ok) {
          console.warn(
            `[visual capture] ${target.label} failed with HTTP ${response.status}`
          );
          throw new Error("capture failed");
        }
        const text = await awaitWithAbort(response.text(), signal);
        if (text.length > 2e6) throw new Error("capture too large");
        const body = JSON.parse(text);
        const result = body.result ?? body;
        const meta3 = body.meta ?? result.meta ?? {};
        const finalUrl = meta3.finalUrl ?? target.url;
        const final = normalizeAndValidateUrl(finalUrl);
        if (!final.ok || !isSameSite(final.url, root2.url))
          throw new Error("capture redirected away");
        if (meta3.status !== void 0 && (meta3.status < 200 || meta3.status >= 300))
          throw new Error("not a successful page");
        const html2 = result.content;
        const image = result.screenshot;
        if (typeof html2 !== "string" || typeof image !== "string" || image.length > 35e4 || !image.startsWith("/9j/"))
          throw new Error("invalid capture");
        const parsed = parseHtml(html2, final.url.href, 8e3);
        const pageHeading = parsed.page.title + " " + parsed.page.headings.slice(0, 3).join(" ");
        if (parsed.page.wordCount < 25 || /(?:^|\s)(?:404|page not found|page doesn't exist|service unavailable|sign in to continue|log in to continue)(?:\s|[.!|—-]|$)/i.test(
          pageHeading
        ) || /\/(?:login|sign-in|signin|auth)(?:\/|$)/i.test(final.url.pathname) || /just a moment|access denied|attention required|verify you are human|checking your browser/i.test(
          parsed.page.title + " " + parsed.page.textExcerpt.slice(0, 250)
        ))
          throw new Error("unusable page");
        const screenshot = {
          id: await screenshotIdentity(runId, final.url.href, target.viewport),
          pageUrl: final.url.href,
          viewport: target.viewport,
          width: options.viewport.width,
          height: options.viewport.height,
          capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
          label: target.label,
          dataUrl: `data:image/jpeg;base64,${image}`,
          text: parsed.page.textExcerpt,
          links: parsed.links.slice(0, 60),
          page: EvidencePageSchema.parse({
            ...parsed.page,
            status: meta3.status ?? 200
          })
        };
        return {
          screenshot,
          renderedPage: renderedPageObservation(runId, screenshot, html2)
        };
      })
    );
    captures3.forEach((r, i) => {
      if (r.status === "fulfilled") {
        screenshots.push(r.value.screenshot);
        renderedPages.push(r.value.renderedPage);
      } else
        limitations.push(
          `${targets[i].label} could not be captured reliably.`
        );
    });
    if (!modern) return { screenshots, limitations };
    const captureState = screenshots.length === targets.length ? "available" : screenshots.length > 0 ? "partial" : "unavailable";
    return {
      screenshots,
      renderedPages,
      limitations,
      availability: [
        availability(
          captureState,
          screenshots.length,
          limitations.length > 0 ? "One or more requested renders were unavailable." : void 0
        )
      ],
      providerCalls
    };
  }
};
