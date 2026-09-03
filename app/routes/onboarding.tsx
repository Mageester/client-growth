import { Form, redirect, useNavigation } from "react-router";

import * as repo from "@/db/repositories";
import { ClientSchema, ServiceSchema, type RuleId } from "@/core/schema";
import { RULE_SERVICE_LINKS } from "@/core/rules/registry";
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
import { normalizeDomain, validateClientInput, validateServiceInput } from "../lib/validation";
import type { Route } from "./+types/onboarding";

export function meta() {
  return [{ title: "Get started · Axiom Orbit" }];
}

/**
 * The services the engine can actually match today, pre-filled with defensible
 * mid-market prices. Onboarding teaches the product by showing the shapes of
 * finding it can produce, rather than asking for abstract config.
 *
 * Built from the rule registry so this list cannot fall behind it: adding a rule
 * without a starter here is a type error, and a workspace that finishes
 * onboarding is guaranteed to be able to reach every rule.
 */
const STARTER_DEFAULTS: Record<
  RuleId,
  { field: string; name: string; min: number; max: number; when: string }
> = {
  "missing-service-page": {
    field: "landing",
    name: "Service Landing Page",
    min: 900,
    max: 1800,
    when: "a client sells something their website never gives its own page",
  },
  "broken-conversion-path": {
    field: "conversion",
    name: "Conversion Path Fix",
    min: 300,
    max: 900,
    when: "a call-to-action, form or phone link on the site is broken",
  },
};

const STARTER_SERVICES = RULE_SERVICE_LINKS.map((link) => ({
  tag: link.tag,
  ...STARTER_DEFAULTS[link.ruleId],
}));

function slug(prefix: string, name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
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

  const clientInput = {
    name: String(form.get("clientName") ?? ""),
    domain: String(form.get("clientDomain") ?? ""),
    offerings: String(form.get("clientOfferings") ?? ""),
  };
  const clientProblem = validateClientInput(clientInput);
  if (clientProblem) return { error: clientProblem };

  const chosen = STARTER_SERVICES.map((starter) => ({
    starter,
    name: String(form.get(starter.field + "Name") ?? starter.name),
    min: Number(form.get(starter.field + "Min")),
    max: Number(form.get(starter.field + "Max")),
    enabled: form.get(starter.field + "On") === "on",
  })).filter((entry) => entry.enabled);

  if (chosen.length === 0) {
    return { error: "Keep at least one service — findings are priced from what you sell." };
  }
  for (const entry of chosen) {
    const problem = validateServiceInput({
      name: entry.name,
      priceMin: entry.min,
      priceMax: entry.max,
      description: "",
    });
    if (problem) return { error: problem };
  }

  let ws = await getWorkspaceForUser(db, authed.userId);
  if (!ws) {
    ws = await createWorkspaceForOwner(db, {
      id: newWorkspaceId(),
      name: String(form.get("workspaceName") ?? "").trim() || "My Agency",
      ownerUserId: authed.userId,
    });
  }
  const scope: TenantScope = { db, workspaceId: ws.id };

  for (const entry of chosen) {
    await repo.upsertService(
      scope,
      ServiceSchema.parse({
        id: slug("svc", entry.name),
        name: entry.name.trim(),
        description: "",
        priceMin: entry.min,
        priceMax: entry.max,
        tags: [entry.starter.tag],
        active: true,
      }),
    );
  }

  const client = ClientSchema.parse({
    id: slug("client", clientInput.name),
    name: clientInput.name.trim(),
    domain: normalizeDomain(clientInput.domain),
    offerings: clientInput.offerings
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    notes: "",
  });
  await repo.upsertClient(scope, client);

  // The first analysis is the point of onboarding, so its result must not be
  // swallowed. A failed crawl still leaves a usable workspace — the client page
  // says what happened and offers a retry, instead of dropping the user on an
  // empty feed with no explanation.
  try {
    await runAnalysis(scope, env as never, client.id);
    return redirect("/opportunities?client=" + client.id);
  } catch {
    return redirect("/clients/" + client.id + "?firstRun=failed");
  }
}

export default function Onboarding({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <main className="detail onboarding">
      <span className="eyebrow">Setup</span>
      <h1 className="title-lg onboarding-title">Watch your first client site</h1>
      <p className="prose onboarding-lede">
        Axiom Orbit reads a client&rsquo;s website, compares it against what that business
        actually sells, and surfaces the work you could legitimately bill for. Two things to set up,
        then it runs.
      </p>

      {actionData?.error && (
        <div className="notice err" role="alert">
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}

      <Form method="post">
        {!loaderData.hasWorkspace && (
          <section className="section">
            <div className="section-head">
              <div>
                <h2 className="title-section">
                  <span className="step-num">1</span>
                  Your agency
                </h2>
                <p>The workspace name shown across the app.</p>
              </div>
            </div>
            <div className="field onboarding-field">
              <label htmlFor="workspaceName">Agency name</label>
              <input id="workspaceName" name="workspaceName" type="text" required autoComplete="organization" />
            </div>
          </section>
        )}

        <section className="section">
          <div className="section-head">
            <div>
              <h2 className="title-section">
                <span className="step-num">{loaderData.hasWorkspace ? 1 : 2}</span>
                What you sell
              </h2>
              <p>
                Axiom Orbit finds two kinds of gap today. Set what you would charge to fix each
                one — every finding is priced from these, so nothing is surfaced that you could not
                deliver.
              </p>
            </div>
          </div>
          <ul className="starter-list">
            {STARTER_SERVICES.map((service) => (
              <li className="starter" key={service.field}>
                <label className="starter-toggle">
                  <input
                    type="checkbox"
                    name={service.field + "On"}
                    defaultChecked
                    aria-label={"Offer " + service.name}
                  />
                  <span className="starter-copy">
                    <input
                      className="starter-name"
                      name={service.field + "Name"}
                      type="text"
                      defaultValue={service.name}
                      aria-label={service.name + " service name"}
                    />
                    <span className="starter-when">When {service.when}.</span>
                  </span>
                </label>
                <div className="starter-price">
                  <div className="field">
                    <label htmlFor={service.field + "Min"}>From</label>
                    <input
                      id={service.field + "Min"}
                      name={service.field + "Min"}
                      type="number"
                      min={0}
                      step={50}
                      inputMode="numeric"
                      defaultValue={service.min}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={service.field + "Max"}>Up to</label>
                    <input
                      id={service.field + "Max"}
                      name={service.field + "Max"}
                      type="number"
                      min={0}
                      step={50}
                      inputMode="numeric"
                      defaultValue={service.max}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="field-hint">You can rename these and add more services later.</p>
        </section>

        <section className="section">
          <div className="section-head">
            <div>
              <h2 className="title-section">
                <span className="step-num">{loaderData.hasWorkspace ? 2 : 3}</span>
                Your first client
              </h2>
              <p>We read this site as soon as you save, and take you straight to the result.</p>
            </div>
          </div>
          <div className="onboarding-field">
            <div className="field-row">
              <div className="field">
                <label htmlFor="clientName">Client name</label>
                <input id="clientName" name="clientName" type="text" required autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="clientDomain">Website</label>
                <input
                  id="clientDomain"
                  name="clientDomain"
                  type="text"
                  placeholder="example.com"
                  required
                  autoComplete="off"
                  inputMode="url"
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="clientOfferings">What customers hire this business for</label>
              <textarea
                id="clientOfferings"
                name="clientOfferings"
                rows={5}
                placeholder={"heat pump installation\nair conditioning repair\nduct cleaning"}
              />
              <div className="field-hint">
                One per line: things customers actually hire or pay them for, in the words those
                customers would use. Not claims about the business — no "free quotes", "fully
                insured", "family owned", "financing available" or "satisfaction guarantee". Every
                line here can become a priced page recommendation, so a claim in this box becomes a
                pitch for a page about a claim. With fewer than two, Axiom Orbit will not claim
                anything is missing.
              </div>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
              <Icon name="refresh" size={15} className={submitting ? "spin" : undefined} />
              {submitting ? "Reading the site…" : "Save and analyze"}
            </button>
            {submitting && (
              <span className="faint form-actions-note">
                Fetching pages and checking each offering. This usually takes a few seconds.
              </span>
            )}
          </div>
        </section>
      </Form>
    </main>
  );
}
