import type { Candidate, ConversionDefect, EvidenceLink } from "@/core/schema";
import type { RuleContext } from "@/core/rules/context";
import {
  classifyConversionLink,
  isPlaceholderTarget,
  telDefect,
  type ConversionIntent,
} from "@/core/conversionIntent";
import { crawlKey, normalizeAndValidateUrl, normalizeOrigin } from "@/adapters/evidence/urlPolicy";
import { serviceForRule } from "@/core/rules/registry";
import { uniquePages } from "@/core/rules/technical";

/**
 * broken-conversion-path
 *
 * Surfaces a conversion element that is DETERMINISTICALLY broken:
 *  - a conversion CTA link whose same-origin target returns a definite dead
 *    status (404 / 410, GET 405, or repeat-confirmed 500/502/503)
 *  - the contact / quote / booking page itself returning such a status
 *  - a `tel:` CTA that is not a dialable number
 *  - a `<form>` action that is an obvious placeholder, or (GET forms only) a
 *    same-origin action that returns 404 / 410 / repeat-confirmed 5xx
 *  - an EXTERNAL booking/quote link that contains an obvious placeholder target
 *
 * Never surfaced: 403 / 429 / bot-challenge / timeout / status 0 (inconclusive);
 * `action="#"` or empty-action forms (JS-handled, unverifiable); POST form
 * actions probed as breakage; arbitrary external providers.
 *
 * The defect is established before any AI. DeepSeek only judges/explains.
 */

const CONVERSION_FIX_TAG = "conversion-fix";
const REPEAT_5XX = new Set([500, 502, 503]);

/**
 * How each conversion intent is named to a human. The raw intent key reads as
 * jargon in a finding an agency shows a client ("book link returns HTTP 404"),
 * so nothing user-visible is built from the key itself.
 */
const INTENT_WORD: Record<ConversionIntent, string> = {
  contact: "contact link",
  quote: "quote request button",
  book: "booking button",
  call: "click-to-call link",
};

const INTENT_PAGE: Record<ConversionIntent, string> = {
  contact: "contact page",
  quote: "quote request page",
  book: "booking page",
  call: "call page",
};

function toOrigin(domain: string): string | null {
  const parsed = normalizeOrigin(domain);
  return parsed.ok ? parsed.url.origin : null;
}

function normalizeTarget(target: string): string | null {
  const parsed = normalizeAndValidateUrl(target);
  return parsed.ok ? parsed.url.toString() : null;
}

/** Definite "this link is dead" statuses. 405 counts for a clickable link. */
function isDeadLinkStatus(status: number): boolean {
  return status === 404 || status === 410 || status === 405;
}
/** Form actions: 405 must NOT count (server just disallows the method here). */
function isDeadFormStatus(status: number): boolean {
  return status === 404 || status === 410;
}

function confidenceFor(kind: ConversionDefect["kind"], status?: number): number {
  if (kind === "malformed-tel") return 0.9;
  if (kind === "broken-form-target") return status === undefined ? 0.9 : 0.85;
  if (kind === "conversion-page-error") return status && status >= 500 ? 0.75 : 0.85;
  // dead-conversion-link
  if (status === undefined) return 0.9; // external placeholder
  if (status === 404 || status === 410) return 0.85;
  if (status === 405) return 0.75;
  return 0.75; // repeat-confirmed 5xx
}

function elementLabel(link: EvidenceLink): string {
  return link.label || link.ariaLabel || link.title || "(unlabelled)";
}

export async function brokenConversionPathRule(ctx: RuleContext): Promise<Candidate[]> {
  const service = serviceForRule(ctx.catalog, CONVERSION_FIX_TAG);
  if (!service) return [];

  const origin = toOrigin(ctx.client.domain);
  if (!origin) return [];
  const probe = ctx.probe;
  const budget = ctx.probeBudget ?? { remaining: 8 };
  const pages = uniquePages(ctx.evidence.site.pages);
  const pageByUrl = new Map(
    pages.map((p) => [crawlKey(normalizeTarget(p.url) ?? p.url), p]),
  );
  const defects: ConversionDefect[] = [];
  const seenKeys = new Set<string>();

  const add = (d: ConversionDefect) => {
    const key = `${d.kind}:${d.target ?? d.elementHref}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    defects.push(d);
  };

  /** One extra probe to reject transient 5xx. */
  const confirm5xx = async (url: string): Promise<boolean> => {
    if (!probe || budget.remaining <= 0) return false;
    budget.remaining--;
    const r = await probe(url);
    return REPEAT_5XX.has(r.status);
  };

  // ---- 1. malformed tel: CTAs (no network) --------------------------------
  for (const link of ctx.evidence.site.links) {
    if (link.scheme !== "tel") continue;
    if (telDefect(link.href) !== "malformed") continue;
    add({
      kind: "malformed-tel",
      pageUrl: link.foundOn[0] ?? origin,
      elementText: elementLabel(link),
      elementHref: link.href,
      seenOn: link.foundOn,
      note: "the click-to-call link is not a dialable phone number",
    });
  }

  // ---- 2. form actions ---------------------------------------------------
  for (const page of pages) {
    for (const form of page.forms) {
      const action = form.action.trim();
      if (!action || action === "#") continue; // JS-handled -> unverifiable

      let target: string;
      try {
        target = new URL(action, page.url).toString();
      } catch {
        continue;
      }

      const normalizedTarget = normalizeTarget(target);
      if (!normalizedTarget) continue;
      target = normalizedTarget;

      if (isPlaceholderTarget(action) || isPlaceholderTarget(target)) {
        add({
          kind: "broken-form-target",
          pageUrl: page.url,
          elementText: "form",
          elementHref: action,
          target,
          seenOn: [page.url],
          note: "the enquiry form submits to an unconfigured placeholder address",
        });
        continue;
      }

      const external = new URL(target).origin !== origin;
      // Only same-origin GET actions may be probed. POST actions are never
      // submitted or probed for breakage. External non-placeholder actions are
      // out of scope for V0.
      if (external || form.method !== "GET" || !probe || budget.remaining <= 0) continue;

      budget.remaining--;
      const r = await probe(target);
      if (isDeadFormStatus(r.status)) {
        add({
          kind: "broken-form-target",
          pageUrl: page.url,
          elementText: "form",
          elementHref: action,
          target,
          observedStatus: r.status,
          seenOn: [page.url],
          note: `the enquiry form submits to an address that returns HTTP ${r.status}`,
        });
      } else if (REPEAT_5XX.has(r.status) && (await confirm5xx(target))) {
        add({
          kind: "broken-form-target",
          pageUrl: page.url,
          elementText: "form",
          elementHref: action,
          target,
          observedStatus: r.status,
          seenOn: [page.url],
          note: `the enquiry form submits to an address that returns HTTP ${r.status} (confirmed)`,
        });
      }
    }
  }

  // ---- 3+4. conversion CTA links --------------------------------------------
  // Dedupe conversion links by resolved target; keep the first link + merge
  // the pages they were found on.
  const targets = new Map<string, { link: EvidenceLink; intent: ConversionIntent }>();
  for (const link of ctx.evidence.site.links) {
    if (link.scheme !== "http") continue;
    const target = normalizeTarget(link.href);
    if (!target) continue;
    const intent = classifyConversionLink({ ...link, href: target });
    if (!intent) continue;
    const key = crawlKey(target);
    const existing = targets.get(key);
    if (!existing) {
      targets.set(key, { link: { ...link, href: target, foundOn: [...link.foundOn] }, intent });
    } else {
      existing.link.foundOn = [...new Set([...existing.link.foundOn, ...link.foundOn])];
    }
  }

  for (const [target, { link, intent }] of targets) {
    const external = new URL(target).origin !== origin;

    if (external) {
      if (isPlaceholderTarget(target)) {
        add({
          kind: "dead-conversion-link",
          pageUrl: link.foundOn[0] ?? origin,
          elementText: elementLabel(link),
          elementHref: link.href,
          target,
          seenOn: link.foundOn,
          note: `the ${INTENT_WORD[intent]} points to an unconfigured external placeholder`,
        });
      }
      continue; // never probe arbitrary external providers
    }

    // Same-origin. Prefer the crawled status if we already have it.
    const crawled = pageByUrl.get(crawlKey(target));
    if (crawled) {
      if (crawled.status < 400) continue; // healthy
      if (isDeadLinkStatus(crawled.status)) {
        add(deadLink(link, intent, target, crawled.status));
      } else if (REPEAT_5XX.has(crawled.status) && (await confirm5xx(target))) {
        add(deadLink(link, intent, target, crawled.status));
      }
      continue;
    }

    if (!probe || budget.remaining <= 0) continue;
    budget.remaining--;
    const r = await probe(target);
    if (isDeadLinkStatus(r.status)) {
      add(deadLink(link, intent, target, r.status));
    } else if (REPEAT_5XX.has(r.status) && (await confirm5xx(target))) {
      add(deadLink(link, intent, target, r.status));
    }
    // 0 / 401 / 403 / 429 / 999 / 2xx / 3xx-ok -> inconclusive or healthy: skip
  }

  // ---- also: a crawled conversion page that errored, even if no CTA links to it
  for (const page of ctx.evidence.site.pages) {
    if (page.status < 400) continue;
    const target = normalizeTarget(page.url);
    if (!target || new URL(target).origin !== origin) continue;
    if (targets.has(crawlKey(target))) continue; // already handled as a link target
    // Is this URL a conversion page by its own path?
    const asLink: EvidenceLink = {
      href: target,
      label: "",
      ariaLabel: "",
      title: "",
      scheme: "http",
      inNav: false,
      inServiceNav: false,
      foundOn: [target],
    };
    const intent = classifyConversionLink(asLink);
    if (!intent) continue;
    if (isDeadLinkStatus(page.status)) {
      add({
        kind: "conversion-page-error",
        pageUrl: target,
        elementText: INTENT_PAGE[intent],
        elementHref: target,
        target,
        observedStatus: page.status,
        seenOn: [target],
        note: `the ${INTENT_PAGE[intent]} returns HTTP ${page.status}`,
      });
    } else if (REPEAT_5XX.has(page.status) && (await confirm5xx(target))) {
      add({
        kind: "conversion-page-error",
        pageUrl: target,
        elementText: INTENT_PAGE[intent],
        elementHref: target,
        observedStatus: page.status,
        seenOn: [target],
        note: `the ${INTENT_PAGE[intent]} returns HTTP ${page.status} (confirmed)`,
      });
    }
  }

  return defects.map((d) => toCandidate(d, service.id));
}

function deadLink(
  link: EvidenceLink,
  intent: ConversionIntent,
  target: string,
  status: number,
): ConversionDefect {
  return {
    kind: "dead-conversion-link",
    pageUrl: link.foundOn[0] ?? "",
    elementText: elementLabel(link),
    elementHref: link.href,
    target,
    observedStatus: status,
    seenOn: link.foundOn,
    note: `the ${INTENT_WORD[intent]} links to an address that returns HTTP ${status}`,
  };
}

function toCandidate(d: ConversionDefect, serviceId: string): Candidate {
  const also =
    d.seenOn.length > 1 ? ` Appears on ${d.seenOn.length} pages.` : "";

  let detected: string;
  switch (d.kind) {
    case "malformed-tel":
      detected = `The click-to-call link on ${d.pageUrl} uses href="${d.elementHref}", which will not dial on a phone.${also}`;
      break;
    case "broken-form-target":
      detected = d.observedStatus
        ? `The form on ${d.pageUrl} submits (GET) to ${d.target}, which returns HTTP ${d.observedStatus}.`
        : `The form on ${d.pageUrl} submits to "${d.elementHref}", an unconfigured placeholder target.`;
      break;
    case "conversion-page-error":
      detected = `The ${d.elementText} (${d.pageUrl}) returns HTTP ${d.observedStatus} — visitors cannot reach it.`;
      break;
    default:
      detected = d.observedStatus
        ? `The "${d.elementText}" ${d.kind === "dead-conversion-link" ? "conversion button" : "element"} on ${d.pageUrl} links to ${d.target}, which returns HTTP ${d.observedStatus}.${also}`
        : `The "${d.elementText}" conversion button on ${d.pageUrl} points to an unconfigured placeholder URL (${d.target}).${also}`;
  }

  // The broken element itself is cited, not just the pages it sits on. Without
  // it a defect whose proof IS its href — a malformed `tel:` with no target and
  // no status — carried a single ref and was dropped by the evidence threshold,
  // so the identical defect surfaced or vanished purely on how many pages the
  // link happened to appear on.
  const evidenceRefs = [
    ...d.seenOn.map((u) => `page:${u}`),
    ...(d.elementHref ? [`element:${d.elementHref}`] : []),
    ...(d.target ? [`target:${d.target}`] : []),
    ...(d.observedStatus !== undefined ? [`status:${d.observedStatus}`] : []),
  ];

  return {
    ruleId: "broken-conversion-path",
    subject: `${d.kind}:${d.target ?? d.elementHref}`,
    detected,
    evidenceRefs,
    rawConfidence: confidenceFor(d.kind, d.observedStatus),
    suggestedServiceId: serviceId,
    conversionDefect: d,
  };
}
