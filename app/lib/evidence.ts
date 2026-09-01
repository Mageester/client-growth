import type { ConversionDefect, Opportunity, Verification } from "@/core/schema";

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
  kind: "inspected" | "near-miss" | "nav" | "defect" | "sitemap";
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

function defectItem(defect: ConversionDefect): EvidenceItem {
  const kindNote: Record<ConversionDefect["kind"], string> = {
    "dead-conversion-link": "This call-to-action links somewhere that does not load.",
    "conversion-page-error": "The page this path leads to returns an error.",
    "malformed-tel": "This click-to-call link is not a dialable number.",
    "broken-form-target": "This form submits to a target that does not accept it.",
  };
  const status =
    defect.observedStatus && defect.observedStatus > 0
      ? ` Returned HTTP ${defect.observedStatus}.`
      : "";
  const element = defect.elementText ? `“${defect.elementText}” — ` : "";
  return {
    title: element + titleFromUrl(defect.pageUrl),
    url: defect.pageUrl,
    note: kindNote[defect.kind] + status + (defect.note ? ` ${defect.note}` : ""),
    kind: "defect",
  };
}

/**
 * Build the readable case. Ordering is deliberate: the concrete defect first
 * (it is the strongest single fact), then pages actually fetched to confirm,
 * then the near-misses that were considered and ruled out, then navigation.
 */
export function buildEvidenceCase(opp: Opportunity): EvidenceCase {
  const primary: EvidenceItem[] = [];
  const secondary: EvidenceItem[] = [];
  const seen = new Set<string>();

  const push = (bucket: EvidenceItem[], item: EvidenceItem) => {
    const key = item.kind + "|" + (item.url ?? item.title);
    if (seen.has(key)) return;
    seen.add(key);
    bucket.push(item);
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

  const pageRefs = opp.evidenceRefs.filter((ref) => !ref.startsWith("nav:"));
  for (const ref of pageRefs) {
    push(primary.length < 4 ? primary : secondary, {
      title: titleFromUrl(ref),
      url: ref,
      note: "Read during the analysis.",
      kind: "inspected",
    });
  }

  for (const match of verification?.closeMatches ?? []) {
    push(secondary, {
      title: match.value || WHERE_LABEL[match.where],
      url: match.url ?? null,
      note: `${WHERE_LABEL[match.where]} — ${match.reason}`,
      kind: match.where === "sitemap-url" ? "sitemap" : "near-miss",
    });
  }

  const navRefs = opp.evidenceRefs
    .filter((ref) => ref.startsWith("nav:"))
    .map((ref) => ref.slice(4))
    .filter(Boolean);
  if (navRefs.length > 0) {
    push(secondary, {
      title: navRefs.join(" · "),
      url: null,
      note: `Site navigation was checked for this offering and did not list it.`,
      kind: "nav",
    });
  }

  const inspectedCount = new Set(
    [...inspected, ...pageRefs, ...(opp.conversionDefect ? [opp.conversionDefect.pageUrl] : [])],
  ).size;

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
