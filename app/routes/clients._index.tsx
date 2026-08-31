import { Form, Link } from "react-router";

import * as repo from "@/db/repositories";
import { ClientSchema } from "@/core/schema";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/clients._index";

export function meta() {
  return [{ title: "Clients · Client Growth" }];
}

function slugId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `client-${base || "unnamed"}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  return { clients: await repo.listClients(t.scope) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const domain = String(form.get("domain") ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!name || !domain) return { ok: false as const, error: "Name and domain are required." };

  const offerings = String(form.get("offerings") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const client = ClientSchema.parse({
    id: slugId(name),
    name,
    domain,
    offerings,
    notes: String(form.get("notes") ?? "").trim(),
  });
  await repo.upsertClient(t.scope, client);
  return { ok: true as const, id: client.id };
}

export default function ClientsIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { clients } = loaderData;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Clients</h1>
          <div className="sub">Existing clients you manage websites for.</div>
        </div>
      </div>

      {actionData?.ok && (
        <div className="notice ok">
          Client added. <Link to={`/clients/${actionData.id}`}>Open it →</Link>
        </div>
      )}
      {actionData && !actionData.ok && <div className="notice err">{actionData.error}</div>}

      {clients.length === 0 ? (
        <div className="card">
          <div className="empty">No clients yet. Add your first one below.</div>
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Domain</th>
                <th>Offerings</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/clients/${c.id}`}>{c.name}</Link>
                  </td>
                  <td className="muted">{c.domain}</td>
                  <td className="muted">{c.offerings.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="card">
        <h2>Add a client</h2>
        <Form method="post" className="stack">
          <div className="field-row">
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" type="text" required />
            </div>
            <div className="field">
              <label htmlFor="domain">Website domain</label>
              <input id="domain" name="domain" type="text" placeholder="example.com" required />
            </div>
          </div>
          <div className="field">
            <label htmlFor="offerings">Services this client offers (one per line)</label>
            <textarea
              id="offerings"
              name="offerings"
              placeholder={"heat pump installation\nair conditioning repair"}
            />
          </div>
          <div className="field">
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" style={{ minHeight: "4rem" }} />
          </div>
          <div>
            <button type="submit" className="primary">
              Add client
            </button>
          </div>
        </Form>
      </section>
    </div>
  );
}
