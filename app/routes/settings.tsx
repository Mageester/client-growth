import { Form } from "react-router";

import { renameWorkspace } from "@/db/workspaces";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/settings";

export function meta() {
  return [{ title: "Settings · Client Growth" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  return { email: t.user.email, workspaceName: t.workspace.name };
}

export async function action({ request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const form = await request.formData();
  const name = String(form.get("workspaceName") ?? "").trim();
  if (!name) return { error: "Workspace name cannot be empty." };
  await renameWorkspace(t.db, t.workspace.id, name);
  return { ok: true };
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      {actionData && "ok" in actionData && actionData.ok && (
        <div className="notice ok">Saved.</div>
      )}
      {actionData && "error" in actionData && actionData.error && (
        <div className="notice err">{actionData.error}</div>
      )}

      <section className="card">
        <h3>Account</h3>
        <dl className="kv">
          <dt>Email</dt>
          <dd>{loaderData.email}</dd>
        </dl>
      </section>

      <section className="card">
        <h3>Workspace</h3>
        <Form method="post" className="stack">
          <div className="field">
            <label htmlFor="workspaceName">Agency / workspace name</label>
            <input
              id="workspaceName"
              name="workspaceName"
              type="text"
              defaultValue={loaderData.workspaceName}
            />
          </div>
          <button type="submit" className="primary">
            Save
          </button>
        </Form>
      </section>

      <section className="card">
        <h3>Session</h3>
        <Form method="post" action="/logout">
          <button type="submit">Log out</button>
        </Form>
      </section>
    </div>
  );
}
