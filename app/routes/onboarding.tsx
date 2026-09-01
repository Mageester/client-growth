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
import { checkClientDomain } from "../lib/clientDomain";
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

  // Validate the WHOLE form before writing anything. Writing the services first
  // and only then rejecting the client left half-finished setup behind, and a
  // corrected re-submit created a second copy of every service.
  const services = [];
  for (let i = 0; i < 3; i++) {
    const field = "svc" + i;
    const name = String(form.get(field + "Name") ?? "").trim();
    if (!name) continue;
    const min = Math.max(0, Number(form.get(field + "Min")) || 0);
    const max = Math.max(0, Number(form.get(field + "Max")) || min);
    services.push(
      ServiceSchema.parse({
        id: slug("svc", name),
        name,
        description: "",
        priceMin: Math.min(min, max),
        priceMax: Math.max(min, max),
        tags: String(form.get(field + "Tags") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        active: true,
      }),
    );
  }
  if (services.length === 0) return { error: "Add at least one agency service." };

  const name = String(form.get("clientName") ?? "").trim();
  if (!name) return { error: "Enter the client's name and website domain." };
  const checkedDomain = checkClientDomain(String(form.get("clientDomain") ?? ""));
  if (!checkedDomain.ok) return { error: checkedDomain.error! };

  for (const service of services) await repo.upsertService(scope, service);

  const client = ClientSchema.parse({
    id: slug("client", name),
    name,
    domain: checkedDomain.domain,
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
    <main className="onboarding-layout">
      <div className="onboarding-intro">
        <h1>Get started</h1>
        <p>Set up the essentials for your agency, then we’ll take you to Opportunities.</p>
      </div>
      <div className="step-list" aria-label="Setup steps">
        <div className="step is-current"><span className="step-number">1</span><span>Services</span></div>
        <div className="step"><span className="step-number">2</span><span>First client</span></div>
        <div className="step"><span className="step-number">3</span><span>Analyze</span></div>
      </div>
      {actionData?.error && (
        <div className="notice err" role="alert">
          <Icon name="x" size={17} />
          <span>{actionData.error}</span>
        </div>
      )}

      <Form method="post" className="stack">
        {!loaderData.hasWorkspace && (
          <section className="card onboarding-card">
            <h2>Your agency</h2>
            <p>Choose the workspace name you’ll see in the app.</p>
            <div className="field">
              <label htmlFor="workspaceName">Agency / workspace name</label>
              <input id="workspaceName" name="workspaceName" type="text" required />
            </div>
          </section>
        )}

        <section className="card onboarding-card">
          <h2>Your services</h2>
          <p>Tell Client Growth what your agency can offer when a site shows a clear opportunity.</p>
          {DEFAULT_SERVICES.map((service, i) => {
            const field = "svc" + i;
            return (
              <div className="field-row" key={i}>
                <div className="field field-wide">
                  <label htmlFor={field + "Name"}>Name</label>
                  <input id={field + "Name"} name={field + "Name"} type="text" defaultValue={service.name} />
                </div>
                <div className="field">
                  <label htmlFor={field + "Min"}>Min $</label>
                  <input id={field + "Min"} name={field + "Min"} type="number" min={0} defaultValue={service.min} />
                </div>
                <div className="field">
                  <label htmlFor={field + "Max"}>Max $</label>
                  <input id={field + "Max"} name={field + "Max"} type="number" min={0} defaultValue={service.max} />
                </div>
                <div className="field">
                  <label htmlFor={field + "Tags"}>Tags</label>
                  <input id={field + "Tags"} name={field + "Tags"} type="text" defaultValue={service.tags} />
                </div>
              </div>
            );
          })}
        </section>

        <section className="card onboarding-card">
          <h2>Your first client</h2>
          <p>We’ll analyze this site after setup and bring the findings into your opportunity list.</p>
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
            <label htmlFor="clientOfferings">Services this client offers</label>
            <textarea
              id="clientOfferings"
              name="clientOfferings"
              placeholder={"One service per line\nheat pump installation\nair conditioning repair"}
            />
            <div className="field-hint">One service per line. You can set contract coverage after setup.</div>
          </div>
        </section>

        <button type="submit" className="btn btn-primary">
          Save &amp; analyze website
          <Icon name="arrow-up-right" size={15} />
        </button>
      </Form>
    </main>
  );
}
