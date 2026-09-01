import { Form, redirect } from "react-router";

import * as repo from "@/db/repositories";
import { ClientSchema, ServiceSchema } from "@/core/schema";
import {
  createWorkspaceForOwner,
  getWorkspaceForUser,
  newWorkspaceId,
} from "@/db/workspaces";
import type { TenantScope } from "@/db/tenant";
import { Icon } from "../components/ui";
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
  return prefix + "-" + (base || "x") + "-" + Math.random().toString(36).slice(2, 6);
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

  let ws = await getWorkspaceForUser(db, authed.userId);
  if (!ws) {
    ws = await createWorkspaceForOwner(db, {
      id: newWorkspaceId(),
      name: String(form.get("workspaceName") ?? "").trim() || "My Agency",
      ownerUserId: authed.userId,
    });
  }
  const scope: TenantScope = { db, workspaceId: ws.id };

  const serviceIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const field = "svc" + i;
    const name = String(form.get(field + "Name") ?? "").trim();
    if (!name) continue;
    const min = Number(form.get(field + "Min")) || 0;
    const max = Number(form.get(field + "Max")) || min;
    const service = ServiceSchema.parse({
      id: slug("svc", name),
      name,
      description: "",
      priceMin: Math.max(0, Math.min(min, max)),
      priceMax: Math.max(min, max),
      tags: String(form.get(field + "Tags") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      active: true,
    });
    await repo.upsertService(scope, service);
    serviceIds.push(service.id);
  }
  if (serviceIds.length === 0) return { error: "Add at least one agency service." };

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

  try {
    await runAnalysis(scope, env as never, client.id);
  } catch {
    /* The client is saved either way; they can re-analyze from the client page. */
  }
  return redirect("/opportunities");
}

export default function Onboarding({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main className="detail">
      <span className="eyebrow">Setup</span>
      <h1 className="title-lg" style={{ marginTop: "0.3rem" }}>
        Get your workspace ready
      </h1>
      <p className="prose" style={{ marginTop: "0.55rem" }}>
        Two things: what your agency sells, and the first client site to look at. We analyze it
        straight after and take you to your opportunities.
      </p>
      <div className="steps" aria-label="Setup steps">
        <span className="step is-current">
          <span className="step-num">1</span>
          Services
        </span>
        <span className="step-rule" />
        <span className="step">
          <span className="step-num">2</span>
          First client
        </span>
        <span className="step-rule" />
        <span className="step">
          <span className="step-num">3</span>
          Analyze
        </span>
      </div>

      {actionData?.error && (
        <div className="notice err" role="alert" style={{ marginTop: "1.5rem" }}>
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}

      <Form method="post">
        {!loaderData.hasWorkspace && (
          <section className="section">
            <div className="section-head">
              <div>
                <h2 className="title-section">Your agency</h2>
                <p>The workspace name you will see across the app.</p>
              </div>
            </div>
            <div className="field" style={{ maxWidth: "24rem" }}>
              <label htmlFor="workspaceName">Agency name</label>
              <input id="workspaceName" name="workspaceName" type="text" required />
            </div>
          </section>
        )}

        <section className="section">
          <div className="section-head">
            <div>
              <h2 className="title-section">What you sell</h2>
              <p>
                The work you can offer when a client site shows a clear gap. Price ranges keep every
                finding grounded in real money.
              </p>
            </div>
          </div>
          {DEFAULT_SERVICES.map((service, i) => {
            const field = "svc" + i;
            return (
              <div className="field-row split-3" key={i} style={{ marginTop: i ? "0.9rem" : 0 }}>
                <div className="field">
                  <label htmlFor={field + "Name"}>Service {i + 1}</label>
                  <input
                    id={field + "Name"}
                    name={field + "Name"}
                    type="text"
                    defaultValue={service.name}
                    placeholder={i === 2 ? "Optional" : undefined}
                  />
                </div>
                <div className="field">
                  <label htmlFor={field + "Min"}>From</label>
                  <input
                    id={field + "Min"}
                    name={field + "Min"}
                    type="number"
                    min={0}
                    defaultValue={service.min}
                  />
                </div>
                <div className="field">
                  <label htmlFor={field + "Max"}>Up to</label>
                  <input
                    id={field + "Max"}
                    name={field + "Max"}
                    type="number"
                    min={0}
                    defaultValue={service.max}
                  />
                </div>
                <input
                  id={field + "Tags"}
                  name={field + "Tags"}
                  type="hidden"
                  defaultValue={service.tags}
                />
              </div>
            );
          })}
        </section>

        <section className="section">
          <div className="section-head">
            <div>
              <h2 className="title-section">Your first client</h2>
              <p>We analyze this site as soon as setup is saved.</p>
            </div>
          </div>
          <div style={{ maxWidth: "34rem" }}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="clientName">Client name</label>
                <input id="clientName" name="clientName" type="text" required />
              </div>
              <div className="field">
                <label htmlFor="clientDomain">Website</label>
                <input
                  id="clientDomain"
                  name="clientDomain"
                  type="text"
                  placeholder="example.com"
                  required
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="clientOfferings">What this business sells</label>
              <textarea
                id="clientOfferings"
                name="clientOfferings"
                placeholder={"One per line\nheat pump installation\nair conditioning repair"}
              />
              <div className="field-hint">
                Used to check whether their site actually covers what they sell. Contract coverage
                can be set later.
              </div>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-lg">
              Save and analyze
              <Icon name="arrow-right" size={15} />
            </button>
          </div>
        </section>
      </Form>
    </main>
  );
}
