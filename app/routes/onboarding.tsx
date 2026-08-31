import { Form, redirect } from "react-router";

import * as repo from "@/db/repositories";
import { ServiceSchema, ClientSchema } from "@/core/schema";
import {
  createWorkspaceForOwner,
  getWorkspaceForUser,
  newWorkspaceId,
} from "@/db/workspaces";
import type { TenantScope } from "@/db/tenant";
import { d1Db } from "../lib/d1.server";
import { requireSession } from "../lib/session.server";
import { runAnalysis } from "../lib/analysis.server";
import type { Route } from "./+types/onboarding";

export function meta() {
  return [{ title: "Get started · Client Growth" }];
}

const DEFAULT_SERVICES = [
  { name: "Service Landing Page", min: 900, max: 1800, tags: "landing-page" },
  { name: "Conversion Path Fix", min: 300, max: 900, tags: "conversion-fix" },
  { name: "", min: 0, max: 0, tags: "" },
];

function slug(prefix: string, name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${prefix}-${base || "x"}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const authed = await requireSession(request, context);
  const db = d1Db(context.cloudflare.env.DB as never);
  const ws = await getWorkspaceForUser(db, authed.userId);
  if (ws) {
    const scope: TenantScope = { db, workspaceId: ws.id };
    if ((await repo.listClients(scope)).length > 0) throw redirect("/opportunities");
  }
  return { hasWorkspace: Boolean(ws), workspaceName: ws?.name ?? "" };
}

export async function action({ request, context }: Route.ActionArgs) {
  const authed = await requireSession(request, context);
  const env = context.cloudflare.env;
  const db = d1Db(env.DB as never);
  const form = await request.formData();

  // 1. ensure a workspace exists (recovers from a partial signup; idempotent)
  let ws = await getWorkspaceForUser(db, authed.userId);
  if (!ws) {
    ws = await createWorkspaceForOwner(db, {
      id: newWorkspaceId(),
      name: String(form.get("workspaceName") ?? "").trim() || "My Agency",
      ownerUserId: authed.userId,
    });
  }
  const scope: TenantScope = { db, workspaceId: ws.id };

  // 2. services
  const serviceIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const name = String(form.get(`svc${i}Name`) ?? "").trim();
    if (!name) continue;
    const min = Number(form.get(`svc${i}Min`)) || 0;
    const max = Number(form.get(`svc${i}Max`)) || min;
    const service = ServiceSchema.parse({
      id: slug("svc", name),
      name,
      description: "",
      priceMin: Math.max(0, Math.min(min, max)),
      priceMax: Math.max(min, max),
      tags: String(form.get(`svc${i}Tags`) ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      active: true,
    });
    await repo.upsertService(scope, service);
    serviceIds.push(service.id);
  }
  if (serviceIds.length === 0) {
    return { error: "Add at least one agency service." };
  }

  // 3. first client
  const name = String(form.get("clientName") ?? "").trim();
  const domain = String(form.get("clientDomain") ?? "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (!name || !domain) return { error: "Enter the client's name and website domain." };

  const client = ClientSchema.parse({
    id: slug("client", name),
    name,
    domain,
    offerings: String(form.get("clientOfferings") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    notes: "",
  });
  await repo.upsertClient(scope, client);

  // 4. analyze (best effort — the client is saved either way)
  try {
    await runAnalysis(scope, env as never, client.id);
  } catch {
    /* ignore — they can re-analyze from the client page */
  }
  return redirect("/opportunities");
}

export default function Onboarding({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main style={{ maxWidth: 640, margin: "5vh auto", padding: "0 1.25rem" }}>
      <h1>Get started</h1>
      <p className="muted">Three quick things, then you land on Opportunities.</p>
      {actionData?.error && <div className="notice err">{actionData.error}</div>}

      <Form method="post" className="stack">
        {!loaderData.hasWorkspace && (
          <section className="card">
            <h2>Your agency</h2>
            <div className="field">
              <label htmlFor="workspaceName">Agency / workspace name</label>
              <input id="workspaceName" name="workspaceName" type="text" required />
            </div>
          </section>
        )}

        <section className="card">
          <h2>1. Your services</h2>
          <p className="muted">
            What you sell, and its price range. The first two power the two analysis rules — edit or
            clear any you don't offer.
          </p>
          {DEFAULT_SERVICES.map((s, i) => (
            <div className="field-row" key={i}>
              <div className="field" style={{ flex: 2 }}>
                <label htmlFor={`svc${i}Name`}>Name</label>
                <input id={`svc${i}Name`} name={`svc${i}Name`} type="text" defaultValue={s.name} />
              </div>
              <div className="field">
                <label htmlFor={`svc${i}Min`}>Min $</label>
                <input id={`svc${i}Min`} name={`svc${i}Min`} type="number" min={0} defaultValue={s.min} />
              </div>
              <div className="field">
                <label htmlFor={`svc${i}Max`}>Max $</label>
                <input id={`svc${i}Max`} name={`svc${i}Max`} type="number" min={0} defaultValue={s.max} />
              </div>
              <div className="field">
                <label htmlFor={`svc${i}Tags`}>Tags</label>
                <input id={`svc${i}Tags`} name={`svc${i}Tags`} type="text" defaultValue={s.tags} />
              </div>
            </div>
          ))}
        </section>

        <section className="card">
          <h2>2. Your first client</h2>
          <div className="field-row">
            <div className="field">
              <label htmlFor="clientName">Name</label>
              <input id="clientName" name="clientName" type="text" required />
            </div>
            <div className="field">
              <label htmlFor="clientDomain">Website domain</label>
              <input id="clientDomain" name="clientDomain" type="text" placeholder="example.com" required />
            </div>
          </div>
          <div className="field">
            <label htmlFor="clientOfferings">Services this client offers (one per line)</label>
            <textarea
              id="clientOfferings"
              name="clientOfferings"
              placeholder={"heat pump installation\nair conditioning repair"}
            />
          </div>
          <p className="muted" style={{ margin: 0 }}>
            You can mark which services are already covered by their contract on the client page
            after setup.
          </p>
        </section>

        <button type="submit" className="primary">
          Save &amp; analyze website
        </button>
      </Form>
    </main>
  );
}
