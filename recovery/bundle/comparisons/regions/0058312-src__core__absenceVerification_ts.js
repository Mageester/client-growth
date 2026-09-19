// src/core/absenceVerification.ts
function isPageFetchFailure(page) {
  return page !== null && "kind" in page && page.kind === "network-failure";
}
__name(isPageFetchFailure, "isPageFetchFailure");
var STRONG_SCORE = 0.6;
var CLOSE_SCORE = 0.5;
function textTokenSet(text) {
  return new Set(coreTokens(text).map(singularize));
}
__name(textTokenSet, "textTokenSet");
function commonPrefix(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}
__name(commonPrefix, "commonPrefix");
function has(setTokens, token3) {
  if (setTokens.has(token3)) return true;
  for (const t of setTokens) {
    if (t.length < 4 || token3.length < 4) continue;
    if (t.includes(token3) || token3.includes(t)) return true;
    const shorter = Math.min(t.length, token3.length);
    const prefix = commonPrefix(t, token3);
    if (prefix >= 5 && prefix >= shorter - 2) return true;
  }
  return false;
}
__name(has, "has");
var SIGNATURE_MIN_LEN = 7;
function strengthOf(candidateTokens, head, discriminating) {
  if (head.length === 0) return { score: 0, hasAllDiscriminating: false, hasSignature: false };
  const overlap = head.filter((t) => has(candidateTokens, t)).length;
  const score = overlap / head.length;
  const hasAllDiscriminating = discriminating.length > 0 && discriminating.every((t) => has(candidateTokens, t));
  const signatureToken = discriminating.some(
    (t) => t.length >= SIGNATURE_MIN_LEN && has(candidateTokens, t)
  );
  const saysNothingNew = candidateTokens.size > 0 && [...candidateTokens].every((t) => head.includes(t));
  const hasSignature = signatureToken && (score >= 0.5 || saysNothingNew);
  return { score, hasAllDiscriminating, hasSignature };
}
__name(strengthOf, "strengthOf");
async function verifyOfferingAbsence(input) {
  const { offering, allOfferings, evidence } = input;
  const maxFetches = input.maxFetches ?? 3;
  const budget3 = input.budget ?? { remaining: maxFetches };
  const head = significantTokens(offering);
  const closeMatches = [];
  const inspectedUrls = [];
  if (head.length === 0) {
    return {
      conclusion: "weak",
      inspectedUrls,
      closeMatches,
      reason: `"${offering}" has no distinctive words to verify against; not treated as a gap.`
    };
  }
  const freq = /* @__PURE__ */ new Map();
  for (const other of allOfferings) {
    for (const t of new Set(significantTokens(other))) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  let discriminating = head.filter((t) => (freq.get(t) ?? 0) < 2);
  if (discriminating.length === 0) discriminating = [...head];
  const record2 = /* @__PURE__ */ __name((m) => {
    if (!closeMatches.some((c) => c.where === m.where && c.value === m.value)) closeMatches.push(m);
  }, "record");
  for (const page of evidence.site.pages) {
    if (isHomepage(page.url) || slugSaysNonService(page.url)) continue;
    const tokens = textTokenSet([page.title, ...page.h1s, ...page.headings].join(" "));
    const s = strengthOf(tokens, head, discriminating);
    if (s.hasAllDiscriminating && s.score >= STRONG_SCORE || s.hasSignature) {
      record2({
        where: "crawled-page",
        value: page.title || page.url,
        url: page.url,
        score: round(s.score),
        satisfied: true,
        reason: "A crawled page already targets this offering in its title/headings."
      });
      return present(offering, matchedUrlOf(closeMatches), inspectedUrls, closeMatches);
    }
  }
  const strongLinks = [];
  const closeLinks = [];
  const consider = /* @__PURE__ */ __name((value, where, url, isSlug) => {
    if (!value.trim()) return;
    const tokens = isSlug ? new Set(slugTokens(value)) : textTokenSet(value);
    const s = strengthOf(tokens, head, discriminating);
    if (s.hasAllDiscriminating || s.hasSignature) {
      strongLinks.push({ url, value, where, score: round(s.score) });
    } else if (s.score >= CLOSE_SCORE) {
      closeLinks.push({ url, value, where, score: round(s.score) });
    }
  }, "consider");
  for (const label of evidence.site.nav) consider(label, "nav-label", void 0, false);
  for (const link of evidence.site.links) {
    consider(link.label, link.inNav ? "nav-label" : "link-label", link.href, false);
    consider(link.href, "link-href", link.href, true);
  }
  for (const url of evidence.site.sitemapUrls) consider(url, "sitemap-url", url, true);
  strongLinks.sort((a, b) => b.score - a.score);
  closeLinks.sort((a, b) => b.score - a.score);
  const strongWithUrl = strongLinks.filter((l) => l.url);
  const strongLabelOnly = strongLinks.filter((l) => !l.url);
  if (strongWithUrl.length > 0) {
    const top = strongWithUrl[0];
    if (input.fetchPage && top.url && budget3.remaining > 0) {
      budget3.remaining--;
      inspectedUrls.push(top.url);
      const page = await input.fetchPage(top.url);
      if (isPageFetchFailure(page)) {
        record2({
          where: top.where,
          value: top.value,
          url: top.url,
          score: top.score,
          satisfied: false,
          reason: `Targeted fetch was ${page.outcome}: ${page.reason}`
        });
        return inconclusive(
          offering,
          inspectedUrls,
          closeMatches,
          `Targeted verification of "${top.url}" was ${page.outcome}; absence cannot be proven.`
        );
      }
      if (page) {
        const tokens = textTokenSet([page.title, ...page.h1s, ...page.headings].join(" "));
        const satisfied = strengthOf(tokens, head, discriminating).hasAllDiscriminating;
        record2({
          where: "fetched-page",
          value: page.title || top.url,
          url: top.url,
          score: top.score,
          satisfied,
          reason: satisfied ? "Fetched the linked page; it targets this offering." : "Fetched the linked page; the link is named after the service though its title/headings were less specific."
        });
      }
    }
    for (const l of strongWithUrl.slice(0, 4)) {
      record2({ where: l.where, value: l.value, url: l.url, score: l.score, satisfied: true, reason: "Link is named after this offering \u2014 a dedicated page almost certainly exists." });
    }
    return present(offering, top.url, inspectedUrls, closeMatches);
  }
  for (const l of closeLinks) {
    if (!input.fetchPage || !l.url || budget3.remaining <= 0) continue;
    if (inspectedUrls.includes(l.url)) continue;
    budget3.remaining--;
    inspectedUrls.push(l.url);
    const page = await input.fetchPage(l.url);
    if (isPageFetchFailure(page)) {
      record2({
        where: l.where,
        value: l.value,
        url: l.url,
        score: l.score,
        satisfied: false,
        reason: `Targeted fetch was ${page.outcome}: ${page.reason}`
      });
      return inconclusive(
        offering,
        inspectedUrls,
        closeMatches,
        `Targeted verification of "${l.url}" was ${page.outcome}; absence cannot be proven.`
      );
    }
    if (!page) {
      record2({ where: l.where, value: l.value, url: l.url, score: l.score, satisfied: false, reason: "Linked page could not be fetched." });
      continue;
    }
    const tokens = textTokenSet([page.title, ...page.h1s, ...page.headings].join(" "));
    const s = strengthOf(tokens, head, discriminating);
    const satisfied = s.hasAllDiscriminating && s.score >= STRONG_SCORE || s.hasSignature;
    record2({
      where: "fetched-page",
      value: page.title || l.url,
      url: l.url,
      score: round(s.score),
      satisfied,
      reason: satisfied ? "Fetched a near-match link; the page does target this offering." : "Fetched a near-match link; the page does not adequately cover this offering."
    });
    if (satisfied) return present(offering, l.url, inspectedUrls, closeMatches);
  }
  const unverifiable = [...strongLabelOnly, ...closeLinks.filter((l) => !l.url)];
  if (unverifiable.length > 0) {
    for (const l of unverifiable.slice(0, 4)) {
      record2({ where: l.where, value: l.value, url: l.url, score: l.score, satisfied: false, reason: "Matches this offering but has no link to verify \u2014 existence signal, cannot confirm or deny." });
    }
    return {
      conclusion: "inconclusive",
      inspectedUrls,
      closeMatches,
      reason: `A navigation entry ("${unverifiable[0].value}") matches "${offering}" but has no link to verify; absence cannot be proven, so no opportunity is surfaced.`
    };
  }
  const unverifiedCloseLinks = closeLinks.filter(
    (l) => l.url && !inspectedUrls.includes(l.url)
  );
  if (unverifiedCloseLinks.length > 0) {
    for (const l of unverifiedCloseLinks.slice(0, 4)) {
      record2({
        where: l.where,
        value: l.value,
        url: l.url,
        score: l.score,
        satisfied: false,
        reason: "Near-match URL was not fetched; targeted verification was unavailable or its budget was exhausted."
      });
    }
    return inconclusive(
      offering,
      inspectedUrls,
      closeMatches,
      "a near-match URL could not be checked within the targeted verification budget; absence cannot be proven."
    );
  }
  return {
    conclusion: "absent",
    inspectedUrls,
    closeMatches,
    reason: closeMatches.length > 0 ? `No crawled page, navigation entry, link, or sitemap URL adequately covers "${offering}"; the nearest matches were checked and rejected.` : `No crawled page, navigation entry, link, or sitemap URL mentions "${offering}".`
  };
}
__name(verifyOfferingAbsence, "verifyOfferingAbsence");
function round(n) {
  return Math.round(n * 100) / 100;
}
__name(round, "round");
function matchedUrlOf(closeMatches) {
  return closeMatches.find((c) => c.satisfied)?.url;
}
__name(matchedUrlOf, "matchedUrlOf");
function present(offering, matchedUrl, inspectedUrls, closeMatches) {
  return {
    conclusion: "present",
    inspectedUrls,
    closeMatches,
    reason: matchedUrl ? `The site already has a page/section for "${offering}" (${matchedUrl}).` : `The site already represents "${offering}" in its navigation or link structure.`
  };
}
__name(present, "present");
function inconclusive(offering, inspectedUrls, closeMatches, reason) {
  return {
    conclusion: "inconclusive",
    inspectedUrls,
    closeMatches,
    reason: `Could not verify whether "${offering}" is represented. ${reason}`
  };
}
__name(inconclusive, "inconclusive");
function offeringHead(offering) {
  return significantTokens(offering);
}
__name(offeringHead, "offeringHead");
function textCoversOffering(text, head) {
  if (head.length === 0) return false;
  const tokens = textTokenSet(text);
  const overlap = head.filter((t) => has(tokens, t)).length;
  return overlap / head.length >= STRONG_SCORE && overlap >= 1;
}
__name(textCoversOffering, "textCoversOffering");
function slugCoversOffering(slug3, head) {
  if (head.length === 0) return false;
  const tokens = new Set(slugTokens(slug3));
  const overlap = head.filter((t) => has(tokens, t)).length;
  return overlap / head.length >= STRONG_SCORE && overlap >= 1;
}
__name(slugCoversOffering, "slugCoversOffering");
function isHomepage(url) {
  return pathSegments(url).length === 0;
}
__name(isHomepage, "isHomepage");
function isServiceLikePage(page, heads, serviceNavTargets) {
  if (isHomepage(page.url)) return false;
  if (looksLikeServiceUrl(page.url)) return true;
  if (slugSaysNonService(page.url)) return false;
  if (serviceNavTargets.has(normalizedPageUrl3(page.url))) return true;
  return heads.some((head) => slugCoversOffering(page.url, head));
}
__name(isServiceLikePage, "isServiceLikePage");
function normalizedPageUrl3(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/#.*$/, "").replace(/\/$/, "");
  }
}
__name(normalizedPageUrl3, "normalizedPageUrl");
function isServiceLikeUrl(url, heads) {
  if (isHomepage(url)) return false;
  if (looksLikeServiceUrl(url)) return true;
  if (slugSaysNonService(url)) return false;
  return heads.some((head) => slugCoversOffering(url, head));
}
__name(isServiceLikeUrl, "isServiceLikeUrl");
function offeringIsSiteObserved(input) {
  const { evidence } = input;
  const head = offeringHead(input.offering);
  if (head.length === 0) return false;
  const allHeads = input.offerings.filter((o) => offeringHead(o).length > 0).map(offeringHead);
  const serviceNavTargets = new Set(
    evidence.site.links.filter((link) => link.scheme === "http" && link.inServiceNav).map((link) => normalizedPageUrl3(link.href))
  );
  const servicePageText = evidence.site.pages.filter((page) => isServiceLikePage(page, allHeads, serviceNavTargets)).map((page) => [page.title, ...page.h1s, ...page.headings].join(" "));
  const labelHaystack = [...evidence.site.nav, ...evidence.site.links.map((l) => l.label)];
  const slugHaystack = [
    ...evidence.site.links.filter((l) => l.scheme === "http").map((l) => l.href),
    ...evidence.site.sitemapUrls
  ];
  return servicePageText.some((text) => textCoversOffering(text, head)) || labelHaystack.some((label) => textCoversOffering(label, head)) || slugHaystack.some((slug3) => slugCoversOffering(slug3, head));
}
__name(offeringIsSiteObserved, "offeringIsSiteObserved");
function assessServiceCoverage(input) {
  const { evidence } = input;
  const offerings = input.client.offerings.filter((o) => offeringHead(o).length > 0);
  const heads = offerings.map(offeringHead);
  const labelHaystack = [
    ...evidence.site.nav,
    ...evidence.site.links.map((l) => l.label)
  ];
  const slugHaystack = [
    ...evidence.site.links.filter((l) => l.scheme === "http").map((l) => l.href),
    ...evidence.site.sitemapUrls
  ];
  const serviceNavTargets = new Set(
    evidence.site.links.filter((link) => link.scheme === "http" && link.inServiceNav).map((link) => normalizedPageUrl3(link.href))
  );
  const serviceLikePages = evidence.site.pages.filter(
    (page) => isServiceLikePage(page, heads, serviceNavTargets)
  );
  const servicePageText = serviceLikePages.map(
    (p) => [p.title, ...p.h1s, ...p.headings].join(" ")
  );
  let representedOfferings = 0;
  for (const head of heads) {
    const represented = servicePageText.some((t) => textCoversOffering(t, head)) || labelHaystack.some((h) => textCoversOffering(h, head)) || slugHaystack.some((s) => slugCoversOffering(s, head));
    if (represented) representedOfferings++;
  }
  const serviceLikeSitemapUrls = evidence.site.sitemapUrls.filter(
    (u) => isServiceLikeUrl(u, heads)
  ).length;
  const analyzable = representedOfferings >= 2 || serviceLikePages.length >= 2 || serviceLikeSitemapUrls >= 3;
  const limitation3 = analyzable ? null : evidence.site.crawlExhaustive ? "site-too-thin" : "coverage-limited";
  const counts = `${representedOfferings} offering(s) represented in the site's navigation, links or sitemap, ${serviceLikePages.length} service page(s) read, ${serviceLikeSitemapUrls} service URL(s) in the sitemap`;
  const reason = analyzable ? `Service coverage confirmed: ${counts}.` : limitation3 === "site-too-thin" ? `This site has no service pages: the crawl followed every link on it and found ${counts}. Nothing was blocked and nothing was left unread, so this is the whole site.` : `Insufficient service coverage: only ${counts} \u2014 the crawl did not demonstrably reach the site's service pages, so no absence can be claimed.`;
  return {
    analyzable,
    reason,
    representedOfferings,
    serviceLikePages: serviceLikePages.length,
    serviceLikeSitemapUrls,
    limitation: limitation3
  };
}
__name(assessServiceCoverage, "assessServiceCoverage");
