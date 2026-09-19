// src/core/claimBinding.ts
var SHARED_TARGET_ASSERTION = /\b(?:point(?:s|ed|ing)?\s+(?:at|to|back)|lead(?:s|ing)?\s+to|go(?:es|ing)?\s+to|link(?:s|ed|ing)?\s+to|return(?:s|ing)?\s+(?:the\s+visitor\s+)?to|send(?:s|ing)?\s+(?:the\s+visitor\s+)?to|take(?:s|ing)?\s+(?:the\s+visitor\s+)?to|target(?:s|ed|ing)?)\b/i;
var UNIVERSAL_QUANTIFIER = /\b(?:all|both|every|each|together\s+with)\b/i;
var DIFFERENCE_MARKER = /\b(?:different|distinct|differ(?:s|ing)?|vary|varies|various|separate)\b/i;
var MIN_LABEL_LENGTH = 3;
function normalizeTarget2(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return trimmed.toLowerCase();
    return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}${url.search}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}
__name(normalizeTarget2, "normalizeTarget");
function escapeRegExp2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
__name(escapeRegExp2, "escapeRegExp");
function namesControl(statement, control) {
  const label = control.label.trim();
  if (label.length < MIN_LABEL_LENGTH) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp2(label)}([^\\p{L}\\p{N}]|$)`, "iu").test(
    statement
  );
}
__name(namesControl, "namesControl");
function boundControlsFrom(evidenceIds, byId) {
  const controls = [];
  const seen = /* @__PURE__ */ new Set();
  for (const id of evidenceIds) {
    const row = byId.get(id);
    if (!row || row.kind !== "element") continue;
    const payload = row.payload;
    const observationType = typeof payload?.observationType === "string" ? payload.observationType : "";
    if (observationType !== "cta") continue;
    const elementKey = typeof payload?.elementKey === "string" ? payload.elementKey : "";
    const pageUrl = (row.pageUrl ?? "").trim();
    const identity = `${pageUrl}|${elementKey || parseEvidenceRef(row.locator).value}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const label = typeof payload?.label === "string" && payload.label.trim() || typeof payload?.accessibleName === "string" && payload.accessibleName.trim() || "";
    controls.push({
      evidenceId: id,
      pageUrl,
      label,
      target: normalizeTarget2(typeof payload?.href === "string" ? payload.href : ""),
      elementKey
    });
  }
  return controls;
}
__name(boundControlsFrom, "boundControlsFrom");
function pageLabel(url) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/" || parsed.pathname === "") return "the home page";
    return `the page at ${parsed.pathname}`;
  } catch {
    return url;
  }
}
__name(pageLabel, "pageLabel");
function listOf(values) {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}
__name(listOf, "listOf");
function verifyControlEnumeration(input) {
  const statement = input.statement.trim();
  if (!statement) return { kind: "not_an_enumeration" };
  if (!SHARED_TARGET_ASSERTION.test(statement)) return { kind: "not_an_enumeration" };
  if (!UNIVERSAL_QUANTIFIER.test(statement)) return { kind: "not_an_enumeration" };
  if (DIFFERENCE_MARKER.test(statement)) return { kind: "not_an_enumeration" };
  const named = input.controls.filter((control) => namesControl(statement, control));
  if (named.length < 2) return { kind: "not_an_enumeration" };
  const byTarget = /* @__PURE__ */ new Map();
  for (const control of named) {
    const key = control.target || "(no destination recorded)";
    byTarget.set(key, [...byTarget.get(key) ?? [], control]);
  }
  if (byTarget.size <= 1) return { kind: "consistent" };
  const groups = [...byTarget.entries()].sort(
    (left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0])
  );
  const [primaryTarget, primaryControls] = groups[0];
  const others = groups.slice(1);
  const scope = input.scopeUrl ? pageLabel(input.scopeUrl) : "";
  const otherText = listOf(
    others.map(([target, controls]) => {
      const labels = [...new Set(controls.map((control) => control.label).filter(Boolean))];
      const named2 = labels.length > 0 ? ` (${labels.map((label) => `\u201C${label}\u201D`).join(", ")})` : "";
      return `${target}${named2}`;
    })
  );
  const statementOut = `${scope ? `On ${scope}, ` : "On the affected page, "}${primaryControls.length} of the ${named.length} controls this evidence records target ${primaryTarget}; the remaining ${named.length - primaryControls.length} target ${otherText}.`;
  const whyOut = `A visitor following the ${primaryControls.length} controls that share a destination cannot reach what those controls advertise. The remaining ${named.length - primaryControls.length} control${named.length - primaryControls.length === 1 ? "" : "s"} lead elsewhere and are not part of that condition.`;
  return {
    kind: "contradicted",
    statement: statementOut,
    whyItMatters: whyOut,
    detail: `The proposed wording grouped the controls under one destination, but the evidence bound to it records ${byTarget.size} destinations: ${listOf(
      groups.map(([target, controls]) => `${target} (${controls.length})`)
    )}.`
  };
}
__name(verifyControlEnumeration, "verifyControlEnumeration");
