import { useEffect, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";

import type { Service } from "@/core/schema";
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
import type { Route } from "./+types/services._index";

export function meta() {
  return [{ title: "Services · Client Growth" }];
}

function slugId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return "svc-" + (base || "service");
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
    await repo.setServiceActive(t.scope, String(form.get("id")), form.get("active") === "on");
    return { ok: true as const, message: "Service status updated." };
  }

  if (intent === "save") {
    const name = String(form.get("name") ?? "").trim();
    const priceMin = Number(form.get("priceMin"));
    const priceMax = Number(form.get("priceMax"));
    if (!name) return { ok: false as const, error: "Name is required." };
    if (!(priceMax >= priceMin) || priceMin < 0) {
      return { ok: false as const, error: "Price range is invalid." };
    }
    const idInput = String(form.get("id") ?? "").trim();
    const service = ServiceSchema.parse({
      id: idInput || slugId(name),
      name,
      description: String(form.get("description") ?? "").trim(),
      priceMin,
      priceMax,
      tags: String(form.get("tags") ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      active: true,
    });
    await repo.upsertService(t.scope, service);
    return { ok: true as const, message: idInput ? "Service changes saved." : "Service added." };
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

  const activeCount = services.filter((service) => service.active).length;
  const ordered = [...services].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name),
  );

  return (
    <div>
      <div className="pagehead">
        <div className="pagehead-copy">
          <span className="eyebrow">Catalog</span>
          <h1 className="title-page">Services</h1>
          <p className="summary-line">
            <span>What your agency can sell when a client site shows a real gap</span>
            {services.length > 0 && (
              <>
                <span className="dot-sep">·</span>
                <b>{activeCount}</b>
                <span>
                  active of {services.length}{" "}
                  {pluralize(services.length, "offering", "offerings")}
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
          List the work you actually sell, with the price range you would quote. Opportunities are
          matched to these offerings so every finding carries a realistic value.
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
        description="How you describe this offering, and what you would charge for it."
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
  return (
    <div className={"record service-record" + (service.active ? "" : " is-off")}>
      <div className="record-main">
        <div className="record-name">{service.name}</div>
        {service.description && <p className="offer-line">{service.description}</p>}
        {service.tags.length > 0 && (
          <div className="tag-row">
            {service.tags.map((tag) => (
              <span className="pill quiet" key={tag}>
                <Icon name="tag" size={10} />
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="record-end">
        <div className="record-stat wide">
          <b>{formatCurrencyRange(service.priceMin, service.priceMax)}</b>
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
            aria-label={(service.active ? "Deactivate " : "Activate ") + service.name}
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
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor={prefix + "-min"}>From</label>
          <input
            id={prefix + "-min"}
            name="priceMin"
            type="number"
            min={0}
            defaultValue={service?.priceMin ?? 0}
          />
        </div>
        <div className="field">
          <label htmlFor={prefix + "-max"}>Up to</label>
          <input
            id={prefix + "-max"}
            name="priceMax"
            type="number"
            min={0}
            defaultValue={service?.priceMax ?? 0}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor={prefix + "-description"}>Description</label>
        <textarea
          id={prefix + "-description"}
          name="description"
          defaultValue={service?.description}
          placeholder="What the client gets, in a sentence or two."
        />
      </div>
      <div className="field">
        <label htmlFor={prefix + "-tags"}>Tags</label>
        <input
          id={prefix + "-tags"}
          name="tags"
          type="text"
          defaultValue={service?.tags.join(", ")}
          placeholder="landing-page, conversion-fix"
        />
        <div className="field-hint">
          Comma separated. Tags connect a finding to the right offering.
        </div>
      </div>
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
