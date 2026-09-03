import { useEffect, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";

import type { Service } from "@/core/schema";
import { RULE_SERVICE_LINKS } from "@/core/rules/registry";
import { ServiceSchema } from "@/core/schema";
import * as repo from "@/db/repositories";
import {
  EmptyState,
  Icon,
  SidePanel,
  formatCurrencyRange,
  pluralize,
} from "../components/ui";
import { requireTenant } from "../lib/session.server";
import { validateServiceInput } from "../lib/validation";
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

export async function loader({ request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  return { services: await repo.listServices(t.scope) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

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
    if (problem) return { ok: false as const, error: problem };

    const idInput = String(form.get("id") ?? "").trim();
    const existing = idInput ? await repo.getService(t.scope, idInput) : null;
    if (idInput && !existing) {
      return { ok: false as const, error: "That service is no longer in your catalog." };
    }

    const chosen = form
      .getAll("matches")
      .map(String)
      .filter((tag): tag is MatchTag => MATCHES.some((match) => match.tag === tag));
    // Tags this form does not own (imported or legacy) are the user's data, not
    // ours to drop just because this screen has no checkbox for them.
    const preserved = (existing?.tags ?? []).filter((tag) => !(tag in MATCH_LABEL));
    const tags = [...new Set([...chosen, ...preserved])];

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
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [editing, setEditing] = useState<Service | "new" | null>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (navigation.state === "submitting") {
      submitted.current = true;
    } else if (navigation.state === "idle" && submitted.current) {
      submitted.current = false;
      if (actionData?.ok) setEditing(null);
    }
  }, [navigation.state, actionData]);

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
    <div className="directory-page services-directory">
      <div className="pagehead">
        <div className="pagehead-copy">
          <span className="eyebrow">Catalog</span>
          <h1 className="title-page">Services</h1>
          <p className="summary-line">
            {services.length === 0 ? (
              <span>The work your agency can sell when a client site shows a real gap</span>
            ) : (
              <>
                <b className="num">{active.length}</b>
                <span>
                  {pluralize(active.length, "service", "services")} you can sell
                  {services.length !== active.length
                    ? ` · ${services.length - active.length} inactive`
                    : ""}
                </span>
              </>
            )}
          </p>
        </div>
        {services.length > 0 && (
          <div className="pagehead-actions">
            <button className="btn btn-primary" type="button" onClick={() => setEditing("new")}>
              <Icon name="plus" size={15} />
              New service
            </button>
          </div>
        )}
      </div>

      {actionData?.ok && (
        <div className="notice ok" role="status">
          <Icon name="check" size={15} />
          <span>{actionData.message}</span>
        </div>
      )}
      {actionData && !actionData.ok && (
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
            connected to any kind of website gap, so {unmatched.length === 1 ? "it" : "they"} will
            never be matched to a finding. Open{" "}
            {unmatched.length === 1 ? unmatched[0]!.name : "each one"} to set what it answers.
          </span>
        </div>
      )}

      {contested.map((entry) => (
        <div className="notice" role="status" key={entry.label}>
          <Icon name="alert" size={15} />
          <span>
            {entry.claimants.length} active services are offered for {entry.label}. Only{" "}
            <b>{entry.claimants[0]!.name}</b> will be matched and priced — deactivate the others or
            change what they are offered for.
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
        <ul className="records">
          {ordered.map((service) => (
            <li key={service.id}>
              <ServiceRow service={service} onEdit={() => setEditing(service)} busy={busy} />
            </li>
          ))}
        </ul>
      )}

      <SidePanel
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New service" : "Edit service"}
        description="How you describe this work, what you charge, and when it should be offered."
      >
        {editing !== null && (
          <ServiceForm
            service={editing === "new" ? undefined : editing}
            busy={busy}
            onCancel={() => setEditing(null)}
          />
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
  return (
    <div className={"record service-record" + (service.active ? "" : " is-off")}>
      <div className="record-main">
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
                Offered for {MATCH_LABEL[tag]!.toLowerCase()}
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
        <Form method="post" className="inline">
          <input type="hidden" name="intent" value="toggle-active" />
          <input type="hidden" name="id" value={service.id} />
          {!service.active && <input type="hidden" name="active" value="on" />}
          <button
            type="submit"
            className={"state-toggle" + (service.active ? " on" : "")}
            disabled={busy}
            aria-label={
              (service.active ? "Deactivate " : "Activate ") + service.name
            }
          >
            <span className={"dot" + (service.active ? "" : " hollow")} />
            {service.active ? "Active" : "Inactive"}
          </button>
        </Form>
        <div className="record-actions">
          <button className="btn btn-sm" type="button" onClick={onEdit}>
            <Icon name="pencil" size={13} />
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

function ServiceForm({
  service,
  busy,
  onCancel,
}: {
  service?: Service;
  busy: boolean;
  onCancel: () => void;
}) {
  const prefix = service ? service.id.replace(/[^a-z0-9_-]/gi, "-") : "new-service";
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="save" />
      {service && <input type="hidden" name="id" value={service.id} />}
      <div className="field">
        <label htmlFor={prefix + "-name"}>Service name</label>
        <input
          id={prefix + "-name"}
          name="name"
          type="text"
          defaultValue={service?.name}
          placeholder="Service Landing Page"
          required
          autoComplete="off"
        />
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
            defaultValue={service?.priceMin ?? 0}
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
            defaultValue={service?.priceMax ?? 0}
            required
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor={prefix + "-description"}>What the client gets</label>
        <textarea
          id={prefix + "-description"}
          name="description"
          rows={4}
          defaultValue={service?.description}
          placeholder="A dedicated, conversion-focused page for one service line: copy, on-page SEO, and a lead-capture call to action."
        />
        <div className="field-hint">This wording is reused verbatim in proposal drafts.</div>
      </div>
      <fieldset className="field fieldset">
        <legend>Offer this when a site shows</legend>
        {MATCHES.map((match) => (
          <label className="choice" key={match.tag}>
            <input
              type="checkbox"
              name="matches"
              value={match.tag}
              defaultChecked={service ? service.tags.includes(match.tag) : false}
            />
            <span className="choice-body">
              <span className="choice-label">{match.label}</span>
              <span className="choice-hint">{match.hint}</span>
            </span>
          </label>
        ))}
        <div className="field-hint">
          A service connected to nothing is never matched to a finding.
        </div>
      </fieldset>
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
