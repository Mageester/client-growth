// src/adapters/evidence/parseHtml.ts
var TEXT_EXCERPT_LENGTH = 1500;
var MAX_RICH_ITEMS = 100;
var MAX_RICH_TEXT = 500;
function richText(input, maxLength = MAX_RICH_TEXT) {
  return clean(input).slice(0, maxLength);
}
__name(richText, "richText");
function boundedSourceKey(value) {
  if (value.length <= 120) return value;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${value.slice(0, 110)}-${hash.toString(16).padStart(8, "0")}`;
}
__name(boundedSourceKey, "boundedSourceKey");
function safeElementToken(value) {
  return value.trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
__name(safeElementToken, "safeElementToken");
function normalisedDate(value) {
  const trimmed = richText(value, 100);
  const isoLike = /^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/.exec(trimmed);
  if (!isoLike) return trimmed;
  return `${isoLike[1]}-${isoLike[2].padStart(2, "0")}-${isoLike[3].padStart(2, "0")}`;
}
__name(normalisedDate, "normalisedDate");
function normalisedPhone(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return "";
  if (value.trim().startsWith("+")) return `+${digits}`;
  return digits;
}
__name(normalisedPhone, "normalisedPhone");
function normalisedEmail(value) {
  return value.trim().toLowerCase().slice(0, MAX_RICH_TEXT);
}
__name(normalisedEmail, "normalisedEmail");
function stripTags(input) {
  return input.replace(/<[^>]*>/g, " ");
}
__name(stripTags, "stripTags");
function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 32 || code > 1114111) return " ";
  if (code >= 55296 && code <= 57343) return " ";
  const char = String.fromCodePoint(code);
  return /[<>&"'`]/.test(char) ? " " : char;
}
__name(safeCodePoint, "safeCodePoint");
function decodeEntities(input) {
  return input.replace(/&nbsp;/gi, " ").replace(/&#0?39;|&#x27;/gi, "'").replace(/&#x([0-9a-f]{1,6});/gi, (_, hex2) => safeCodePoint(Number.parseInt(hex2, 16))).replace(/&#(\d{1,7});/g, (_, dec) => safeCodePoint(Number.parseInt(dec, 10))).replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&apos;|&rsquo;|&lsquo;/gi, "'").replace(/&mdash;|&ndash;/gi, "-").replace(/&hellip;/gi, "...").replace(/&ldquo;|&rdquo;/gi, '"').replace(/&(?:reg|trade|copy|middot|bull|times);/gi, " ");
}
__name(decodeEntities, "decodeEntities");
function clean(input) {
  return decodeEntities(stripTags(input)).replace(/\s+/g, " ").trim();
}
__name(clean, "clean");
function captures(re, input) {
  const out = [];
  let match;
  while ((match = re.exec(input)) !== null) {
    if (match[1] !== void 0) out.push(match[1]);
  }
  return out;
}
__name(captures, "captures");
function attributeValue(openTag, name) {
  const m = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`,
    "i"
  ).exec(openTag);
  return m?.[1] ?? m?.[2];
}
__name(attributeValue, "attributeValue");
function hasAttribute(openTag, name) {
  return new RegExp(`(?:^|\\s)${name}(?:\\s*=|\\s|$)`, "i").test(openTag);
}
__name(hasAttribute, "hasAttribute");
function attr(openTag, name) {
  return attributeValue(openTag, name) ?? "";
}
__name(attr, "attr");
function renderedLinkGeometry(openTag) {
  const values = attr(openTag, "data-orbit-rect").split(",").map(Number);
  const clipped = attr(openTag, "data-orbit-horizontal-clipped");
  if (values.length !== 6 || values.some((value) => !Number.isFinite(value))) return void 0;
  if (clipped !== "true" && clipped !== "false") return void 0;
  if (values.slice(0, 4).some((value) => value < 0)) return void 0;
  if (!Number.isInteger(values[4]) || !Number.isInteger(values[5]) || values[4] <= 0 || values[5] <= 0) {
    return void 0;
  }
  return {
    left: values[0],
    top: values[1],
    width: values[2],
    height: values[3],
    viewportWidth: values[4],
    viewportHeight: values[5],
    horizontallyClipped: clipped === "true"
  };
}
__name(renderedLinkGeometry, "renderedLinkGeometry");
function mergeRenderedGeometry(current, next) {
  if (!current) return next;
  if (!next || current.horizontallyClipped === next.horizontallyClipped) return current;
  return current.horizontallyClipped ? current : next;
}
__name(mergeRenderedGeometry, "mergeRenderedGeometry");
function extractMetaDescription(html2) {
  const metaRe = /<meta\b([^>]*)>/gi;
  let observed = false;
  let lastValue = "";
  let match;
  while ((match = metaRe.exec(html2)) !== null) {
    const openTag = match[1] ?? "";
    if (attributeValue(openTag, "name")?.trim().toLowerCase() !== "description") continue;
    observed = true;
    lastValue = attributeValue(openTag, "content") ?? "";
    if (lastValue.trim() !== "") return lastValue;
  }
  return observed ? lastValue : "";
}
__name(extractMetaDescription, "extractMetaDescription");
function collectStructuredDataTypes(value, output3, depth = 0) {
  if (depth > 12 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredDataTypes(item, output3, depth + 1);
    return;
  }
  const record2 = value;
  const type = record2["@type"];
  if (typeof type === "string") output3.push(type);
  if (Array.isArray(type)) {
    for (const item of type) if (typeof item === "string") output3.push(item);
  }
  for (const child of Object.values(record2)) {
    collectStructuredDataTypes(child, output3, depth + 1);
  }
}
__name(collectStructuredDataTypes, "collectStructuredDataTypes");
function collectStructuredFacts(value, sourceKey, contactFacts, datedFacts, depth = 0) {
  if (depth > 12 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.slice(0, MAX_RICH_ITEMS).forEach(
      (item, index) => collectStructuredFacts(item, `${sourceKey}:${index}`, contactFacts, datedFacts, depth + 1)
    );
    return;
  }
  const record2 = value;
  for (const [rawKey, child] of Object.entries(record2)) {
    const key = rawKey.trim().toLowerCase();
    const childSource = boundedSourceKey(`${sourceKey}:${safeElementToken(rawKey) || "field"}`);
    if (typeof child === "string") {
      const text = richText(child, MAX_RICH_TEXT);
      if (!text) continue;
      if (key === "telephone" || key === "phone") {
        const normalized3 = normalisedPhone(text);
        if (normalized3 && !contactFacts.some((fact) => fact.kind === "phone" && fact.value === normalized3)) {
          contactFacts.push({ sourceKey: childSource, kind: "phone", value: normalized3, origin: "structured_data" });
        }
      } else if (key === "email") {
        const normalized3 = normalisedEmail(text);
        if (!contactFacts.some((fact) => fact.kind === "email" && fact.value === normalized3)) {
          contactFacts.push({ sourceKey: childSource, kind: "email", value: normalized3, origin: "structured_data" });
        }
      } else if (key === "streetaddress" || key === "addresslocality" || key === "addressregion" || key === "postalcode") {
        if (!contactFacts.some((fact) => fact.kind === "address" && fact.value === text)) {
          contactFacts.push({ sourceKey: childSource, kind: "address", value: text, origin: "structured_data" });
        }
      } else if (key === "openinghours" || key === "openinghoursspecification") {
        if (!contactFacts.some((fact) => fact.kind === "hours" && fact.value === text)) {
          contactFacts.push({ sourceKey: childSource, kind: "hours", value: text, origin: "structured_data" });
        }
      } else if (key === "datepublished" || key === "datecreated") {
        datedFacts.push({ sourceKey: childSource, kind: "published", value: normalisedDate(text) });
      } else if (key === "datemodified") {
        datedFacts.push({ sourceKey: childSource, kind: "updated", value: normalisedDate(text) });
      } else if (key === "validthrough" || key === "expires") {
        datedFacts.push({ sourceKey: childSource, kind: "offer-expiry", value: normalisedDate(text) });
      } else if (key === "startdate" || key === "enddate" || key === "eventdate") {
        datedFacts.push({ sourceKey: childSource, kind: "event", value: normalisedDate(text) });
      }
    }
    collectStructuredFacts(child, childSource, contactFacts, datedFacts, depth + 1);
    if (contactFacts.length >= MAX_RICH_ITEMS && datedFacts.length >= MAX_RICH_ITEMS) return;
  }
}
__name(collectStructuredFacts, "collectStructuredFacts");
function extractStructuredData(html2) {
  const types = [];
  const contactFacts = [];
  const datedFacts = [];
  let present3 = false;
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptIndex = 0;
  while ((match = scriptRe.exec(html2)) !== null) {
    const openTag = match[1] ?? "";
    const type = attributeValue(openTag, "type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (type !== "application/ld+json") continue;
    present3 = true;
    try {
      const value = JSON.parse((match[2] ?? "").trim().replace(/^\uFEFF/, ""));
      collectStructuredDataTypes(value, types);
      collectStructuredFacts(value, `jsonld:${scriptIndex}`, contactFacts, datedFacts);
    } catch {
    }
    scriptIndex += 1;
  }
  const tagRe = /<[a-z][^>]*>/gi;
  while ((match = tagRe.exec(html2)) !== null) {
    const openTag = match[0] ?? "";
    const itemType = attributeValue(openTag, "itemtype");
    const rdfaType = attributeValue(openTag, "typeof");
    if (itemType !== void 0 || rdfaType !== void 0 || hasAttribute(openTag, "itemprop") || hasAttribute(openTag, "vocab") || hasAttribute(openTag, "prefix")) {
      present3 = true;
    }
    for (const value of [itemType, rdfaType]) {
      if (!value) continue;
      types.push(...value.split(/\s+/).filter(Boolean));
    }
  }
  return {
    types: [...new Set(types)],
    present: present3,
    contactFacts: contactFacts.slice(0, MAX_RICH_ITEMS),
    datedFacts: datedFacts.slice(0, MAX_RICH_ITEMS)
  };
}
__name(extractStructuredData, "extractStructuredData");
function extractImages(html2) {
  const images = [];
  const imageRe = /<img\b([^>]*)>/gi;
  let match;
  while ((match = imageRe.exec(html2)) !== null) {
    const openTag = match[1] ?? "";
    const image = { src: attr(openTag, "src") };
    if (hasAttribute(openTag, "alt")) image.alt = attr(openTag, "alt");
    images.push(image);
  }
  return images;
}
__name(extractImages, "extractImages");
function anchorRecords(input) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(input)) !== null) {
    const openTag = m[1] ?? "";
    const href2 = attr(openTag, "href");
    if (!href2) continue;
    out.push({
      openTag,
      href: href2,
      ariaLabel: attr(openTag, "aria-label"),
      title: attr(openTag, "title"),
      inner: m[2] ?? "",
      offset: m.index
    });
  }
  return out;
}
__name(anchorRecords, "anchorRecords");
function serviceNavigationHrefs(input) {
  const hrefs = /* @__PURE__ */ new Set();
  const detailsRe = /<details\b[^>]*>([\s\S]*?)<\/details>/gi;
  let match;
  while ((match = detailsRe.exec(input)) !== null) {
    const block = match[1] ?? "";
    const summary = clean(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(block)?.[1] ?? "");
    if (!isServiceSectionLabel(summary)) continue;
    for (const anchor2 of anchorRecords(block)) hrefs.add(anchor2.href);
  }
  return hrefs;
}
__name(serviceNavigationHrefs, "serviceNavigationHrefs");
function schemeOf(href2) {
  const value = href2.trim();
  try {
    const parsed = new URL(value, "https://client-growth.invalid/");
    if (parsed.protocol === "tel:") return "tel";
    if (parsed.protocol === "mailto:") return "mailto";
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return "http";
    return null;
  } catch {
    return null;
  }
}
__name(schemeOf, "schemeOf");
function controlRecords(input) {
  const records = [];
  const paired = /<(textarea|select|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = paired.exec(input)) !== null) {
    const tagName = (match[1] ?? "button").toLowerCase();
    records.push({
      tagName,
      openTag: match[2] ?? "",
      inner: match[3] ?? "",
      offset: match.index
    });
  }
  const inputs = /<input\b([^>]*)\/?\s*>/gi;
  while ((match = inputs.exec(input)) !== null) {
    records.push({
      tagName: "input",
      openTag: match[1] ?? "",
      inner: "",
      offset: match.index
    });
  }
  return records.sort((left, right) => left.offset - right.offset);
}
__name(controlRecords, "controlRecords");
function labelForControl(formBody, openTag) {
  const id = attr(openTag, "id").trim();
  const ariaLabel = richText(attr(openTag, "aria-label"));
  if (ariaLabel) return { label: "", accessibleName: ariaLabel, labelSource: "aria-label" };
  const labelledBy = attr(openTag, "aria-labelledby").trim();
  if (labelledBy) {
    const labels = [];
    for (const reference of labelledBy.split(/\s+/).slice(0, 10)) {
      const referenceRe = new RegExp(
        `<[a-z]+\\b[^>]*\\bid=["']${reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"][^>]*>([\\s\\S]*?)<\\/[a-z]+>`,
        "i"
      );
      const value = referenceRe.exec(formBody)?.[1];
      if (value) labels.push(richText(value));
    }
    const accessibleName = richText(labels.join(" "));
    if (accessibleName) return { label: "", accessibleName, labelSource: "aria-labelledby" };
  }
  const labelRe = /<label\b([^>]*)>([\s\S]*?)<\/label>/gi;
  let labelMatch;
  while ((labelMatch = labelRe.exec(formBody)) !== null) {
    const labelFor = attr(labelMatch[1] ?? "", "for").trim();
    if (id && labelFor === id) {
      const label = richText(labelMatch[2] ?? "");
      return { label, accessibleName: label, labelSource: "label" };
    }
  }
  const placeholder = richText(attr(openTag, "placeholder"));
  if (placeholder) return { label: "", accessibleName: placeholder, labelSource: "placeholder" };
  const name = richText(attr(openTag, "name"), 200);
  if (name) return { label: "", accessibleName: name, labelSource: "name" };
  return { label: "", accessibleName: "", labelSource: "none" };
}
__name(labelForControl, "labelForControl");
function formAction(rawAction, base) {
  const raw = rawAction.trim();
  if (!raw) return { action: "", actionTargetState: "empty" };
  if (raw.length > 2e3) return { action: "", actionTargetState: "invalid" };
  try {
    const resolved = new URL(raw, base);
    const sensitiveQuery = [...resolved.searchParams.keys()].some(
      (key) => /pass(word)?|token|secret|api[-_]?key|auth|credential/i.test(key)
    );
    if (resolved.username || resolved.password || sensitiveQuery) {
      return { action: "", actionTargetState: "redacted" };
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return { action: "", actionTargetState: "invalid" };
    }
    return {
      action: raw,
      actionTargetState: isSameSite(resolved, base) ? "same-site" : "off-site"
    };
  } catch {
    return { action: "", actionTargetState: "invalid" };
  }
}
__name(formAction, "formAction");
function submitLabel(record2) {
  const ariaLabel = richText(attr(record2.openTag, "aria-label"));
  if (ariaLabel) return ariaLabel;
  if (record2.tagName === "input") return richText(attr(record2.openTag, "value"));
  return richText(record2.inner) || richText(attr(record2.openTag, "title"));
}
__name(submitLabel, "submitLabel");
function parseForms(body, base) {
  const out = [];
  const re = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let m;
  while ((m = re.exec(body)) !== null && out.length < MAX_RICH_ITEMS) {
    const formIndex = out.length;
    const openTag = m[1] ?? "";
    const inner = m[2] ?? "";
    const methodRaw = attr(openTag, "method").toUpperCase();
    const controls = controlRecords(inner);
    const submitControls = controls.filter((record2) => {
      if (record2.tagName === "button") {
        const type = attr(record2.openTag, "type").trim().toLowerCase();
        return type === "" || type === "submit";
      }
      if (record2.tagName === "input") {
        return ["submit", "image"].includes(attr(record2.openTag, "type").trim().toLowerCase());
      }
      return false;
    });
    const fields = controls.filter((record2) => ["input", "textarea", "select"].includes(record2.tagName)).slice(0, 50).map((record2, fieldIndex) => {
      const labels = labelForControl(inner, record2.openTag);
      return {
        elementKey: `form:${formIndex}:field:${fieldIndex}`,
        controlType: record2.tagName === "input" ? attr(record2.openTag, "type").trim().toLowerCase().slice(0, 50) || "text" : record2.tagName,
        name: richText(attr(record2.openTag, "name"), 200),
        required: hasAttribute(record2.openTag, "required"),
        autocomplete: attr(record2.openTag, "autocomplete").trim().slice(0, 100) || void 0,
        label: labels.label,
        accessibleName: labels.accessibleName,
        labelSource: labels.labelSource
      };
    });
    const rawAction = attr(openTag, "action");
    const action2 = formAction(rawAction, base);
    const disabledSubmits = submitControls.filter((record2) => hasAttribute(record2.openTag, "disabled"));
    out.push({
      action: action2.action,
      method: methodRaw === "POST" ? "POST" : "GET",
      hasSubmit: submitControls.length > 0,
      fields,
      submitLabel: submitControls[0] ? submitLabel(submitControls[0]) : "",
      actionTargetState: action2.actionTargetState,
      ...submitControls.length > 0 ? {
        submitDisabled: disabledSubmits.length === submitControls.length,
        hasEnabledSubmitAlternative: disabledSubmits.length < submitControls.length
      } : {}
    });
  }
  return out;
}
__name(parseForms, "parseForms");
function isInsideElement(lowerBody, offset, tagName) {
  return lowerBody.lastIndexOf(`<${tagName}`, offset) > lowerBody.lastIndexOf(`</${tagName}>`, offset);
}
__name(isInsideElement, "isInsideElement");
function sourceRegionForOffset(body, lowerBody, offset) {
  if (isInsideElement(lowerBody, offset, "nav")) return "nav";
  if (isInsideElement(lowerBody, offset, "header")) return "header";
  if (isInsideElement(lowerBody, offset, "footer")) return "footer";
  if (isInsideElement(lowerBody, offset, "form")) return "form";
  const sectionStart = Math.max(
    lowerBody.lastIndexOf("<section", offset),
    lowerBody.lastIndexOf("<article", offset)
  );
  const sectionEnd = Math.max(
    lowerBody.lastIndexOf("</section>", offset),
    lowerBody.lastIndexOf("</article>", offset)
  );
  if (sectionStart > sectionEnd) {
    const sectionClose = body.indexOf(">", sectionStart);
    const sectionOpen = body.slice(
      sectionStart,
      sectionClose < 0 ? offset : sectionClose + 1
    );
    const token3 = `${attr(sectionOpen, "id")} ${attr(sectionOpen, "class")}`.toLowerCase();
    if (/hero|banner|masthead/.test(token3)) return "hero";
    if (/proof|testimonial|review|case-study|portfolio/.test(token3)) return "proof";
  }
  if (isInsideElement(lowerBody, offset, "main")) return "main";
  return "page";
}
__name(sourceRegionForOffset, "sourceRegionForOffset");
function safeCtaHref(rawHref, base) {
  const raw = rawHref.trim();
  const scheme = schemeOf(raw);
  if (!scheme) return null;
  if (scheme === "tel") {
    if (raw.includes("?")) return null;
    return raw.length <= 2e3 ? raw : null;
  }
  if (scheme === "mailto") {
    const addressOnly = raw.split("?", 1)[0] ?? "";
    return addressOnly.length <= 2e3 ? addressOnly : null;
  }
  try {
    const resolved = new URL(raw, base);
    const sensitiveQuery = [...resolved.searchParams.keys()].some(
      (key) => /pass(word)?|token|secret|api[-_]?key|auth|credential/i.test(key)
    );
    if (resolved.username || resolved.password || sensitiveQuery || !isSameSite(resolved, base)) {
      return null;
    }
    resolved.hash = "";
    const normalized3 = resolved.toString();
    return normalized3.length <= 2e3 ? normalized3 : null;
  } catch {
    return null;
  }
}
__name(safeCtaHref, "safeCtaHref");
function parseCtas(body, base) {
  const candidates = [];
  const lowerBody = body.toLowerCase();
  let anchorIndex = 0;
  for (const anchor2 of anchorRecords(body)) {
    const href2 = safeCtaHref(anchor2.href, base);
    if (!href2) continue;
    const label = richText(anchor2.inner);
    const accessibleName = richText(anchor2.ariaLabel) || label || richText(anchor2.title);
    candidates.push({
      offset: anchor2.offset,
      cta: {
        elementKey: `cta:anchor:${anchorIndex}`,
        href: href2,
        label,
        accessibleName,
        actionKind: anchor2.href.trim().toLowerCase().startsWith("tel:") || anchor2.href.trim().toLowerCase().startsWith("mailto:") ? "contact" : "navigation",
        // Region classification is deferred until after the output cap. Some
        // cached storefronts contain thousands of anchors, but only the first
        // bounded observations can ever leave this parser.
        sourceRegion: "page",
        geometry: renderedLinkGeometry(anchor2.openTag)
      }
    });
    anchorIndex += 1;
  }
  let buttonIndex = 0;
  for (const button of controlRecords(body).filter((record2) => record2.tagName === "button")) {
    const label = richText(button.inner) || richText(attr(button.openTag, "value"));
    const accessibleName = richText(attr(button.openTag, "aria-label")) || label || richText(attr(button.openTag, "title"));
    const type = attr(button.openTag, "type").trim().toLowerCase();
    candidates.push({
      offset: button.offset,
      implicitSubmit: type === "",
      cta: {
        elementKey: `cta:button:${buttonIndex}`,
        href: "",
        label,
        accessibleName,
        actionKind: type === "submit" ? "submit" : "button",
        sourceRegion: "page",
        geometry: renderedLinkGeometry(button.openTag)
      }
    });
    buttonIndex += 1;
  }
  return candidates.sort((left, right) => left.offset - right.offset).slice(0, MAX_RICH_ITEMS).map(({ cta, offset, implicitSubmit }) => {
    const sourceRegion = sourceRegionForOffset(body, lowerBody, offset);
    return {
      ...cta,
      sourceRegion,
      actionKind: implicitSubmit && sourceRegion === "form" ? "submit" : cta.actionKind
    };
  });
}
__name(parseCtas, "parseCtas");
function parseLandmarks(body) {
  const landmarks = [];
  const counts = /* @__PURE__ */ new Map();
  const semantic = /<(header|nav|main|aside|footer)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = semantic.exec(body)) !== null && landmarks.length < 50) {
    const tag2 = (match[1] ?? "main").toLowerCase();
    const role = {
      header: "header",
      nav: "navigation",
      main: "main",
      aside: "complementary",
      footer: "contentinfo"
    }[tag2];
    const index = counts.get(role) ?? 0;
    counts.set(role, index + 1);
    landmarks.push({
      offset: match.index,
      landmark: {
        elementKey: `landmark:${tag2}:${index}`,
        role,
        label: richText(attr(match[2] ?? "", "aria-label"))
      }
    });
  }
  const roleRe = /<[a-z][^>]*\brole=["'](banner|navigation|main|complementary|contentinfo|search|form|region)["'][^>]*>/gi;
  while ((match = roleRe.exec(body)) !== null && landmarks.length < 50) {
    const role = (match[1] ?? "region").toLowerCase();
    if (["header", "navigation", "main", "complementary", "contentinfo"].includes(role)) continue;
    const index = counts.get(role) ?? 0;
    counts.set(role, index + 1);
    landmarks.push({
      offset: match.index,
      landmark: {
        elementKey: `landmark:${role}:${index}`,
        role,
        label: richText(attr(match[0] ?? "", "aria-label"))
      }
    });
  }
  return landmarks.sort((left, right) => left.offset - right.offset).map(({ landmark }) => landmark);
}
__name(parseLandmarks, "parseLandmarks");
function sectionKind(value) {
  const token3 = value.toLowerCase();
  if (/hero|banner|masthead|welcome/.test(token3)) return "hero";
  if (/service|treatment|solution/.test(token3)) return "services";
  if (/testimonial|review|case-study|portfolio|proof|credential|rating/.test(token3)) return "proof";
  if (/contact|quote|book|appointment/.test(token3)) return "contact";
  if (/faq|frequently asked/.test(token3)) return "faq";
  if (/pricing|price|cost/.test(token3)) return "pricing";
  return "content";
}
__name(sectionKind, "sectionKind");
function parseSections(body) {
  const sections = [];
  const re = /<(section|article)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = re.exec(body)) !== null && sections.length < MAX_RICH_ITEMS) {
    const inner = match[3] ?? "";
    const heading = richText(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(inner)?.[1] ?? "");
    const identity = `${attr(match[2] ?? "", "id")} ${attr(match[2] ?? "", "class")} ${heading}`;
    sections.push({
      offset: match.index,
      section: {
        elementKey: `section:${sections.length}`,
        kind: sectionKind(identity),
        heading,
        textExcerpt: richText(inner)
      }
    });
  }
  return sections.sort((left, right) => left.offset - right.offset).map(({ section: section2 }) => section2);
}
__name(parseSections, "parseSections");
function parseProofSignals(body) {
  const candidates = [];
  const patterns = [
    /<blockquote\b([^>]*)>([\s\S]*?)<\/blockquote>/gi,
    /<(article|section|div)\b([^>]*)>([\s\S]*?)<\/\1>/gi
  ];
  for (const [patternIndex, re] of patterns.entries()) {
    let match;
    while ((match = re.exec(body)) !== null && candidates.length < MAX_RICH_ITEMS) {
      const attributes = patternIndex === 0 ? match[1] ?? "" : match[2] ?? "";
      const inner = patternIndex === 0 ? match[2] ?? "" : match[3] ?? "";
      const token3 = `${attr(attributes, "id")} ${attr(attributes, "class")}`.toLowerCase();
      const kind = token3.includes("testimonial") ? "testimonial" : token3.includes("review") ? "review" : token3.includes("case") || token3.includes("portfolio") ? "case-study" : token3.includes("credential") ? "credential" : token3.includes("guarantee") ? "guarantee" : token3.includes("rating") ? "rating" : token3.includes("logo") ? "logo" : null;
      if (kind) candidates.push({ offset: match.index, kind, text: richText(inner) });
    }
  }
  return candidates.sort((left, right) => left.offset - right.offset).slice(0, MAX_RICH_ITEMS).map((candidate, index) => ({ sourceKey: `proof:${index}`, kind: candidate.kind, text: candidate.text }));
}
__name(parseProofSignals, "parseProofSignals");
function parseContactFacts(body, structured) {
  const facts = [...structured.contactFacts];
  const add = /* @__PURE__ */ __name((kind, value, sourceKey, origin) => {
    const bounded3 = richText(value);
    if (!bounded3 || facts.length >= MAX_RICH_ITEMS || facts.some((fact) => fact.kind === kind && fact.value === bounded3)) return;
    facts.push({ sourceKey, kind, value: bounded3, origin });
  }, "add");
  for (const anchor2 of anchorRecords(body)) {
    const href2 = anchor2.href.trim();
    if (href2.toLowerCase().startsWith("tel:")) add("phone", normalisedPhone(href2.slice(4)), `link:phone:${facts.length}`, "action_target");
    if (href2.toLowerCase().startsWith("mailto:")) add("email", normalisedEmail(href2.slice(7).split("?", 1)[0] ?? ""), `link:email:${facts.length}`, "action_target");
  }
  const text = clean(body);
  const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  let match;
  while ((match = emailRe.exec(text)) !== null) add("email", normalisedEmail(match[0] ?? ""), `text:email:${match.index}`, "visible_text");
  const phoneRe = /(?:\+?\d[\d().\s-]{7,}\d)/g;
  while ((match = phoneRe.exec(text)) !== null) {
    const raw = match[0] ?? "";
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(raw.trim())) continue;
    add("phone", normalisedPhone(raw), `text:phone:${match.index}`, "visible_text");
  }
  const addressRe = /<address\b[^>]*>([\s\S]*?)<\/address>/gi;
  while ((match = addressRe.exec(body)) !== null) add("address", match[1] ?? "", `address:${match.index}`, "visible_text");
  return facts.slice(0, MAX_RICH_ITEMS);
}
__name(parseContactFacts, "parseContactFacts");
function parseDateFacts(body, structured) {
  const facts = [...structured.datedFacts];
  const re = /<time\b([^>]*)>([\s\S]*?)<\/time>/gi;
  let match;
  while ((match = re.exec(body)) !== null && facts.length < MAX_RICH_ITEMS) {
    const value = normalisedDate(attr(match[1] ?? "", "datetime") || clean(match[2] ?? ""));
    if (value) facts.push({ sourceKey: `time:${match.index}`, kind: "event", value });
  }
  return facts.slice(0, MAX_RICH_ITEMS);
}
__name(parseDateFacts, "parseDateFacts");
function parseAccessibility(images, ctas, forms) {
  const observations = [];
  images.forEach((image, index) => {
    if (image.alt === void 0) observations.push({ elementKey: `image:${index}`, issue: "missing-alt", source: "parsed" });
  });
  ctas.forEach((cta) => {
    if (!cta.accessibleName) observations.push({ elementKey: cta.elementKey, issue: "missing-accessible-name", source: "parsed" });
  });
  forms.forEach((form) => {
    form.fields.forEach((field) => {
      if (!field.accessibleName) {
        observations.push({ elementKey: field.elementKey, issue: "missing-label", source: "parsed" });
      } else if (field.labelSource === "label" && !field.label) {
        observations.push({ elementKey: field.elementKey, issue: "empty-label", source: "parsed" });
      }
    });
  });
  return observations.slice(0, 200);
}
__name(parseAccessibility, "parseAccessibility");
function parseHtml(html2, url, excerptLength = TEXT_EXCERPT_LENGTH) {
  const metaDescription = extractMetaDescription(html2);
  const structuredData = extractStructuredData(html2);
  const images = extractImages(html2);
  const body = html2.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ").replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const title2 = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? "");
  const h1s = captures(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, body).map(clean).filter(Boolean);
  const headings = captures(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi, body).map(clean).filter(Boolean);
  const navBlocks = [
    ...captures(/<nav\b[^>]*>([\s\S]*?)<\/nav>/gi, body),
    ...captures(/<[a-z]+\b[^>]*\brole=["']navigation["'][^>]*>([\s\S]*?)<\/[a-z]+>/gi, body)
  ];
  const navHrefs = /* @__PURE__ */ new Set();
  const serviceNavHrefs = serviceNavigationHrefs(body);
  const navSet = /* @__PURE__ */ new Set();
  for (const block of navBlocks) {
    for (const a of anchorRecords(block)) {
      const label = clean(a.inner) || a.ariaLabel || a.title;
      if (label) navSet.add(label);
      navHrefs.add(a.href);
    }
  }
  const base = new URL(url);
  const byKey = /* @__PURE__ */ new Map();
  const offSiteHttpLinks = /* @__PURE__ */ new Set();
  for (const a of anchorRecords(body)) {
    const scheme = schemeOf(a.href);
    if (!scheme) continue;
    const label = clean(a.inner);
    const renderedGeometry = renderedLinkGeometry(a.openTag);
    if (scheme === "tel" || scheme === "mailto") {
      const safeHref = a.href.trim().split("?", 1)[0] ?? "";
      if (!safeHref) continue;
      const key2 = `${scheme}:${safeHref}`;
      const existing2 = byKey.get(key2);
      if (!existing2) {
        byKey.set(key2, {
          href: safeHref,
          label,
          ariaLabel: a.ariaLabel,
          title: a.title,
          scheme,
          inNav: navHrefs.has(a.href),
          inServiceNav: serviceNavHrefs.has(a.href),
          renderedGeometry
        });
      } else if (!existing2.label && label) {
        existing2.label = label;
        existing2.renderedGeometry = mergeRenderedGeometry(existing2.renderedGeometry, renderedGeometry);
      } else {
        existing2.renderedGeometry = mergeRenderedGeometry(existing2.renderedGeometry, renderedGeometry);
      }
      continue;
    }
    const raw = a.href.split("#")[0]?.trim();
    if (!raw) continue;
    let resolved;
    try {
      resolved = new URL(raw, base);
    } catch {
      continue;
    }
    if (resolved.username || resolved.password) continue;
    if (!/^https?:$/.test(resolved.protocol)) continue;
    if (!isSameSite(resolved, base)) {
      resolved.search = "";
      resolved.hash = "";
      offSiteHttpLinks.add(resolved.toString());
      continue;
    }
    const key = resolved.toString();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        href: key,
        label,
        ariaLabel: a.ariaLabel,
        title: a.title,
        scheme: "http",
        inNav: navHrefs.has(a.href),
        inServiceNav: serviceNavHrefs.has(a.href),
        renderedGeometry
      });
    } else {
      if (!existing.label && label) existing.label = label;
      if (!existing.ariaLabel && a.ariaLabel) existing.ariaLabel = a.ariaLabel;
      if (!existing.title && a.title) existing.title = a.title;
      if (navHrefs.has(a.href)) existing.inNav = true;
      if (serviceNavHrefs.has(a.href)) existing.inServiceNav = true;
      existing.renderedGeometry = mergeRenderedGeometry(existing.renderedGeometry, renderedGeometry);
    }
  }
  const text = clean(body);
  const wordCount = text ? text.split(/\s+/).length : 0;
  const links2 = [...byKey.values()];
  const forms = parseForms(body, base);
  const ctas = parseCtas(body, base);
  return {
    page: {
      url,
      title: title2,
      h1s,
      headings,
      textExcerpt: text.slice(0, Math.min(8e3, Math.max(0, excerptLength))),
      wordCount,
      forms,
      metaDescription,
      structuredDataTypes: structuredData.types,
      structuredDataPresent: structuredData.present,
      images,
      ctas,
      landmarks: parseLandmarks(body),
      sections: parseSections(body),
      proofSignals: parseProofSignals(body),
      contactFacts: parseContactFacts(body, structuredData),
      datedFacts: parseDateFacts(body, structuredData),
      accessibility: parseAccessibility(images, ctas, forms)
    },
    nav: [...navSet],
    links: links2,
    sameSiteLinks: links2.filter((l) => l.scheme === "http").map((l) => l.href),
    offSiteHttpLinks: [...offSiteHttpLinks]
  };
}
__name(parseHtml, "parseHtml");
