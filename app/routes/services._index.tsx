import { useEffect, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";

import type { Service } from "@/core/schema";
import { RULE_SERVICE_LINKS } from "@/core/rules/registry";
import {
  suggestServiceTags,
  updateServiceTagSelection,
} from "@/core/serviceTagSuggestions";
import { ServiceSchema } from "@/core/schema";
import * as repo from "@/db/repositories";
import {
  EmptyState,
  Icon,
  PageContextMeta,
  SidePanel,
  formatCurrencyRange,
  pluralize,
} from "../components/ui";
import { GlyphMark, markForTags } from "../components/entity-mark";
import { requireTenant } from "../lib/session.server";
import { SettingsNavigation } from "../components/settings-navigation";
import { validateServiceInput } from "../lib/validation";
import {
  catalogAssistantAvailable,
  catalogAssistantError,
  generateAgencyCatalogDraft,
  servicesFromReviewedCatalog,
} from "../lib/catalog-assistant.server";
import { CatalogAssistant } from "../components/catalog-assistant";
import type { Route } from "./+types/services._index";

export function meta() {
  return [{ title: "Services · Axiom Orbit" }];
}

/**
 * What kind of website gap this offering answers.
 *
 * The engine matches a finding to a service through machine tags. Exposing a
 * free-text "tags" box asked agency owners to guess at an internal contract; a
 * fixed set of product-language choices says what the setting actually decides.
 *
 * The list comes from the rule registry rather than being restated here: a
 * checkbox whose tag no rule reads would silently save a service that can never
 * be matched to a finding.
 */
const MATCHES = RULE_SERVICE_LINKS;

type MatchTag = (typeof MATCHES)[number]["tag"];
type ServiceErrorField = "name" | "priceMin" | "priceMax" | "description";

function serviceErrorField(problem: string): ServiceErrorField {
  if (/name/i.test(problem)) return "name";
  if (/description/i.test(problem)) return "description";
  if (/top of the range|price.*typo/i.test(problem)) return "priceMax";
  return "priceMin";
}

const MATCH_LABEL: Record<string, string> = Object.fromEntries(
  MATCHES.map((match) => [match.tag, match.label]),
);

function matchesOf(service: Service): string[] {
  return service.tags.filter((tag) => tag in MATCH_LABEL);
}

function slugId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return "svc-" + (base || "service") + "-" + Math.random().toString(36).slice(2, 6);
}

export function serviceDraftStorageKey(workspaceId: string, userId: string): string {
  return `axiom-orbit:new-service-draft:${encodeURIComponent(workspaceId)}:${encodeURIComponent(userId)}`;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  return {
    services: await repo.listServices(t.scope),
    workspaceId: t.workspace.id,
    userId: t.userId,
    catalogAssistantAvailable: catalogAssistantAvailable(
      context.cloudflare.env as unknown as Record<string, unknown>,
    ),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "generate-catalog") {
    try {
      const generated = await generateAgencyCatalogDraft(
        t.scope,
        context.cloudflare.env as unknown as Record<string, unknown>,
        {
          website: String(form.get("website") ?? ""),
          summary: String(form.get("summary") ?? ""),
        },
        request.signal,
      );
      return { ok: true as const, kind: "catalog-draft" as const, ...generated };
    } catch (error) {
      return {
        ok: false as const,
        kind: "catalog-draft" as const,
        error: catalogAssistantError(error),
      };
    }
  }

  if (intent === "save-generated-catalog") {
    try {
      const services = servicesFromReviewedCatalog(String(form.get("catalog") ?? ""));
      await repo.upsertServicesAtomic(t.scope, services);
      return {
        ok: true as const,
        kind: "catalog-save" as const,
        message: `${services.length} ${pluralize(services.length, "service", "services")} added to your catalog.`,
      };
    } catch (error) {
      return {
        ok: false as const,
        kind: "catalog-save" as const,
        error: error instanceof Error ? error.message : "The reviewed catalog was invalid.",
      };
    }
  }

  if (intent === "toggle-active") {
    const id = String(form.get("id") ?? "");
    const active = form.get("active") === "on";
    const changed = await repo.setServiceActive(t.scope, id, active);
    if (!changed) return { ok: false as const, error: "That service is no longer in your catalog." };
    return {
      ok: true as const,
      message: active
        ? "Service reactivated — it can be matched to findings again."
        : "Service deactivated. Existing findings keep their price; new ones will not use it.",
    };
  }

  if (intent === "save") {
    const input = {
      name: String(form.get("name") ?? ""),
      priceMin: Number(form.get("priceMin")),
      priceMax: Number(form.get("priceMax")),
      description: String(form.get("description") ?? "").trim(),
    };
    const problem = validateServiceInput(input);
    if (problem) {
      return { ok: false as const, error: problem, field: serviceErrorField(problem) };
    }

    const idInput = String(form.get("id") ?? "").trim();
    const existing = idInput ? await repo.getService(t.scope, idInput) : null;
    if (idInput && !existing) {
      return { ok: false as const, error: "That service is no longer in your catalog." };
    }

    const chosen = form
      .getAll("matches")
      .map(String)
      .filter((tag): tag is MatchTag => MATCHES.some((match) => match.tag === tag));
    const automatic = suggestServiceTags(input).map((suggestion) => suggestion.tag as MatchTag);
    const manual = form.get("mappingMode") === "manual" || form.has("matches");
    // Tags this form does not own (imported or legacy) are the user's data, not
    // ours to drop just because this screen has no checkbox for them.
    const preserved = (existing?.tags ?? []).filter((tag) => !(tag in MATCH_LABEL));
    const tags = [...new Set([...(existing || manual ? chosen : automatic), ...preserved])];

    await repo.upsertService(
      t.scope,
      ServiceSchema.parse({
        id: idInput || slugId(input.name),
        name: input.name.trim(),
        description: input.description,
        priceMin: input.priceMin,
        priceMax: input.priceMax,
        tags,
        active: existing ? existing.active : true,
      }),
    );
    return {
      ok: true as const,
      message: existing ? "Service saved." : `${input.name.trim()} added to your catalog.`,
    };
  }

  throw new Response("Unknown action", { status: 400 });
}

export default function ServicesIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { services } = loaderData;
  const draftStorageKey = serviceDraftStorageKey(loaderData.workspaceId, loaderData.userId);
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [editing, setEditing] = useState<Service | "new" | null>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (navigation.state === "submitting") {
      submitted.current = true;
    } else if (navigation.state === "idle" && submitted.current) {
      submitted.current = false;
      if (actionData?.ok) {
        if (editing === "new") {
          try { window.sessionStorage.removeItem(draftStorageKey); } catch {}
        }
        setEditing(null);
      }
    }
  }, [navigation.state, actionData, draftStorageKey, editing]);

  const active = services.filter((service) => service.active);
  const unmatched = active.filter((service) => matchesOf(service).length === 0);
  // Each rule picks the first active service claiming its gap, so a second claim
  // is silently unreachable. Say so rather than letting a price never be used.
  const contested = MATCHES.map((match) => ({
    label: match.label.toLowerCase(),
    claimants: active.filter((service) => service.tags.includes(match.tag)),
  })).filter((entry) => entry.claimants.length > 1);
  const ordered = [...services].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name),
  );

  return (
    <div className="settings-page services-directory">
      <PageContextMeta />
      <div className="pagehead">
        <div className="pagehead-copy">
          <span className="eyebrow">Settings</span>
          <h1 className="title-page">Settings</h1>
          <p className="summary-line">Manage your workspace, services, monitoring, team, and account.</p>
        </div>
      </div>

      <div className="settings-layout">
        <SettingsNavigation active="services" />
        <section className="settings-content" aria-labelledby="services-title">
          <div className="settings-content-head">
            <div>
              <h2 id="services-title">Services</h2>
              <p>Manage the services you offer to clients.</p>
            </div>
            {services.length > 0 && (
              <button className="btn btn-primary" type="button" onClick={() => setEditing("new")}>
                <Icon name="plus" size={15} />
                New service
              </button>
            )}
          </div>

          <CatalogAssistant available={loaderData.catalogAssistantAvailable} />

      {actionData?.ok && (
        <div className="notice ok" role="status">
          <Icon name="check" size={15} />
          <span>{actionData.message}</span>
        </div>
      )}
      {actionData && !actionData.ok && !("field" in actionData && actionData.field) && (
        <div className="notice err" role="alert">
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}
      {unmatched.length > 0 && (
        <div className="notice" role="status">
          <Icon name="alert" size={15} />
          <span>
            {unmatched.length} active {pluralize(unmatched.length, "service is", "services are")} not
            connected to a specific website opportunity yet, so {unmatched.length === 1 ? "it" : "they"}
            will not price findings. Open {unmatched.length === 1 ? unmatched[0]!.name : "each one"}
            and use the advanced mapping only if Orbit missed what the service is for.
          </span>
        </div>
      )}

      {contested.map((entry) => (
        <div className="notice" role="status" key={entry.label}>
          <Icon name="alert" size={15} />
          <span>
            {entry.claimants.length} active services are mapped to the same type of website
            opportunity. Only <b>{entry.claimants[0]!.name}</b> will be matched and priced —
            deactivate the others or adjust their advanced mapping.
          </span>
        </div>
      ))}

      {services.length === 0 ? (
        <EmptyState
          icon="briefcase"
          title="Your catalog is empty"
          actions={
            <button className="btn btn-primary" type="button" onClick={() => setEditing("new")}>
              <Icon name="plus" size={15} />
              Add your first service
            </button>
          }
        >
          List the work you actually sell and what you would quote for it. Every finding is priced
          from this catalog, so nothing is surfaced that you could not deliver.
        </EmptyState>
      ) : (
        <div className="records-table services-table">
          <div className="records-head" aria-hidden="true">
            <span>Service</span>
            <span>Price range</span>
            <span />
          </div>
          <ul className="records">
          {ordered.map((service) => (
            <li key={service.id}>
              <ServiceRow service={service} onEdit={() => setEditing(service)} busy={busy} />
            </li>
          ))}
          </ul>
        </div>
      )}

        </section>
      </div>

      <SidePanel
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New service" : "Edit service"}
        description="How you describe this work, what you charge, and when it should be offered."
      >
        {editing !== null && (
          <>
            {editing !== "new" && (
              <Form method="post" className="service-activation">
                <input type="hidden" name="intent" value="toggle-active" />
                <input type="hidden" name="id" value={editing.id} />
                {!editing.active && <input type="hidden" name="active" value="on" />}
                <div>
                  <b>Availability</b>
                  <span>
                    {editing.active
                      ? "Active services can be matched to new findings."
                      : "Inactive services stay in your catalog but are not matched."}
                  </span>
                </div>
                <button type="submit" className="btn" disabled={busy}>
                  {editing.active ? "Deactivate" : "Activate"}
                </button>
              </Form>
            )}
            <ServiceForm
              key={editing === "new" ? "new" : editing.id}
              service={editing === "new" ? undefined : editing}
              busy={busy}
              draftStorageKey={draftStorageKey}
              onCancel={() => setEditing(null)}
              error={
                actionData && !actionData.ok && "field" in actionData
                  ? { message: actionData.error, field: actionData.field as ServiceErrorField }
                  : undefined
              }
            />
          </>
        )}
      </SidePanel>
    </div>
  );
}

function ServiceRow({
  service,
  onEdit,
  busy,
}: {
  service: Service;
  onEdit: () => void;
  busy: boolean;
}) {
  const matches = matchesOf(service);
  const mark = markForTags(matches, service.name);
  return (
    <div className={"record service-record" + (service.active ? "" : " is-off")}>
      <div className="record-main">
        <GlyphMark {...mark} className="service-mark" size="lg" />
        <div className="record-name">{service.name}</div>
        {service.description ? (
          <p className="offer-line">{service.description}</p>
        ) : (
          <p className="offer-line faint">
            No description yet — this text goes straight into proposal drafts.
          </p>
        )}
        <div className="tag-row">
          {matches.length > 0 ? (
          matches.map((tag) => (
            <span className="pill quiet" key={tag}>
              <Icon name="target" size={10} />
              Orbit can use this for related website work
            </span>
            ))
          ) : (
            <span className="pill warn">Not matched to any finding</span>
          )}
        </div>
      </div>
      <div className="record-end">
        <div className="record-stat wide">
          <b className="num">{formatCurrencyRange(service.priceMin, service.priceMax)}</b>
          <span>typical range</span>
        </div>
        <div className="record-actions">
          <button className="service-edit" type="button" onClick={onEdit} aria-label={`Edit ${service.name}`}>
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ServiceForm({
  service,
  busy,
  draftStorageKey,
  onCancel,
  error,
}: {
  service?: Service;
  busy: boolean;
  draftStorageKey: string;
  onCancel: () => void;
  error?: { message: string; field: ServiceErrorField };
}) {
  const prefix = service ? service.id.replace(/[^a-z0-9_-]/gi, "-") : "new-service";
  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [priceMin, setPriceMin] = useState(String(service?.priceMin ?? 0));
  const [priceMax, setPriceMax] = useState(String(service?.priceMax ?? 0));
  const [draftReady, setDraftReady] = useState(Boolean(service));
  const [manualMatches, setManualMatches] = useState(
    Boolean(service && matchesOf(service).length > 0),
  );
  const [selectedMatches, setSelectedMatches] = useState<string[]>(() =>
    service ? matchesOf(service) : [],
  );
  const suggestions = suggestServiceTags({ name, description });
  const proposedMatches = suggestions.map((suggestion) => suggestion.tag);
  const effectiveMatches = manualMatches ? selectedMatches : proposedMatches;

  useEffect(() => {
    if (service) return;
    try {
      const stored = window.sessionStorage.getItem(draftStorageKey);
      if (stored) {
        const draft = JSON.parse(stored) as Partial<Record<"name" | "description" | "priceMin" | "priceMax", string>>;
        setName(draft.name ?? "");
        setDescription(draft.description ?? "");
        setPriceMin(draft.priceMin ?? "0");
        setPriceMax(draft.priceMax ?? "0");
      }
    } catch {
      // Private browsing can disable session storage; the live form still works.
    }
    setDraftReady(true);
  }, [draftStorageKey, service]);

  useEffect(() => {
    if (service || !draftReady) return;
    try {
      window.sessionStorage.setItem(
        draftStorageKey,
        JSON.stringify({ name, description, priceMin, priceMax }),
      );
    } catch {
      // Draft persistence is a convenience, not a requirement for saving.
    }
  }, [description, draftReady, draftStorageKey, name, priceMax, priceMin, service]);

  useEffect(() => {
    if (!error) return;
    document.getElementById(`${prefix}-${error.field === "priceMin" ? "min" : error.field === "priceMax" ? "max" : error.field}`)?.focus();
  }, [error, prefix]);

  const toggleMatch = (tag: string, checked: boolean) => {
    setManualMatches(true);
    setSelectedMatches(
      updateServiceTagSelection({
        selectedTags: selectedMatches,
        proposedTags: proposedMatches,
        manual: manualMatches,
        tag,
        checked,
      }),
    );
  };

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="save" />
      <input type="hidden" name="mappingMode" value={manualMatches ? "manual" : "automatic"} />
      {service && <input type="hidden" name="id" value={service.id} />}
      <div className="field">
        <label htmlFor={prefix + "-name"}>Service name</label>
        <input
          id={prefix + "-name"}
          name="name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Service Landing Page"
          aria-describedby={error?.field === "name" ? `${prefix}-name-error` : undefined}
          required
          autoComplete="off"
        />
        {error?.field === "name" && (
          <div className="field-error" id={`${prefix}-name-error`} role="alert">{error.message}</div>
        )}
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor={prefix + "-min"}>Typically from</label>
          <input
            id={prefix + "-min"}
            name="priceMin"
            type="number"
            min={0}
            step={50}
            inputMode="numeric"
            value={priceMin}
            onChange={(event) => setPriceMin(event.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={prefix + "-max"}>Up to</label>
          <input
            id={prefix + "-max"}
            name="priceMax"
            type="number"
            min={0}
            step={50}
            inputMode="numeric"
            value={priceMax}
            onChange={(event) => setPriceMax(event.target.value)}
            aria-describedby={error?.field === "priceMax" ? `${prefix}-price-error` : undefined}
            required
          />
        </div>
      </div>
      {error && (error.field === "priceMin" || error.field === "priceMax") && (
        <div className="field-error" id={`${prefix}-price-error`} role="alert">
          {error.message}
        </div>
      )}
      <div className="field">
        <label htmlFor={prefix + "-description"}>What the client gets</label>
        <textarea
          id={prefix + "-description"}
          name="description"
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="A dedicated, conversion-focused page for one service line: copy, on-page SEO, and a lead-capture call to action."
        />
        <div className="field-hint">This wording is reused verbatim in proposal drafts.</div>
        {error?.field === "description" && <div className="field-error" role="alert">{error.message}</div>}
      </div>
      {effectiveMatches.length > 0 && suggestions.length > 0 ? (
        <div className="notice service-tag-proposal" role="status">
          <Icon name="target" size={15} />
          <div>
            <strong>Suggested mapping</strong>
            <span>Orbit will use this service for related website opportunities.</span>
            <p className="faint">
              {service && matchesOf(service).length > 0
                ? "Your saved mapping stays selected. Open the advanced override only if Orbit misunderstood the service."
                : "This is inferred from your wording. Open the advanced override only if Orbit misunderstood the service."}
            </p>
          </div>
        </div>
      ) : (
        <div className="notice warn service-tag-proposal" role="status">
          <Icon name="alert" size={15} />
          <span>
            {suggestions.length > 0
              ? "Orbit could not connect this service to a specific website opportunity. It will stay in your catalog, but will not price findings until you use the advanced override."
              : "Orbit could not connect this wording to a specific website opportunity. It will stay in your catalog, but will not price findings until you use the advanced override."}
          </span>
        </div>
      )}
      <details className="field service-tag-overrides">
        <summary>Advanced: adjust how Orbit uses this service</summary>
        <fieldset className="fieldset">
          <legend>Only change this if Orbit misunderstood the service</legend>
          {MATCHES.map((match) => (
            <label className="choice" key={match.tag}>
              <input
                type="checkbox"
                name="matches"
                value={match.tag}
                checked={effectiveMatches.includes(match.tag)}
                onChange={(event) => toggleMatch(match.tag, event.target.checked)}
              />
              <span className="choice-body">
                <span className="choice-label">{match.label}</span>
                <span className="choice-hint">{match.hint}</span>
              </span>
            </label>
          ))}
          <div className="field-hint">
            A service connected to nothing is never matched to a finding. Saving is explicit; Orbit
            will not change these choices after you edit an existing service.
          </div>
        </fieldset>
      </details>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : service ? "Save changes" : "Add service"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Form>
  );
}
