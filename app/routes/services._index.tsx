import { useState } from "react";
import { Form } from "react-router";

import type { Service } from "@/core/schema";
import { ServiceSchema } from "@/core/schema";
import * as repo from "@/db/repositories";
import { formatCurrencyRange, Icon } from "../components/ui";
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
    // Creating: the slug is derived from the name, so two services whose names
    // slug the same ("Landing Page" / "landing page", or any two names sharing
    // a 40-character prefix) used to collide and silently overwrite the first.
    // Editing: keep the row's existing id and its active flag.
    let id = idInput;
    let active = true;
    if (idInput) {
      active = (await repo.getService(t.scope, idInput))?.active ?? true;
    } else {
      const base = slugId(name);
      id = base;
      for (let n = 2; (await repo.getService(t.scope, id)) !== null; n++) {
        id = `${base}-${n}`;
      }
    }
    const service = ServiceSchema.parse({
      id,
      name,
      description: String(form.get("description") ?? "").trim(),
      priceMin,
      priceMax,
      tags: String(form.get("tags") ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      active,
    });
    await repo.upsertService(t.scope, service);
    return { ok: true as const, message: idInput ? "Service changes saved." : "Service added." };
  }

  throw new Response("Unknown action", { status: 400 });
}

export default function ServicesIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { services } = loaderData;
  const [addOpen, setAddOpen] = useState(services.length === 0);
  const activeCount = services.filter((service) => service.active).length;

  return (
    <div>
      <div className="page-head">
        <div className="page-head-copy">
          <h1>Services</h1>
          <div className="sub">The work you can offer when a client site shows a clear opportunity.</div>
        </div>
      </div>

      {actionData?.ok && (
        <div className="notice ok" role="status">
          <Icon name="check" size={17} />
          <span>{actionData.message}</span>
        </div>
      )}
      {actionData && !actionData.ok && (
        <div className="notice err" role="alert">
          <Icon name="x" size={17} />
          <span>{actionData.error}</span>
        </div>
      )}

      <section className="card list-shell">
        <div className="list-toolbar">
          <div>
            <strong>Service catalog</strong>
            <div className="list-toolbar-copy">
              {services.length} {services.length === 1 ? "service" : "services"} · {activeCount} active
            </div>
          </div>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setAddOpen(true)}>
            <Icon name="plus" size={16} />
            Add service
          </button>
        </div>
        {services.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon"><Icon name="briefcase" size={20} /></span>
            <h2>No services yet</h2>
            <p>Add the work your agency sells so opportunities can carry a useful billable range.</p>
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Price range</th>
                  <th>Tags</th>
                  <th>Status</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <ServiceRow key={service.id} service={service} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <details
        id="add-service"
        className="form-drawer"
        open={addOpen}
        onToggle={(event) => setAddOpen(event.currentTarget.open)}
      >
        <summary className="drawer-summary">
          <span className="drawer-summary-copy">
            <strong>Add a service</strong>
            <small>Keep your catalog simple so recommendations stay grounded.</small>
          </span>
          <span className="btn btn-primary btn-sm">
            <Icon name="plus" size={16} />
            New service
          </span>
        </summary>
        <div className="drawer-panel">
          <ServiceForm />
        </div>
      </details>
    </div>
  );
}

function ServiceRow({ service }: { service: Service }) {
  const idPrefix = service.id.replace(/[^a-z0-9_-]/gi, "-");
  return (
    <tr>
      <td>
        <div className="service-name">{service.name}</div>
        {service.description && <div className="service-description">{service.description}</div>}
      </td>
      <td><span className="cell-primary">{formatCurrencyRange(service.priceMin, service.priceMax)}</span></td>
      <td>
        {service.tags.length > 0 ? (
          <div className="tag-list">
            {service.tags.map((tag) => (
              <span className="tag" key={tag}><Icon name="tag" size={12} />{tag}</span>
            ))}
          </div>
        ) : (
          <span className="cell-muted">No tags</span>
        )}
      </td>
      <td>
        <Form method="post" className="inline">
          <input type="hidden" name="intent" value="toggle-active" />
          <input type="hidden" name="id" value={service.id} />
          {!service.active && <input type="hidden" name="active" value="on" />}
          <button
            type="submit"
            className={"status-toggle " + (service.active ? "is-active" : "is-inactive")}
            aria-label={(service.active ? "Deactivate " : "Activate ") + service.name}
          >
            <span className="status-dot" />
            {service.active ? "Active" : "Inactive"}
          </button>
        </Form>
      </td>
      <td>
        <details className="edit-drawer">
          <summary>
            <span className="btn btn-secondary btn-sm">
              Edit
              <Icon name="chevron-down" size={14} />
            </span>
          </summary>
          <div className="drawer-panel">
            <ServiceForm service={service} idPrefix={idPrefix} />
          </div>
        </details>
      </td>
    </tr>
  );
}

function ServiceForm({ service, idPrefix = "new-service" }: { service?: Service; idPrefix?: string }) {
  return (
    <Form method="post" className="stack">
      <input type="hidden" name="intent" value="save" />
      {service && <input type="hidden" name="id" value={service.id} />}
      <div className="field-row">
        <div className="field field-wide">
          <label htmlFor={idPrefix + "-name"}>Service name</label>
          <input id={idPrefix + "-name"} name="name" type="text" defaultValue={service?.name} required />
        </div>
        <div className="field">
          <label htmlFor={idPrefix + "-min"}>Minimum price</label>
          <input id={idPrefix + "-min"} name="priceMin" type="number" min={0} defaultValue={service?.priceMin ?? 0} />
        </div>
        <div className="field">
          <label htmlFor={idPrefix + "-max"}>Maximum price</label>
          <input id={idPrefix + "-max"} name="priceMax" type="number" min={0} defaultValue={service?.priceMax ?? 0} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={idPrefix + "-description"}>Description</label>
        <textarea id={idPrefix + "-description"} name="description" defaultValue={service?.description} />
      </div>
      <div className="field">
        <label htmlFor={idPrefix + "-tags"}>Tags</label>
        <input id={idPrefix + "-tags"} name="tags" type="text" defaultValue={service?.tags.join(", ")} placeholder="landing-page, conversion-fix" />
        <div className="field-hint">Use commas to separate tags used by analysis rules.</div>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          {service ? "Save changes" : "Add service"}
          <Icon name="check" size={15} />
        </button>
      </div>
    </Form>
  );
}
