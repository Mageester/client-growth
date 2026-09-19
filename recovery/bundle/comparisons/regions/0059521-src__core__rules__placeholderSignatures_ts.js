// src/core/rules/placeholderSignatures.ts
var PLACEHOLDER_SIGNATURES = [
  {
    key: "paragraph-scaffold",
    label: "a site-builder paragraph scaffold that tells the owner to add their own text",
    pattern: /i['’]?m a paragraph\.?\s*click here to add your own text/i
  },
  {
    key: "edit-text-instruction",
    label: "instructions to the site owner about editing text",
    pattern: /click ['’"“]?edit text['’"”]? or double[- ]click me/i
  },
  {
    key: "drag-drop-instruction",
    label: "instructions to the site owner about dragging and dropping the text",
    pattern: /drag and drop me anywhere you like on your page/i
  },
  {
    key: "write-about-company-scaffold",
    label: "generic scaffold text telling the owner to write about their company",
    pattern: /this is a great space to write long text about your company and your services/i
  },
  {
    key: "faq-add-question",
    label: "a site-builder FAQ scaffold question about adding a question",
    pattern: /how do i add a new question\s*&\s*answer/i
  },
  {
    key: "faq-insert-media",
    label: "a site-builder FAQ scaffold question about inserting media",
    pattern: /can i insert an image,? video,? or gif in my faq/i
  },
  {
    key: "faq-edit-title",
    label: "a site-builder FAQ scaffold question about editing the FAQ title",
    pattern: /how do i edit or remove the ['’"“]?faq['’"”]? title/i
  },
  {
    key: "lorem-ipsum-filler",
    label: "lorem-ipsum filler text left in production",
    pattern: /\blorem ipsum dolor sit amet\b/i
  },
  {
    key: "brand-name-scaffold",
    label: "an unreplaced site-builder brand placeholder",
    pattern: /your business name here|\byour company name here\b|\[(?:your|company|business)\s+name\]/i
  }
];
function compact(value, max = 160) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, Math.max(1, max - 1))}\u2026`;
}
__name(compact, "compact");
function matchesForPageText(text) {
  if (!text.trim()) return [];
  const matches = [];
  for (const signature of PLACEHOLDER_SIGNATURES) {
    const match = signature.pattern.exec(text);
    if (!match) continue;
    matches.push({
      key: signature.key,
      label: signature.label,
      excerpt: compact(match[0])
    });
  }
  return matches;
}
__name(matchesForPageText, "matchesForPageText");
function placeholderMatchesForPage(page) {
  return matchesForPageText(page.textExcerpt ?? "");
}
__name(placeholderMatchesForPage, "placeholderMatchesForPage");
function isReadablePageForPlaceholder(page) {
  return page.status >= 200 && page.status < 300 && page.wordCount > 0 && typeof page.textExcerpt === "string" && page.textExcerpt.trim().length > 0;
}
__name(isReadablePageForPlaceholder, "isReadablePageForPlaceholder");
