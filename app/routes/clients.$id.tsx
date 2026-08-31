import { Form, Link, redirect } from "react-router";

import * as repo from "@/db/repositories";
import { ClientSchema } from "@/core/schema";
import { getDb, rawEnv } from "../lib/context";
import { runAnalysis } from "../lib/analysis.server";
import type { Route } from "./+types/clients.$id";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.client.name} · Client Growth` : "Client" }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const db = getDb(context);
  const client = await repo.getClient(db, params.id);
  if (!client) throw new Response("Client not found", { status: 404 });
  const [services, coverage, evidence, opportunities] = await Promise.all([
    repo.listServices(db),
    repo.listCoverage(db, client.id),
    repo.getLatestEvidence(db, client.id),
    repo.listOpportunities(db, client.id),
  ]);
  return {
    client,
    services,
    coveredIds: coverage.map((c) => c.serviceId),
    lastCapturedAt: evidence?.capturedAt ?? null,
    opportunityCount: opportunities.filter(
      (o) => o.billableStatus === "billable" && (o.status === "new" || o.status === "proposal_prepared"),
    ).length,
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const db = getDb(context);
  const existing = await repo.getClient(db, params.id);
  if (!existing) throw new Response("Client not found", { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "save") {
    const updated = ClientSchema.parse({
      id: existing.id,
      name: String(form.get("name") ?? existing.name).trim(),
      domain: String(form.get("domain") ?? existing.domain)
        .trim()
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, ""),
      offerings: String(form.get("offerings") ?? "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      notes: String(form.get("notes") ?? "").trim(),
    });
    await repo.upsertClient(db, updated);
    return { ok: true as const, message: "Saved." };
  }

  if (intent === "toggle-coverage") {
    const serviceId = String(form.get("serviceId") ?? "");
    if (form.get("covered") === "on") {
      await repo.setCoverage(db, existing.id, serviceId, "Set from client page");
    } else {
      await repo.removeCoverage(db, existing.id, serviceId);
    }
    return { ok: true as const, message: "Coverage updated." };
  }

  if (intent === "analyze") {
    try {
      await runAnalysis(db, rawEnv(context), existing.id);
      return redirect("/opportunities");
    } catch (err) {
      const error =
        err instanceof Response
          ? `${err.status} ${err.statusText}`
          : err instanceof Error
            ? err.message
            : "Analysis failed";
      return { ok: false as const, error };
    }
  }

  throw new Response("Unknown action", { status: 400 });
}

export default function ClientDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { client, services, coveredIds, lastCapturedAt, opportunityCount } = loaderData;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{client.name}</h1>
          <div className="sub">{client.domain}</div>
        </div>
        <Link to="/clients">← All clients</Link>
      </div>

      {actionData && "ok" in actionData && actionData.ok && (
        <div className="notice ok">{actionData.message}</div>
      )}
      {actionData && "ok" in actionData && !actionData.ok && (
        <div className="notice err">{actionData.error}</div>
      )}

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>Website analysis</h3>
          <small>
            {lastCapturedAt
              ? `last scanned ${new Date(lastCapturedAt).toLocaleString()}`
              : "not scanned yet"}
          </small>
        </div>
        <p className="muted">
          Scans up to 10 same-origin pages over HTTP, then runs the opportunity engine.
          {opportunityCount > 0 && (
            <>
              {" "}
              <Link to="/opportunities">
                {opportunityCount} billable opportunit{opportunityCount === 1 ? "y" : "ies"} →
              </Link>
            </>
          )}
        </p>
        <Form method="post">
          <input type="hidden" name="intent" value="analyze" />
          <button type="submit" className="primary">
            Scan website &amp; analyze
          </button>
        </Form>
      </section>

      <section className="card">
        <h3>Contract coverage</h3>
        <p className="muted">
          Tick a service the client already pays for or that their contract includes. Covered
          work is never surfaced as a billable upsell.
        </p>
        <table>
          <tbody>
            {services.map((s) => {
              const covered = coveredIds.includes(s.id);
              return (
                <tr key={s.id}>
                  <td style={{ width: "1%" }}>
                    <Form method="post" className="inline">
                      <input type="hidden" name="intent" value="toggle-coverage" />
                      <input type="hidden" name="serviceId" value={s.id} />
                      {!covered && <input type="hidden" name="covered" value="on" />}
                      <button type="submit" className="subtle" aria-label="toggle coverage">
                        {covered ? "☑" : "☐"}
                      </button>
                    </Form>
                  </td>
                  <td>{s.name}</td>
                  <td className="muted">
                    ${s.priceMin.toLocaleString()}–${s.priceMax.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Client details</h3>
        <Form method="post" className="stack">
          <input type="hidden" name="intent" value="save" />
          <div className="field-row">
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" type="text" defaultValue={client.name} />
            </div>
            <div className="field">
              <label htmlFor="domain">Domain</label>
              <input id="domain" name="domain" type="text" defaultValue={client.domain} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="offerings">Services this client offers (one per line)</label>
            <textarea
              id="offerings"
              name="offerings"
              defaultValue={client.offerings.join("\n")}
            />
          </div>
          <div className="field">
            <label htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              name="notes"
              defaultValue={client.notes}
              style={{ minHeight: "4rem" }}
            />
          </div>
          <div>
            <button type="submit" className="primary">
              Save
            </button>
          </div>
        </Form>
      </section>
    </div>
  );
}
