import { Form, useNavigation } from "react-router";

import { renameWorkspace } from "@/db/workspaces";
import { Icon } from "../components/ui";
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
  const navigation = useNavigation();
  const saving = navigation.state !== "idle";
  return (
    <div>
      <div className="page-head">
        <div className="page-head-copy">
          <h1>Settings</h1>
          <div className="sub">A few essentials for your account and agency workspace.</div>
        </div>
      </div>

      {actionData && "ok" in actionData && actionData.ok && (
        <div className="notice ok" role="status">
          <Icon name="check" size={17} />
          <span>Workspace settings saved.</span>
        </div>
      )}
      {actionData && "error" in actionData && actionData.error && (
        <div className="notice err" role="alert">
          <Icon name="x" size={17} />
          <span>{actionData.error}</span>
        </div>
      )}

      <div className="settings-grid">
        <section className="card settings-section">
          <div className="detail-card-title">
            <h2>Account</h2>
            <Icon name="users" size={18} />
          </div>
          <p className="section-description">The signed-in account connected to this workspace.</p>
          <dl className="kv">
            <dt>Email</dt>
            <dd>{loaderData.email}</dd>
          </dl>
        </section>

        <section className="card settings-section">
          <div className="detail-card-title">
            <h2>Workspace</h2>
            <Icon name="briefcase" size={18} />
          </div>
          <p className="section-description">The agency name shown throughout Client Growth.</p>
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
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <Icon name="check" size={15} />
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </Form>
        </section>

        <section className="card settings-section">
          <div className="detail-card-title">
            <h2>Session</h2>
            <Icon name="settings" size={18} />
          </div>
          <p className="section-description">Sign out of this browser when you’re finished.</p>
          <div className="form-actions">
            <Form method="post" action="/logout">
              <button type="submit" className="btn btn-secondary">Log out</button>
            </Form>
          </div>
        </section>
      </div>
    </div>
  );
}
