import { Form, Link, redirect } from "react-router";

import * as repo from "@/db/repositories";
import { generateProposalDraft } from "@/core/proposal";
import { getDb } from "../lib/context";
import type { Route } from "./+types/opportunities.$id";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.opportunity.title} · Client Growth` : "Opportunity" }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const db = getDb(context);
  const opportunity = await repo.getOpportunity(db, params.id);
  if (!opportunity) throw new Response("Opportunity not found", { status: 404 });
  const [client, service, evidence] = await Promise.all([
    repo.getClient(db, opportunity.clientId),
    repo.getService(db, opportunity.suggestedServiceId),
    repo.getLatestEvidence(db, opportunity.clientId),
  ]);
  return { opportunity, client, service, capturedAt: evidence?.capturedAt ?? null };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const db = getDb(context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const opp = await repo.getOpportunity(db, params.id);
  if (!opp) throw new Response("Opportunity not found", { status: 404 });

  switch (intent) {
    case "dismiss":
      await repo.setOpportunityStatus(db, opp.id, "dismissed");
      break;
    case "reopen":
      await repo.setOpportunityStatus(db, opp.id, "new");
      break;
    case "cover":
      await repo.setOpportunityStatus(db, opp.id, "already_covered");
      await repo.setCoverage(
        db,
        opp.clientId,
        opp.suggestedServiceId,
        "Marked covered from opportunity review",
      );
      break;
    case "snooze": {
      const days = Math.max(1, Number(form.get("days") ?? 30));
      const until = new Date(Date.now() + days * 86_400_000).toISOString();
      await repo.setOpportunityStatus(db, opp.id, "snoozed", until);
      break;
    }
    case "prepare-proposal": {
      const [client, service] = await Promise.all([
        repo.getClient(db, opp.clientId),
        repo.getService(db, opp.suggestedServiceId),
      ]);
      if (!client || !service) throw new Response("Client or service missing", { status: 409 });
      const draft = generateProposalDraft({ opportunity: opp, client, service });
      await repo.setOpportunityProposal(db, opp.id, draft);
      break;
    }
    case "save-proposal": {
      const body = String(form.get("proposalMd") ?? "").trim();
      if (body) await repo.setOpportunityProposal(db, opp.id, body);
      break;
    }
    default:
      throw new Response("Unknown action", { status: 400 });
  }
  return redirect(`/opportunities/${opp.id}`);
}

export default function OpportunityDetail({ loaderData }: Route.ComponentProps) {
  const { opportunity: o, client, service, capturedAt } = loaderData;
  const pageRefs = o.evidenceRefs.filter((r) => !r.startsWith("nav:"));
  const navRefs = o.evidenceRefs.filter((r) => r.startsWith("nav:")).map((r) => r.slice(4));

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{o.title}</h1>
          <div className="sub">
            {client ? <Link to={`/clients/${client.id}`}>{client.name}</Link> : "Unknown client"}
            {" · "}
            {o.billableStatus === "already_covered" ? "Already covered" : "Billable"}
            {" · "}
            {Math.round(o.confidence * 100)}% confidence
          </div>
        </div>
        <Link to="/opportunities">← All opportunities</Link>
      </div>

      <section className="card">
        <h3>What was detected</h3>
        <p>{o.detected}</p>
        <h3>Why it matters</h3>
        <p>{o.rationale}</p>
        <hr className="divider" />
        <dl className="kv">
          <dt>Suggested service</dt>
          <dd>{service ? service.name : o.suggestedServiceId}</dd>
          <dt>Price range</dt>
          <dd>
            ${o.priceMin.toLocaleString()}–${o.priceMax.toLocaleString()}
          </dd>
          <dt>Status</dt>
          <dd>{o.status.replace(/_/g, " ")}</dd>
          {o.snoozeUntil && (
            <>
              <dt>Snoozed until</dt>
              <dd>{new Date(o.snoozeUntil).toLocaleDateString()}</dd>
            </>
          )}
        </dl>
        {o.suggestedScope.length > 0 && (
          <>
            <h3 style={{ marginTop: "1rem" }}>Proposed scope</h3>
            <ul className="scope-list">
              {o.suggestedScope.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>Evidence</h3>
          {capturedAt && <small>captured {new Date(capturedAt).toLocaleString()}</small>}
        </div>
        <ul className="evidence-list">
          {pageRefs.map((ref) => (
            <li key={ref}>
              <a href={ref} target="_blank" rel="noreferrer">
                {ref}
              </a>
            </li>
          ))}
        </ul>
        {navRefs.length > 0 && (
          <p className="muted" style={{ marginTop: "0.6rem", marginBottom: 0 }}>
            Navigation checked: {navRefs.join(", ")}
          </p>
        )}
      </section>

      <section className="card">
        <h3>Agency actions</h3>
        <div className="row-actions">
          {o.status !== "new" && (
            <Form method="post" className="inline">
              <input type="hidden" name="intent" value="reopen" />
              <button type="submit">Reopen</button>
            </Form>
          )}
          <Form method="post" className="inline">
            <input type="hidden" name="intent" value="prepare-proposal" />
            <button type="submit" className="primary">
              {o.proposalMd ? "Regenerate proposal draft" : "Prepare proposal"}
            </button>
          </Form>
          <Form method="post" className="inline">
            <input type="hidden" name="intent" value="dismiss" />
            <button type="submit" className="danger">
              Dismiss
            </button>
          </Form>
          <Form method="post" className="inline">
            <input type="hidden" name="intent" value="cover" />
            <button type="submit">Mark already covered</button>
          </Form>
          <Form method="post" className="inline row-actions">
            <input type="hidden" name="intent" value="snooze" />
            <input
              type="number"
              name="days"
              defaultValue={30}
              min={1}
              style={{ width: "4.5rem" }}
              aria-label="Snooze days"
            />
            <button type="submit">Snooze days</button>
          </Form>
        </div>
      </section>

      {o.proposalMd && (
        <section className="card">
          <div className="card-head">
            <h3 style={{ margin: 0 }}>Proposal draft</h3>
            <span className="badge proposal">Editable</span>
          </div>
          <Form method="post" className="stack">
            <input type="hidden" name="intent" value="save-proposal" />
            <textarea name="proposalMd" defaultValue={o.proposalMd} style={{ minHeight: "22rem" }} />
            <div className="row-actions">
              <button type="submit" className="primary">
                Save draft
              </button>
              <small className="muted">
                Draft only — nothing is sent. Copy into your proposal tool when ready.
              </small>
            </div>
          </Form>
        </section>
      )}
    </div>
  );
}
