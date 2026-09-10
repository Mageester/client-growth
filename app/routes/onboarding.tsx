import { useEffect, useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";

import * as repo from "@/db/repositories";
import { ClientSchema, ServiceSchema, type RuleId } from "@/core/schema";
import { RULE_SERVICE_LINKS } from "@/core/rules/registry";
import { TECHNICAL_STARTER_PRICE_BANDS } from "@/core/rules/technical";
import { suggestOfferings, type SuggestedOffering } from "@/core/offeringSuggestions";
import { assessServiceCoverage } from "@/core/absenceVerification";
import { summarizeEvidenceFailure } from "@/core/evidenceDiagnostics";
import {
  createWorkspaceForOwner,
  getWorkspaceForUser,
  newWorkspaceId,
  renameWorkspace,
} from "@/db/workspaces";
import type { TenantScope } from "@/db/tenant";
import { Icon } from "../components/ui";
import { OfferingGuidance } from "../components/offering-guidance";
import { CatalogAssistant } from "../components/catalog-assistant";
import { d1Db } from "../lib/d1.server";
import { requireSession } from "../lib/session.server";
import {
  AnalysisAbortedError,
  collectEvidenceOnly,
  runAnalysis,
} from "../lib/analysis.server";
import { isAnalysisLimitExceeded, type AnalysisLimit } from "@/db/analysisLimits";
import {
  normalizeDomain,
  offeringWarnings,
  parseOfferings,
  validateClientInput,
  validateServiceInput,
} from "../lib/validation";
import type { Route } from "./+types/onboarding";
import {
  catalogAssistantAvailable,
  catalogAssistantError,
  generateAgencyCatalogDraft,
  servicesFromReviewedCatalog,
} from "../lib/catalog-assistant.server";

export function meta() {
  return [{ title: "Get started · Axiom Orbit" }];
}

/**
 * Onboarding is two stages, and the split is the whole point.
 *
 * It used to be one form: name the client, type what they sell from memory,
 * submit, and wait while the crawl and the evaluator both ran. Thirteen of the
 * first fourteen real runs came back inconclusive, and the reason was in that
 * middle step — four of six real clients were recorded with one offering or
 * none, and the engine needs two before it will claim anything is missing. The
 * agency was being asked, cold, for the one input the analysis is compared
 * against, before the product had shown them anything at all.
 *
 * So the site is read FIRST, with no evaluator and no run recorded, and the
 * crawl's own evidence proposes what the business sells. The agency confirms
 * that list, and only then does an analysis run — against a profile that can
 * actually support a finding.
 *
 * The staging is also what makes the waiting honest. Each stage ends in a
 * number Axiom Orbit measured (pages read, services found, services about to be
 * checked) rather than a progress bar inventing steps it cannot observe. The
 * crawl runs inside one request and reports nothing until it returns, so while
 * it runs this screen claims nothing.
 */
type Stage = "setup" | "confirm";

/**
 * The services the engine can actually match today, pre-filled with defensible
 * mid-market prices. Onboarding teaches the product by showing the shapes of
 * finding it can produce, rather than asking for abstract config.
 *
 * Built from the rule registry so this list cannot fall behind it: adding a rule
 * without a starter here is a type error, and a workspace that finishes
 * onboarding is guaranteed to be able to reach every rule.
 */
const STARTER_DEFAULTS: Record<
  RuleId,
  { field: string; name: string; description: string; min: number; max: number; when: string }
> = {
  "missing-service-page": {
    field: "landing",
    name: "Dedicated Service Page",
    description: "A focused service page with persuasive copy, on-page search essentials, and a clear enquiry path.",
    min: 900,
    max: 1800,
    when: "a client sells something their website never gives its own page",
  },
  "no-service-pages": {
    field: "servicepages",
    name: "Service Website Structure",
    description: "A complete set of service pages that makes the client’s offer easy to understand, navigate, and enquire about.",
    min: 2500,
    max: 6000,
    when: "a client's whole website never describes anything they sell",
  },
  "competitor-service-gap": {
    field: "competitorgap",
    name: "Competitive Service Page",
    description: "A new service page that closes a verified gap between the client’s website and competing businesses.",
    // The deliverable is the same artefact as a service landing page, so the
    // band matches it. What differs is the argument for buying it, not the work.
    min: 900,
    max: 1800,
    when: "two or more of a client's competitors sell something the client has no page for",
  },
  "broken-conversion-path": {
    field: "conversion",
    name: "Conversion Journey Repair",
    description: "Repair and verify a broken form, phone link, or call to action so visitors can complete an enquiry.",
    min: 300,
    max: 900,
    when: "a call-to-action, form or phone link on the site is broken",
  },
  "missing-title": {
    field: "missingtitle",
    name: "Search-Friendly Page Titles",
    description: "Write and implement clear page titles that help people and search engines understand each page.",
    min: TECHNICAL_STARTER_PRICE_BANDS["missing-title"].min,
    max: TECHNICAL_STARTER_PRICE_BANDS["missing-title"].max,
    when: "a readable page has no non-empty HTML title",
  },
  "duplicate-title": {
    field: "duplicatetitle",
    name: "Unique Page Titles",
    description: "Replace repeated page titles with distinct, useful titles matched to each page’s purpose.",
    min: TECHNICAL_STARTER_PRICE_BANDS["duplicate-title"].min,
    max: TECHNICAL_STARTER_PRICE_BANDS["duplicate-title"].max,
    when: "readable pages expose the same title text",
  },
  "thin-service-page": {
    field: "thinservice",
    name: "Service Page Content Expansion",
    description: "Expand an underdeveloped service page with useful detail, stronger positioning, and a clear next action.",
    min: TECHNICAL_STARTER_PRICE_BANDS["thin-service-page"].min,
    max: TECHNICAL_STARTER_PRICE_BANDS["thin-service-page"].max,
    when: "a service-shaped page contains very little readable body text",
  },
  "missing-h1": {
    field: "missingh1",
    name: "Clear Page Headings",
    description: "Add or improve the primary page heading so visitors immediately understand the page’s purpose.",
    min: TECHNICAL_STARTER_PRICE_BANDS["missing-h1"].min,
    max: TECHNICAL_STARTER_PRICE_BANDS["missing-h1"].max,
    when: "a readable page has no non-empty H1 heading",
  },
  "broken-internal-link": {
    field: "internallink",
    name: "Broken Link Repair",
    description: "Repair verified broken internal links and confirm visitors can reach the intended destination.",
    min: TECHNICAL_STARTER_PRICE_BANDS["broken-internal-link"].min,
    max: TECHNICAL_STARTER_PRICE_BANDS["broken-internal-link"].max,
    when: "a same-site link is verified to return HTTP 404 or 410",
  },
  "missing-meta-description": {
    field: "metadescription",
    name: "Search Snippet Copy",
    description: "Write concise page descriptions designed to set clear expectations in search results.",
    min: TECHNICAL_STARTER_PRICE_BANDS["missing-meta-description"].min,
    max: TECHNICAL_STARTER_PRICE_BANDS["missing-meta-description"].max,
    when: "a readable page has no non-empty meta description",
  },
  "missing-structured-data": {
    field: "structureddata",
    name: "Local Service Structured Data",
    description: "Add appropriate business or service structured data and validate the published implementation.",
    min: TECHNICAL_STARTER_PRICE_BANDS["missing-structured-data"].min,
    max: TECHNICAL_STARTER_PRICE_BANDS["missing-structured-data"].max,
    when: "a readable page has no observed LocalBusiness or Service structured-data type",
  },
  "missing-image-alt": {
    field: "imagealt",
    name: "Accessible Image Descriptions",
    description: "Add meaningful alternative text to informative images while leaving decorative images appropriately empty.",
    min: TECHNICAL_STARTER_PRICE_BANDS["missing-image-alt"].min,
    max: TECHNICAL_STARTER_PRICE_BANDS["missing-image-alt"].max,
    when: "an image has no alt attribute; decorative alt=\"\" images are left alone",
  },
};

const STARTER_SERVICES = RULE_SERVICE_LINKS.map((link) => ({
  tag: link.tag,
  ...STARTER_DEFAULTS[link.ruleId],
}));

/** Below this, the engine will not claim anything is missing. */
const MIN_OFFERINGS_FOR_A_FINDING = 2;

function slug(prefix: string, name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return prefix + "-" + (base || "x") + "-" + Math.random().toString(36).slice(2, 6);
}

/** Case-insensitive dedupe that keeps the first spelling the agency chose. */
function dedupeOfferings(lines: string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }
  return kept;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const authed = await requireSession(request, context);
  const db = d1Db(context.cloudflare.env.DB as never);
  const assistantAvailable = catalogAssistantAvailable(
    context.cloudflare.env as unknown as Record<string, unknown>,
  );
  const ws = await getWorkspaceForUser(db, authed.userId);
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client");
  const readFailed = url.searchParams.get("read") === "failed";

  if (ws) {
    const scope: TenantScope = { db, workspaceId: ws.id };

    // Stage two. Reached only by way of stage one, which is why it is allowed
    // through the "workspace already has clients" guard below.
    if (clientId) {
      const client = await repo.getClient(scope, clientId);
      if (client) {
        // Once this client has been analyzed, onboarding is over — the results
        // are the thing to look at, and re-entering here would loop.
        if (await repo.getLatestAnalysisRun(scope, client.id)) {
          throw redirect("/opportunities?client=" + client.id);
        }
        const evidence = await repo.getLatestEvidence(scope, client.id);
        const readablePages = evidence
          ? evidence.site.pages.filter(
              (page) => page.status >= 200 && page.status < 300 && page.wordCount > 0,
            ).length
          : 0;
        const suggestions = evidence
          ? suggestOfferings({ evidence, existingOfferings: client.offerings, max: 10 })
          : ([] as SuggestedOffering[]);
        const coverage = evidence
          ? assessServiceCoverage({
              client: {
                offerings: dedupeOfferings([
                  ...client.offerings,
                  ...suggestions.map((suggestion) => suggestion.label),
                ]),
              },
              evidence,
            })
          : null;
        return {
          stage: "confirm" as Stage,
          hasWorkspace: true,
          needsAgencySetup: false,
          workspaceName: "",
          client: {
            id: client.id,
            name: client.name,
            domain: client.domain,
            offerings: client.offerings,
          },
          readFailed,
          // What the crawl actually reached. Null means no crawl has ever
          // stored evidence for this client, which is a different sentence from
          // "we read it and found nothing".
          crawl: evidence
            ? {
                readablePages,
                fetchedPages: evidence.site.pages.length,
              }
            : null,
          crawlFailure:
            evidence && readablePages === 0 && evidence.networkEvents.length > 0
              ? summarizeEvidenceFailure(evidence)
              : null,
          suggestions,
          coverage,
          catalogAssistantAvailable: assistantAvailable,
        };
      }
    }

    // Ordinary /onboarding visit for an existing workspace. The stage-two
    // branch above must stay ahead of this guard: a fresh workspace holds its
    // first client from the moment stage one finishes, and ?client=<id> is the
    // only door back into the confirm stage.
    const [clientCount, serviceCount] = await Promise.all([
      repo.listClients(scope),
      repo.listServices(scope),
    ]);
    if (clientCount.length > 0 || serviceCount.length > 0) throw redirect("/opportunities");

    // Zero clients AND zero services: an unconfigured workspace — a fresh
    // signup that has not finished onboarding, or one that was reset. The
    // agency name is reviewable again, prefilled with the name it already has.
    return {
      stage: "setup" as Stage,
      hasWorkspace: true,
      needsAgencySetup: true,
      workspaceName: ws.name,
      client: null,
      readFailed: false,
      crawl: null,
      suggestions: [] as SuggestedOffering[],
      coverage: null,
      catalogAssistantAvailable: assistantAvailable,
    };
  }

  return {
    stage: "setup" as Stage,
    hasWorkspace: false,
    needsAgencySetup: true,
    workspaceName: "",
    client: null,
    readFailed: false,
    crawl: null,
    suggestions: [] as SuggestedOffering[],
    coverage: null,
    catalogAssistantAvailable: assistantAvailable,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const authed = await requireSession(request, context);
  const env = context.cloudflare.env;
  const db = d1Db(env.DB as never);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "setup");

  if (intent === "generate-catalog") {
    let ws = await getWorkspaceForUser(db, authed.userId);
    if (!ws) {
      ws = await createWorkspaceForOwner(db, {
        id: newWorkspaceId(),
        name: "My Agency",
        ownerUserId: authed.userId,
      });
    }
    const scope: TenantScope = { db, workspaceId: ws.id };
    const [clients, services] = await Promise.all([repo.listClients(scope), repo.listServices(scope)]);
    if (clients.length > 0 || services.length > 0) throw redirect("/opportunities");
    try {
      return {
        ok: true as const,
        kind: "catalog-draft" as const,
        ...(await generateAgencyCatalogDraft(
          scope,
          env as unknown as Record<string, unknown>,
          {
            website: String(form.get("website") ?? ""),
            summary: String(form.get("summary") ?? ""),
          },
          request.signal,
        )),
      };
    } catch (error) {
      return {
        ok: false as const,
        kind: "catalog-draft" as const,
        error: catalogAssistantError(error),
      };
    }
  }

  if (intent === "analyze" || intent === "save" || intent === "reread") {
    const ws = await getWorkspaceForUser(db, authed.userId);
    if (!ws) throw redirect("/onboarding");
    const scope: TenantScope = { db, workspaceId: ws.id };
    const client = await repo.getClient(scope, String(form.get("clientId") ?? ""));
    if (!client) throw new Response("Client not found", { status: 404 });

    if (intent === "reread") {
      try {
        await collectEvidenceOnly(scope, client.id, request.signal);
        return redirect("/onboarding?client=" + client.id);
      } catch (err) {
        if (err instanceof AnalysisAbortedError) return { error: err.message };
        return redirect("/onboarding?client=" + client.id + "&read=failed");
      }
    }

    // The confirmed list. Suggestions reach this point only as boxes a person
    // left checked, alongside anything they typed themselves — nothing the
    // crawl proposed is saved because it was proposed.
    const offerings = dedupeOfferings([
      ...form.getAll("offering").map((value) => String(value).trim()),
      ...parseOfferings(String(form.get("moreOfferings") ?? "")),
    ]);

    const problem = validateClientInput({
      name: client.name,
      domain: client.domain,
      offerings: offerings.join("\n"),
    });
    if (problem) return { error: problem };

    const savedClient = ClientSchema.parse({ ...client, offerings });
    await repo.upsertClient(scope, savedClient);

    if (intent === "save") return redirect("/clients/" + client.id);

    // A stale or hand-crafted confirmation post must not turn manual context
    // into website evidence. If the stored crawl is known to be insufficient,
    // save the profile but refuse to run the service-gap analysis.
    const latestEvidence = await repo.getLatestEvidence(scope, client.id);
    if (latestEvidence) {
      const coverage = assessServiceCoverage({
        client: savedClient,
        evidence: latestEvidence,
      });
      if (!coverage.analyzable) {
        return {
          error:
            "Orbit cannot check this site for missing service pages until enough of the website can be read. The client context was saved; try reading it again first.",
        };
      }
    }

    // The first analysis is the point of onboarding, so its result must not be
    // swallowed. A failed run still leaves a usable workspace — the client page
    // says what happened and offers a retry, instead of dropping the user on an
    // empty feed with no explanation.
    try {
      await runAnalysis(scope, env as never, client.id, { signal: request.signal });
      return redirect("/opportunities?client=" + client.id);
    } catch (err) {
      if (isAnalysisLimitExceeded(err)) {
        return { error: err.reason, limitation: err.limitation };
      }
      if (err instanceof AnalysisAbortedError) return { error: err.message };
      return redirect("/clients/" + client.id + "?firstRun=failed");
    }
  }

  const clientInput = {
    name: String(form.get("clientName") ?? ""),
    domain: String(form.get("clientDomain") ?? ""),
    // Stage one no longer asks for offerings at all: the site is about to be
    // read, and it answers this better than an agency owner can from memory.
    offerings: "",
  };
  const clientProblem = validateClientInput(clientInput);
  if (clientProblem) return { error: clientProblem };

  const reviewedCatalogRaw = String(form.get("reviewedCatalog") ?? "").trim();
  let reviewedServices: ReturnType<typeof servicesFromReviewedCatalog> | null = null;
  if (reviewedCatalogRaw) {
    try {
      reviewedServices = servicesFromReviewedCatalog(reviewedCatalogRaw);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "The reviewed catalog is invalid." };
    }
  }

  const chosen = STARTER_SERVICES.map((starter) => ({
    starter,
    name: String(form.get(starter.field + "Name") ?? starter.name),
    min: Number(form.get(starter.field + "Min")),
    max: Number(form.get(starter.field + "Max")),
    enabled: form.get(starter.field + "On") === "on",
  })).filter((entry) => entry.enabled);

  if (!reviewedServices && chosen.length === 0) {
    return { error: "Keep at least one service — findings are priced from what you sell." };
  }
  for (const entry of reviewedServices ? [] : chosen) {
    const problem = validateServiceInput({
      name: entry.name,
      priceMin: entry.min,
      priceMax: entry.max,
      description: entry.starter.description,
    });
    if (problem) return { error: problem };
  }

  let ws = await getWorkspaceForUser(db, authed.userId);
  if (ws) {
    // Server-side guard, independent of the loader redirect. Setup creation is
    // only allowed for an EMPTY workspace (zero clients AND zero services) — a
    // fresh signup that has not finished onboarding, or a reset workspace.
    // Anything already configured must not gain a second client from a
    // hand-crafted form post.
    const workspaceScope: TenantScope = { db, workspaceId: ws.id };
    const [existingClients, existingServices] = await Promise.all([
      repo.listClients(workspaceScope),
      repo.listServices(workspaceScope),
    ]);
    if (existingClients.length > 0 || existingServices.length > 0) {
      throw redirect("/opportunities");
    }
    // Reset-state onboarding: rename the SAME workspace in place if the agency
    // name changed. Never create a second workspace for this owner.
    const requestedName = String(form.get("workspaceName") ?? "").trim();
    if (requestedName && requestedName !== ws.name) {
      await renameWorkspace(db, ws.id, requestedName);
      ws = { ...ws, name: requestedName };
    }
  } else {
    ws = await createWorkspaceForOwner(db, {
      id: newWorkspaceId(),
      name: String(form.get("workspaceName") ?? "").trim() || "My Agency",
      ownerUserId: authed.userId,
    });
  }
  const scope: TenantScope = { db, workspaceId: ws.id };

  const catalog = reviewedServices ?? chosen.map((entry) =>
      ServiceSchema.parse({
        id: slug("svc", entry.name),
        name: entry.name.trim(),
        description: entry.starter.description,
        priceMin: entry.min,
        priceMax: entry.max,
        tags: [entry.starter.tag],
        active: true,
      }),
    );
  await repo.upsertServicesAtomic(scope, catalog);

  const client = ClientSchema.parse({
    id: slug("client", clientInput.name),
    name: clientInput.name.trim(),
    domain: normalizeDomain(clientInput.domain),
    offerings: [],
    notes: "",
  });
  await repo.upsertClient(scope, client);

  // Crawl only. No evaluator is called, so this costs nothing and cannot
  // surface a finding, and no run is recorded, so a client whose site could not
  // be read is never left looking analyzed. A failure is carried to stage two
  // and said out loud there rather than retried silently or hidden.
  try {
    await collectEvidenceOnly(scope, client.id, request.signal);
    return redirect("/onboarding?client=" + client.id);
  } catch (err) {
    if (err instanceof AnalysisAbortedError) return { error: err.message };
    return redirect("/onboarding?client=" + client.id + "&read=failed");
  }
}

const STEP_LABELS = ["Your agency", "What they sell", "First findings"] as const;

function Steps({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol className="steps" aria-label="Setup progress">
      {STEP_LABELS.map((label, index) => (
        <li key={label} className={"step" + (index === current ? " is-current" : "")}>
          <span className="step-num">{index + 1}</span>
          <span>{label}</span>
          {index < STEP_LABELS.length - 1 && <span className="step-rule" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

/**
 * Shown while the crawl is in flight.
 *
 * It runs inside one request and reports nothing until it returns, so this
 * states only what is true before it starts: which site is being fetched, and
 * that nothing is being judged yet. No page counter ticks up here, because
 * there is no page count to read.
 */
function ReadingSite({ domain, stopHref }: { domain: string; stopHref: string }) {
  return (
    <div className="runcard running readingcard" role="status" aria-live="polite">
      <span className="runcard-mark">
        <Icon name="search" size={15} className="spin" />
      </span>
      <div className="runcard-body">
        <p className="runcard-title">Reading {domain || "the site"}</p>
        <p className="runcard-summary">
          Fetching pages and noting what this business appears to sell. Nothing is judged and
          nothing is saved to the client yet &mdash; you confirm the list next. This usually takes
          10&ndash;20 seconds.
        </p>
        <span className="runbar" aria-hidden="true">
          <span />
        </span>
        <Link className="btn btn-sm run-cancel" to={stopHref} replace>
          Stop reading
        </Link>
      </div>
    </div>
  );
}

export default function Onboarding({ loaderData, actionData }: Route.ComponentProps) {
  const error = actionData?.error;
  const limitation = actionData?.limitation;
  return (
    <main className="detail onboarding">
      <span className="eyebrow">Setup</span>
      {loaderData.stage === "confirm" && loaderData.client ? (
        <ConfirmStage loaderData={loaderData} error={limitation ? undefined : error} limitation={limitation} />
      ) : (
        <SetupStage
          hasWorkspace={loaderData.hasWorkspace}
          needsAgencySetup={loaderData.needsAgencySetup}
          workspaceName={loaderData.workspaceName}
          error={limitation ? undefined : error}
          catalogAssistantIsAvailable={loaderData.catalogAssistantAvailable}
        />
      )}
    </main>
  );
}

function ErrorNotice({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <div className="notice err" role="alert">
      <Icon name="alert" size={15} />
      <span>{error}</span>
    </div>
  );
}

function LimitNotice({ limitation }: { limitation?: AnalysisLimit }) {
  if (!limitation) return null;
  return (
    <div className="notice" role="status">
      <Icon name="clock" size={15} />
      <span>{limitation.reason}</span>
    </div>
  );
}

type StarterService = (typeof STARTER_SERVICES)[number];

function starterAccessibleName(currentName: string, defaultName: string): string {
  return currentName.trim() || defaultName;
}

export function StarterIdentityControls({
  service,
  serviceName,
  onNameChange,
}: {
  service: StarterService;
  serviceName: string;
  onNameChange: (name: string) => void;
}) {
  const accessibleServiceName = starterAccessibleName(serviceName, service.name);
  return (
    <label className="starter-toggle">
      <input
        type="checkbox"
        name={service.field + "On"}
        defaultChecked
        aria-label={"Offer " + accessibleServiceName}
      />
      <span className="starter-copy">
        <input
          className="starter-name"
          name={service.field + "Name"}
          type="text"
          value={serviceName}
          onChange={(event) => onNameChange(event.target.value)}
          aria-label={accessibleServiceName + " service name"}
        />
        <span className="starter-when">When {service.when}.</span>
      </span>
    </label>
  );
}

export function StarterPriceControls({
  service,
  serviceName,
}: {
  service: (typeof STARTER_SERVICES)[number];
  serviceName: string;
}) {
  const accessibleServiceName = starterAccessibleName(serviceName, service.name);
  return (
    <div className="starter-price">
      <div className="field">
        <label htmlFor={service.field + "Min"}>From</label>
        <input
          id={service.field + "Min"}
          name={service.field + "Min"}
          type="number"
          min={0}
          step={50}
          inputMode="numeric"
          aria-label={accessibleServiceName + " minimum price"}
          defaultValue={service.min}
        />
      </div>
      <div className="field">
        <label htmlFor={service.field + "Max"}>Up to</label>
        <input
          id={service.field + "Max"}
          name={service.field + "Max"}
          type="number"
          min={0}
          step={50}
          inputMode="numeric"
          aria-label={accessibleServiceName + " maximum price"}
          defaultValue={service.max}
        />
      </div>
    </div>
  );
}

function SetupStage({
  hasWorkspace,
  needsAgencySetup,
  workspaceName,
  error,
  catalogAssistantIsAvailable,
}: {
  hasWorkspace: boolean;
  needsAgencySetup: boolean;
  workspaceName: string;
  error?: string;
  catalogAssistantIsAvailable: boolean;
}) {
  const navigation = useNavigation();
  // Busy through the redirect too, not just the POST: a submit that ends in a
  // redirect passes through "loading" on the way, and treating that as idle
  // flashes the form back over the progress card for the last frame of a
  // 20-second wait.
  const submitting = navigation.state !== "idle" && navigation.formMethod === "POST";
  const [domain, setDomain] = useState("");
  const [starterNames, setStarterNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(STARTER_SERVICES.map((service) => [service.field, service.name])),
  );
  const [reviewedCatalog, setReviewedCatalog] = useState("");

  return (
    <>
      <h1 className="title-lg onboarding-title">Watch your first client site</h1>
      <p className="prose onboarding-lede">
        Axiom Orbit reads a client&rsquo;s website, compares it against what that business
        actually sells, and surfaces the work you could legitimately bill for. Tell it who the
        client is and it will read the site. The first action is a website read; analysis runs
        after you confirm what it found.
      </p>
      <Steps current={0} />

      <ErrorNotice error={error} />

      {submitting && <ReadingSite domain={normalizeDomain(domain)} stopHref="/opportunities" />}

      <Form method="post" hidden={submitting}>
        <input type="hidden" name="reviewedCatalog" value={reviewedCatalog} />
        {(needsAgencySetup) && (
          <section className="section">
            <div className="section-head">
              <div>
                <h2 className="title-section">Your agency</h2>
                <p>The workspace name shown across the app.</p>
              </div>
            </div>
            <div className="field onboarding-field">
              <label htmlFor="workspaceName">Agency name</label>
              <input
                id="workspaceName"
                name="workspaceName"
                type="text"
                required
                autoComplete="organization"
                defaultValue={workspaceName}
              />
            </div>
          </section>
        )}

        <section className="section">
          <div className="section-head">
            <div>
              <h2 className="title-section">Your first client</h2>
              <p>
                One you already look after. Axiom Orbit reads this site as soon as you continue.
              </p>
            </div>
          </div>
          <div className="onboarding-field">
            <div className="field-row">
              <div className="field">
                <label htmlFor="clientName">Client name</label>
                <input id="clientName" name="clientName" type="text" required autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="clientDomain">Website</label>
                <input
                  id="clientDomain"
                  name="clientDomain"
                  type="text"
                  placeholder="example.com"
                  required
                  autoComplete="off"
                  inputMode="url"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                />
              </div>
            </div>
          </div>
        </section>

        <details className="starter-pricing">
          <summary>
            <span className="starter-pricing-copy">
              <strong>Review starter pricing</strong>
              <span>{STARTER_SERVICES.length} starter services with conservative price ranges</span>
            </span>
            <span className="starter-pricing-caret" aria-hidden="true" />
          </summary>
          <div className="starter-pricing-body">
            <div className="section-head">
              <div>
                <h2 className="title-section">Starter services</h2>
                <p>
                  These conservative defaults are used to price early findings and can be reviewed
                  before analysis if your agency needs to change a service name or range.
                </p>
              </div>
            </div>
            <ul className="starter-list">
              {STARTER_SERVICES.map((service) => {
                const currentName = starterNames[service.field] ?? service.name;
                return (
                  <li className="starter" key={service.field}>
                    <StarterIdentityControls
                      service={service}
                      serviceName={currentName}
                      onNameChange={(name) =>
                        setStarterNames((previous) => ({
                          ...previous,
                          [service.field]: name,
                        }))
                      }
                    />
                    <StarterPriceControls service={service} serviceName={currentName} />
                  </li>
                );
              })}
            </ul>
            <p className="field-hint">You can rename these and add more services later.</p>
          </div>
        </details>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
            <Icon name="search" size={15} />
            Read the site
          </button>
          <span className="faint form-actions-note">
            The first action is a website read. Nothing is added to the client yet &mdash;
            analysis runs after you confirm what Orbit found.
          </span>
        </div>
      </Form>

      <div className="onboarding-catalog-assistant">
        <CatalogAssistant
          deferSave
          available={catalogAssistantIsAvailable}
          onCatalogChange={setReviewedCatalog}
        />
      </div>
    </>
  );
}

/**
 * Stage two: what the crawl found, and the agency's decision about it.
 *
 * Every suggestion carries the pages and navigation entries it came from,
 * because a list of services with no provenance is something an agency has to
 * verify from scratch anyway. Strong evidence starts checked; "worth checking"
 * does not — the confidence taxonomy already draws that line, and a medium
 * suggestion silently left checked is how a guess becomes a priced page in a
 * proposal.
 */
function ConfirmStage({
  loaderData,
  error,
  limitation,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  error?: string;
  limitation?: AnalysisLimit;
}) {
  const navigation = useNavigation();
  // Busy through the redirect too, not just the POST: a submit that ends in a
  // redirect passes through "loading" on the way, and treating that as idle
  // flashes the form back over the progress card for the last frame of a
  // 20-second wait.
  const submitting = navigation.state !== "idle" && navigation.formMethod === "POST";
  const client = loaderData.client;
  const { crawl, crawlFailure, suggestions, readFailed, coverage } = loaderData;

  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries([
      ...(client?.offerings.map((offering) => [offering, true] as const) ?? []),
      ...suggestions.map((s) => [s.label, s.confidence === "high"] as const),
    ]),
  );
  const [extra, setExtra] = useState("");

  // A limit rejection happens after the confirmation POST has saved the
  // offerings. Loader revalidation therefore returns a new client profile and
  // fewer suggestions (saved offerings are intentionally excluded from
  // suggestions). Merge the persisted, already-confirmed entries into the
  // checkbox state so a retry cannot silently lose them or ask the agency to
  // remember them again.
  useEffect(() => {
    if (!client) return;
    setChecked((previous) => {
      const next = { ...previous };
      for (const offering of client.offerings) next[offering] = true;
      for (const suggestion of suggestions) {
        if (!(suggestion.label in next)) next[suggestion.label] = suggestion.confidence === "high";
      }
      return next;
    });
  }, [client, suggestions]);

  if (!client) return null;

  const confirmed = dedupeOfferings([
    ...client.offerings.filter((offering) => checked[offering] !== false),
    ...suggestions.filter((s) => checked[s.label]).map((s) => s.label),
    ...parseOfferings(extra),
  ]);
  const warnings = offeringWarnings(confirmed);
  const unreadable = readFailed || !crawl || crawl.readablePages === 0;
  const coverageBlocked = !coverage?.analyzable;
  const analysisAvailable = !unreadable && !coverageBlocked;

  return (
    <>
      <h1 className="title-lg onboarding-title">
        {analysisAvailable ? `What ${client.name} sells` : `We couldn't read ${client.name} yet`}
      </h1>
      <p className="prose onboarding-lede">
        {!analysisAvailable && unreadable ? (
          crawl && crawl.fetchedPages > 0 ? (
            <>
              {crawl.fetchedPages} {crawl.fetchedPages === 1 ? "page was" : "pages were"} fetched from{" "}
              {client.domain}, but none of them could be read as text.
            </>
          ) : (
            // Nothing came back at all. Said plainly, because "we read it and
            // found nothing" is a different claim and this screen cannot make it.
            <>No page of {client.domain} could be reached, so there is nothing to suggest from.</>
          )
        ) : !analysisAvailable && coverage?.limitation === "site-too-thin" ? (
          <>Orbit read the whole site, but it does not expose service pages to check yet.</>
        ) : !analysisAvailable ? (
          <>This website currently prevents Orbit from reading enough pages to check how its services are represented.</>
        ) : crawl && crawl.readablePages > 0 ? (
          <>
            Axiom Orbit read{" "}
            <strong>
              {crawl.readablePages} {crawl.readablePages === 1 ? "page" : "pages"}
            </strong>{" "}
            of {client.domain}
            {suggestions.length > 0 ? (
              <>
                {" "}
                and found <strong>{suggestions.length}</strong>{" "}
                {suggestions.length === 1 ? "thing" : "things"} that look like work customers hire
                them for. Keep what is right, drop what is not.
              </>
            ) : (
              <> but nothing on it read clearly as work customers hire them for.</>
            )}
          </>
        ) : (
          <>No usable crawl evidence is available for this client yet.</>
        )}
      </p>
      <Steps current={1} />

      <ErrorNotice error={error} />
      <LimitNotice limitation={limitation} />

      {!analysisAvailable && (
        <div className="notice" role="status">
          <Icon name="alert" size={15} />
          <div>
            {crawlFailure ? (
              <>
                <p><strong>{crawlFailure.title}</strong></p>
                <p>{crawlFailure.detail}</p>
              </>
            ) : (
              <p>
                {coverage?.limitation === "site-too-thin"
                  ? "Orbit read the whole site but found no service pages. Adding offerings will save client context, but it will not create website evidence."
                  : coverageBlocked && !unreadable
                    ? "Orbit read part of this site, but not enough of its service structure to check for missing pages. Adding offerings will save client context, not replace that evidence."
                    : "Orbit could not read a usable page from this site. You can save what you know about the client, but analysis remains unavailable until there is sufficient readable evidence."}
              </p>
            )}
            <Form method="post" className="suggested-actions">
              <input type="hidden" name="intent" value="reread" />
              <input type="hidden" name="clientId" value={client.id} />
              <button className="btn" type="submit" disabled={submitting}>
                <Icon name="refresh" size={15} />
                Try reading it again
              </button>
            </Form>
          </div>
        </div>
      )}

      <Form method="post">
        <input type="hidden" name="intent" value={analysisAvailable ? "analyze" : "save"} />
        <input type="hidden" name="clientId" value={client.id} />

        {client.offerings.length > 0 && (
          <section className="section">
            <div className="section-head">
              <div>
                <h2 className="title-section">Already confirmed</h2>
                <p>
                  {coverageBlocked
                    ? "These offerings are saved as client context. They do not make the website evidence sufficient for analysis."
                    : "These offerings were saved from your previous confirmation. Keep them checked to include them in the next analysis, or clear one to remove it."}
                </p>
              </div>
            </div>
            <ul className="suggestion-list confirm-list">
              {client.offerings.map((offering) => (
                <li key={"confirmed-" + offering}>
                  <label className="confirm-toggle">
                    <input
                      type="checkbox"
                      name="offering"
                      value={offering}
                      checked={checked[offering] !== false}
                      onChange={(event) =>
                        setChecked((prev) => ({ ...prev, [offering]: event.target.checked }))
                      }
                    />
                    <span className="confirm-copy">
                      <span className="suggestion-head">
                        <span className="suggestion-label">{offering}</span>
                        <span className="pill faint">Confirmed</span>
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        {suggestions.length > 0 && (
          <section className="section">
            <div className="section-head">
              <div>
                <h2 className="title-section">
                  {coverageBlocked ? "Possible offerings from the partial read" : "Found on the site"}
                </h2>
                <p>
                  {coverageBlocked
                    ? "These are useful client context from the pages Orbit could read. Saving one does not make the website evidence sufficient or unlock a missing-service check."
                    : "Each one shows where it came from. Nothing here is saved until you continue, and anything you keep is checked against the site like a service — a missing page for one would be priced like a service."}
                </p>
              </div>
            </div>
            <ul className="suggestion-list confirm-list">
              {suggestions.map((suggestion) => (
                <li key={suggestion.label}>
                  <label className="confirm-toggle">
                    <input
                      type="checkbox"
                      name="offering"
                      value={suggestion.label}
                      checked={Boolean(checked[suggestion.label])}
                      onChange={(event) =>
                        setChecked((prev) => ({
                          ...prev,
                          [suggestion.label]: event.target.checked,
                        }))
                      }
                    />
                    <span className="confirm-copy">
                      <span className="suggestion-head">
                        <span className="suggestion-label">{suggestion.label}</span>
                        <span className="pill faint">
                          {suggestion.confidence === "high" ? "Strong evidence" : "Worth checking"}
                        </span>
                      </span>
                      <ul className="suggestion-evidence">
                        {suggestion.evidence.map((item, index) => (
                          <li key={index}>{item.detail}</li>
                        ))}
                      </ul>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="section">
          <div className="section-head">
            <div>
              <h2 className="title-section">
                {coverageBlocked
                  ? "Know what they offer?"
                  : suggestions.length > 0
                    ? "Anything it missed"
                    : "What customers hire them for"}
              </h2>
              <p>
                {coverageBlocked
                  ? "You can add their services now so the client profile is ready when the website can be analyzed. These entries are client context, not website evidence."
                  : "One per line: things customers actually pay them for, in the words those customers would use."}
              </p>
            </div>
          </div>
          <div className="field onboarding-field">
            <label htmlFor="moreOfferings">Add your own</label>
            <textarea
              id="moreOfferings"
              name="moreOfferings"
              rows={4}
              value={extra}
              onChange={(event) => setExtra(event.target.value)}
              placeholder={"heat pump installation\nair conditioning repair\nduct cleaning"}
            />
            <div className="field-hint">
              Not claims about the business &mdash; no &ldquo;free quotes&rdquo;, &ldquo;fully
              insured&rdquo; or &ldquo;family owned&rdquo;. Every line here can become a priced page
              recommendation, so a claim in this box becomes a pitch for a page about a claim.
            </div>
            <OfferingGuidance
              offerings={confirmed}
              showWarnings={false}
              coverageBlocked={coverageBlocked}
            />
          </div>

          {warnings.length > 0 && (
            <div className="notice warn" role="status">
              <Icon name="alert" size={15} />
              <span>
                {warnings.map((w) => "“" + w.value + "”").join(", ")}{" "}
                {warnings.length === 1 ? "reads" : "read"} as a claim about the business rather than
                work someone buys. Kept as {warnings.length === 1 ? "it is" : "they are"},{" "}
                {warnings.length === 1 ? "it could be" : "they could be"} priced as a page.
              </span>
            </div>
          )}

          {submitting ? (
            <div className="runcard running readingcard" role="status" aria-live="polite">
              <span className="runcard-mark">
                  <Icon name={analysisAvailable ? "refresh" : "check"} size={15} className="spin" />
                </span>
                <div className="runcard-body">
                  <p className="runcard-title">
                    {analysisAvailable
                      ? `Checking ${confirmed.length} ${confirmed.length === 1 ? "service" : "services"} against ${client.domain}`
                      : "Saving client context"}
                  </p>
                  <p className="runcard-summary">
                    {analysisAvailable
                      ? "Re-reading the site, then judging each one against what the site actually shows. Anything Axiom Orbit will not stand behind is not surfaced."
                      : "Your entries will be available when the website can be read sufficiently for analysis."}
                  </p>
                <span className="runbar" aria-hidden="true">
                  <span />
                </span>
                <Link className="btn btn-sm run-cancel" to={`/clients/${client.id}`} replace>
                  Stop reading
                </Link>
              </div>
            </div>
          ) : (
            <div className="form-actions">
              <button type="submit" className="btn btn-primary btn-lg">
                <Icon name={analysisAvailable ? "refresh" : "check"} size={15} />
                {analysisAvailable ? `Analyze ${client.name}` : "Save client"}
              </button>
              <span className="faint form-actions-note" aria-live="polite">
                {!analysisAvailable
                  ? "Orbit can save this client, but it cannot check the site for missing service pages until enough of the website can be read."
                  : confirmed.length >= MIN_OFFERINGS_FOR_A_FINDING
                  ? confirmed.length +
                    " confirmed. Each one is checked against the site."
                  : "Axiom Orbit needs at least " +
                    MIN_OFFERINGS_FOR_A_FINDING +
                    " to confirm a crawl reached a site's services. With " +
                    confirmed.length +
                    ", it will not claim anything is missing."}
              </span>
            </div>
          )}
        </section>
      </Form>
    </>
  );
}
