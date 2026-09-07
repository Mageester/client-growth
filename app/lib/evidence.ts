import type { ConversionDefect, Opportunity, Verification } from "@/core/schema";
import { isDefectRef, isPageRef, parseEvidenceRef } from "@/core/evidenceRef";
import { crawlKey } from "@/adapters/evidence/urlPolicy";

/**
 * Turns the raw provenance stored on an opportunity into something an agency
 * owner can read.
 *
 * The engine records exactly what it inspected — URLs, nav labels, near-miss
 * page titles, probed HTTP statuses. Rendering that verbatim reads like a log
 * file, which makes trustworthy evidence *look* untrustworthy. Nothing here
 * invents or softens a fact; it only groups, labels and orders what is already
 * recorded, and every item keeps its link so the full detail stays one click away.
 */

/** A readable label for a URL: the path, or the host for a bare origin. */
export function readableUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, "");
    const query = url.search ? url.search : "";
    if (!path || path === "") return url.host;
    return path + query;
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
}

/** Host only, for grouping and for the secondary line under a link. */
export function hostOf(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    return raw.replace(/^https?:\/\//, "").split("/")[0] ?? raw;
  }
}

/**
 * A page path turned into words: "/services/heat-pump-install" ->
 * "Services / Heat pump install". Used as the human title of an evidence item
 * when we have no page <title> stored for it.
 */
export function titleFromUrl(raw: string): string {
  const label = readableUrl(raw);
  if (!label) return "";
  // A bare origin is the home page; showing the host again tells the reader
  // nothing they cannot see in the URL line beneath it.
  if (!label.startsWith("/")) return label === hostOf(raw) ? "Home page" : label;
  const segments = label
    .replace(/\?.*$/, "")
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      segment
        .replace(/\.(html?|php|aspx?)$/i, "")
        .replace(/[-_]+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  if (segments.length === 0) return "Home page";
  const words = segments.map(
    (segment) => segment.charAt(0).toUpperCase() + segment.slice(1),
  );
  return words.join(" / ");
}

export interface EvidenceItem {
  /** Human title, e.g. "Services / Heat pump install". */
  title: string;
  /** The URL, when this item is a page we actually fetched. */
  url: string | null;
  /** Short statement of what this page contributed to the finding. */
  note: string;
  kind: "inspected" | "near-miss" | "nav" | "defect" | "sitemap" | "external";
}

export interface EvidenceCase {
  /** One sentence describing the strength and shape of the evidence. */
  headline: string;
  /** The items worth showing first. */
  primary: EvidenceItem[];
  /** Everything else, shown behind a disclosure. */
  secondary: EvidenceItem[];
  /** Total inspected URLs, for the "we checked N pages" line. */
  inspectedCount: number;
}

const WHERE_LABEL: Record<Verification["closeMatches"][number]["where"], string> = {
  "crawled-page": "Page read during the crawl",
  "page-title": "Page title",
  heading: "Heading on the site",
  "nav-label": "Navigation label",
  "link-label": "Link text",
  "link-href": "Link address",
  "sitemap-url": "Sitemap entry",
  "fetched-page": "Page fetched to confirm",
};

/** What the visitor loses, per defect kind. The consequence, not the mechanism. */
const DEFECT_IMPACT: Record<ConversionDefect["kind"], string> = {
  "dead-conversion-link": "Anyone who clicks it never reaches the page.",
  "conversion-page-error": "Visitors cannot reach this page at all.",
  "malformed-tel": "Tapping it on a phone does not start a call.",
  "broken-form-target": "Enquiries submitted through it are not delivered.",
};

function defectItem(defect: ConversionDefect): EvidenceItem {
  // The rule's own note is the specific fact; the impact line says why it
  // matters. Restating the mechanism a third time (a generic kind sentence, the
  // status, and the note) read as padding and made the evidence look generated.
  const fact = defect.note
    ? defect.note.charAt(0).toUpperCase() + defect.note.slice(1)
    : "This conversion element is broken";
  const status =
    defect.observedStatus &&
    defect.observedStatus > 0 &&
    !defect.note.includes(String(defect.observedStatus))
      ? ` Returned HTTP ${defect.observedStatus}.`
      : "";
  const element = defect.elementText ? `“${defect.elementText}” — ` : "";
  return {
    title: element + titleFromUrl(defect.pageUrl),
    url: defect.pageUrl,
    note: `${fact}.${status} ${DEFECT_IMPACT[defect.kind]}`,
    kind: "defect",
  };
}

/**
 * Build the readable case.
 *
 * Ordering is deliberate: the concrete defect first (it is the strongest single
 * fact), then pages actually fetched to confirm, then the near-misses that were
 * considered and ruled out, then navigation.
 *
 * One URL appears at most once. When the same page is both fetched and a
 * near-miss, the near-miss reasoning is merged into that page's note rather than
 * dropped — losing "and here is why it did not count" would weaken the case,
 * while repeating the URL would make curated provenance look like a log dump.
 */
export function buildEvidenceCase(opp: Opportunity): EvidenceCase {
  const primary: EvidenceItem[] = [];
  const secondary: EvidenceItem[] = [];
  const byUrl = new Map<string, EvidenceItem>();
  const seenLabels = new Set<string>();

  const push = (bucket: EvidenceItem[], item: EvidenceItem): EvidenceItem | null => {
    if (item.url) {
      const key = crawlKey(item.url);
      const existing = byUrl.get(key);
      if (existing) return existing;
      byUrl.set(key, item);
    } else {
      const key = item.kind + "|" + item.title;
      if (seenLabels.has(key)) return null;
      seenLabels.add(key);
    }
    bucket.push(item);
    return item;
  };

  if (opp.conversionDefect) push(primary, defectItem(opp.conversionDefect));

  const verification = opp.verification;
  const inspected = verification?.inspectedUrls ?? [];
  for (const url of inspected) {
    push(primary, {
      title: titleFromUrl(url),
      url,
      note: "Fetched during the check and did not cover this offering.",
      kind: "inspected",
    });
  }

  // Only refs that name a page become page items. `element:` / `target:` /
  // `status:` describe the defect itself and are already stated by the defect
  // item above — repeating them here produced a dead `href="status:404"` link
  // and inflated the "pages checked" count with things that are not pages.
  const parsed = opp.evidenceRefs.map(parseEvidenceRef);
  for (const ref of parsed) {
    if (ref.kind === "external" && ref.url) {
      push(primary, {
        title: "Official business profile",
        url: ref.url,
        note: "Owner-authorized external evidence used to identify this service.",
        kind: "external",
      });
      continue;
    }
    if (ref.kind === "nav" || isDefectRef(ref)) continue;
    if (!isPageRef(ref) || !ref.url) continue;
    push(primary.length < 4 ? primary : secondary, {
      title: titleFromUrl(ref.url),
      url: ref.url,
      note:
        ref.kind === "verified"
          ? "Fetched during the check and did not cover this offering."
          : ref.kind === "considered"
            ? "Considered as a near match and ruled out."
            : "Read during the analysis.",
      kind: ref.kind === "considered" ? "near-miss" : "inspected",
    });
  }

  for (const match of verification?.closeMatches ?? []) {
    const note = `${WHERE_LABEL[match.where]} — ${match.reason}`;
    const item: EvidenceItem = {
      title: match.value || WHERE_LABEL[match.where],
      url: match.url ?? null,
      note,
      kind: match.where === "sitemap-url" ? "sitemap" : "near-miss",
    };
    const existing = push(secondary, item);
    // The URL was already listed: keep the page in place and fold this
    // near-miss's reasoning into it, so no reasoning is lost to deduplication.
    if (existing && existing !== item) {
      const detail = `“${item.title}” — ${match.reason}`;
      if (!existing.note.includes(detail)) existing.note = `${existing.note} ${detail}`;
    }
  }

  const navRefs = parsed
    .filter((ref) => ref.kind === "nav")
    .map((ref) => ref.value)
    .filter(Boolean);
  if (navRefs.length > 0) {
    push(secondary, {
      title: navRefs.join(" · "),
      url: null,
      note: "Site navigation was checked for this offering and did not list it.",
      kind: "nav",
    });
  }

  const inspectedCount = [...byUrl.values()].filter((item) => item.kind !== "external").length;
  return {
    headline: headlineFor(opp, inspectedCount, verification),
    primary: primary.slice(0, 4),
    secondary: [...primary.slice(4), ...secondary],
    inspectedCount,
  };
}

function headlineFor(
  opp: Opportunity,
  inspectedCount: number,
  verification: Verification | undefined,
): string {
  const pages = `${inspectedCount} ${inspectedCount === 1 ? "page" : "pages"}`;
  if (opp.conversionDefect) {
    return `A specific broken element was found and its target was probed directly across ${pages}.`;
  }
  if (verification?.conclusion === "absent") {
    const considered = verification.closeMatches.length;
    return considered > 0
      ? `${pages} checked and ${considered} near-${considered === 1 ? "match was" : "matches were"} ruled out before calling this a gap.`
      : `${pages} checked, with no page covering this offering.`;
  }
  return `Based on ${pages} read during the last analysis.`;
}
