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
    <div className="detail detail-narrow">
      <div className="pagehead">
        <div className="pagehead-copy">
          <span className="eyebrow">Account</span>
          <h1 className="title-page">Settings</h1>
        </div>
      </div>

      {actionData && "ok" in actionData && actionData.ok && (
        <div className="notice ok" role="status">
          <Icon name="check" size={15} />
          <span>Workspace saved.</span>
        </div>
      )}
      {actionData && "error" in actionData && actionData.error && (
        <div className="notice err" role="alert">
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Workspace</h2>
            <p>The agency name shown across Client Growth.</p>
          </div>
        </div>
        <Form method="post">
          <div className="field">
            <label htmlFor="workspaceName">Workspace name</label>
            <input
              id="workspaceName"
              name="workspaceName"
              type="text"
              defaultValue={loaderData.workspaceName}
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </Form>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Account</h2>
            <p>The signed-in account that owns this workspace.</p>
          </div>
        </div>
        <dl>
          <div className="kv-row">
            <dt>Email</dt>
            <dd>{loaderData.email}</dd>
          </div>
        </dl>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Session</h2>
            <p>Sign out of this browser when you are finished.</p>
          </div>
          <Form method="post" action="/logout">
            <button type="submit" className="btn">
              <Icon name="logout" size={14} />
              Log out
            </button>
          </Form>
        </div>
      </section>
    </div>
  );
}
