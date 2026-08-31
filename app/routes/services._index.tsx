import { Form } from "react-router";

import * as repo from "@/db/repositories";
import { ServiceSchema } from "@/core/schema";
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
  return `svc-${base || "service"}`;
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
    return { ok: true as const };
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
        .map((t) => t.trim())
        .filter(Boolean),
      active: true,
    });
    await repo.upsertService(t.scope, service);
    return { ok: true as const };
  }

  throw new Response("Unknown action", { status: 400 });
}

export default function ServicesIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { services } = loaderData;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Services</h1>
          <div className="sub">Your catalog of billable work and its price ranges.</div>
        </div>
      </div>

      {actionData && !actionData.ok && <div className="notice err">{actionData.error}</div>}

      <div className="card">
        {services.length === 0 ? (
          <div className="empty">No services yet. Add one below.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Price range</th>
                <th>Tags</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    {s.description && (
                      <div className="muted" style={{ fontSize: "0.85rem" }}>
                        {s.description}
                      </div>
                    )}
                  </td>
                  <td className="muted">
                    ${s.priceMin.toLocaleString()}–${s.priceMax.toLocaleString()}
                  </td>
                  <td className="muted">{s.tags.join(", ") || "—"}</td>
                  <td>
                    <Form method="post" className="inline">
                      <input type="hidden" name="intent" value="toggle-active" />
                      <input type="hidden" name="id" value={s.id} />
                      {!s.active && <input type="hidden" name="active" value="on" />}
                      <button type="submit" className="subtle">
                        {s.active ? "Active" : "Inactive"}
                      </button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <section className="card">
        <h2>Add or update a service</h2>
        <Form method="post" className="stack">
          <input type="hidden" name="intent" value="save" />
          <div className="field-row">
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" type="text" required />
            </div>
            <div className="field">
              <label htmlFor="id">ID (blank = generate; existing ID updates)</label>
              <input id="id" name="id" type="text" placeholder="svc-…" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="description">Description</label>
            <textarea id="description" name="description" style={{ minHeight: "3.5rem" }} />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="priceMin">Min price</label>
              <input id="priceMin" name="priceMin" type="number" min={0} defaultValue={0} />
            </div>
            <div className="field">
              <label htmlFor="priceMax">Max price</label>
              <input id="priceMax" name="priceMax" type="number" min={0} defaultValue={0} />
            </div>
            <div className="field">
              <label htmlFor="tags">Tags (comma-separated)</label>
              <input id="tags" name="tags" type="text" placeholder="landing-page" />
            </div>
          </div>
          <div>
            <button type="submit" className="primary">
              Save service
            </button>
          </div>
        </Form>
      </section>
    </div>
  );
}
