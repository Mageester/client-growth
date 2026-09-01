import { Form, Link, redirect, useNavigation } from "react-router";

import * as repo from "@/db/repositories";
import { describeEvidenceRef } from "@/core/evidenceRef";
import { generateProposalDraft } from "@/core/proposal";
import { formatCurrencyRange, formatDate, Icon } from "../components/ui";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/opportunities.$id";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? data.opportunity.title + " · Client Growth" : "Opportunity" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  const opportunity = await repo.getOpportunity(t.scope, params.id);
  if (!opportunity) throw new Response("Opportunity not found", { status: 404 });
  const [client, service, evidence] = await Promise.all([
    repo.getClient(t.scope, opportunity.clientId),
    repo.getService(t.scope, opportunity.suggestedServiceId),
    repo.getLatestEvidence(t.scope, opportunity.clientId),
  ]);
  return { opportunity, client, service, capturedAt: evidence?.capturedAt ?? null };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const opp = await repo.getOpportunity(t.scope, params.id);
  if (!opp) throw new Response("Opportunity not found", { status: 404 });

  switch (intent) {
    case "dismiss":
      await repo.setOpportunityStatus(t.scope, opp.id, "dismissed");
      break;
    case "reopen":
      await repo.setOpportunityStatus(t.scope, opp.id, "new");
      break;
    case "cover":
      await repo.setOpportunityStatus(t.scope, opp.id, "already_covered");
      await repo.setCoverage(
        t.scope,
        opp.clientId,
        opp.suggestedServiceId,
        "Marked covered from opportunity review",
      );
      break;
    case "snooze": {
      const days = Math.max(1, Number(form.get("days") ?? 30));
      const until = new Date(Date.now() + days * 86_400_000).toISOString();
      await repo.setOpportunityStatus(t.scope, opp.id, "snoozed", until);
      break;
    }
    case "prepare-proposal": {
      const [client, service] = await Promise.all([
        repo.getClient(t.scope, opp.clientId),
        repo.getService(t.scope, opp.suggestedServiceId),
      ]);
      if (!client || !service) throw new Response("Client or service missing", { status: 409 });
      const draft = generateProposalDraft({ opportunity: opp, client, service });
      await repo.setOpportunityProposal(t.scope, opp.id, draft);
      break;
    }
    case "save-proposal": {
      const body = String(form.get("proposalMd") ?? "").trim();
      if (body) await repo.setOpportunityProposal(t.scope, opp.id, body);
      break;
    }
    default:
      throw new Response("Unknown action", { status: 400 });
  }
  return redirect("/opportunities/" + opp.id);
}

function statusLabel(opp: Awaited<ReturnType<typeof loader>>["opportunity"]) {
  if (opp.status === "proposal_prepared") return { label: "Proposal ready", tone: "proposal" };
  if (opp.status === "resolved") return { label: "Resolved", tone: "covered" };
  if (opp.status === "dismissed") return { label: "Dismissed", tone: "dismissed" };
  if (opp.status === "snoozed") return { label: "Snoozed", tone: "snoozed" };
  if (opp.billableStatus === "already_covered" || opp.status === "already_covered") {
    return { label: "Already covered", tone: "covered" };
  }
  return { label: "New", tone: "billable" };
}

export default function OpportunityDetail({ loaderData }: Route.ComponentProps) {
  const { opportunity: opp, client, service, capturedAt } = loaderData;
  const pageRefs = opp.evidenceRefs.filter((ref) => !ref.startsWith("nav:"));
  const navRefs = opp.evidenceRefs.filter((ref) => ref.startsWith("nav:")).map((ref) => ref.slice(4));
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const status = statusLabel(opp);

  return (
    <div className="detail-layout">
      <div className="detail-lede">
        <div>
          <h1>{opp.title}</h1>
          <div className="sub">
            {client ? <Link to={"/clients/" + client.id}>{client.name}</Link> : "Unknown client"}
            <span className="meta-dot">•</span>
            <span className={"status " + status.tone}>{status.label}</span>
            <span className="meta-dot">•</span>
            <span>{Math.round(opp.confidence * 100)}% confidence</span>
          </div>
        </div>
        <Link className="btn btn-secondary" to="/opportunities">
          <Icon name="arrow-up-right" size={15} />
          All opportunities
        </Link>
      </div>

      <section className="card">
        <div className="detail-card-title">
          <div>
            <h2>What was detected</h2>
            <p className="muted">The evidence and reasoning behind this recommendation.</p>
          </div>
          <Icon name="activity" size={18} />
        </div>
        <p>{opp.detected}</p>
        <h3>Why it matters</h3>
        <p className="muted">{opp.rationale}</p>
        <hr className="divider" />
        <dl className="kv">
          <dt>Suggested service</dt>
          <dd>{service ? service.name : opp.suggestedServiceId}</dd>
          <dt>Estimated range</dt>
          <dd>{formatCurrencyRange(opp.priceMin, opp.priceMax)}</dd>
          <dt>Decision</dt>
          <dd>{status.label}</dd>
          {opp.snoozeUntil && (
            <>
              <dt>Snoozed until</dt>
              <dd>{formatDate(opp.snoozeUntil)}</dd>
            </>
          )}
        </dl>
        {opp.suggestedScope.length > 0 && (
          <>
            <h3>Proposed scope</h3>
            <ul className="scope-list">
              {opp.suggestedScope.map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <div className="detail-card-title">
          <div>
            <h2>Evidence</h2>
            <p className="muted">Pages checked during the latest analysis.</p>
          </div>
          {capturedAt && <span className="cell-muted">{formatDate(capturedAt, true)}</span>}
        </div>
        {pageRefs.length > 0 ? (
          <ul className="evidence-list">
            {pageRefs.map((ref) => {
              const { label, value, href } = describeEvidenceRef(ref);
              return (
                <li key={ref}>
                  {label && <span className="cell-muted">{label}: </span>}
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer">{value}</a>
                  ) : (
                    <span>{value}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No page references were stored for this opportunity.</p>
        )}
        {navRefs.length > 0 && (
          <p className="muted">
            Navigation checked: {navRefs.join(", ")}
          </p>
        )}
      </section>

      <section className="card">
        <div className="detail-card-title">
          <div>
            <h2>Agency actions</h2>
            <p className="muted">Decide what happens next. Proposal drafts stay in Client Growth until you copy them out.</p>
          </div>
          <Icon name="briefcase" size={18} />
        </div>
        <div className="row-actions">
          {opp.status !== "new" && (
            <Form method="post" className="inline">
              <input type="hidden" name="intent" value="reopen" />
              <button type="submit" className="btn btn-secondary" disabled={busy}>Reopen</button>
            </Form>
          )}
          <Form method="post" className="inline">
            <input type="hidden" name="intent" value="prepare-proposal" />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Icon name="document" size={15} />
              {opp.proposalMd ? "Regenerate proposal draft" : "Prepare proposal"}
            </button>
          </Form>
          <Form method="post" className="inline">
            <input type="hidden" name="intent" value="dismiss" />
            <button type="submit" className="btn btn-danger" disabled={busy}>
              <Icon name="x" size={15} />
              Dismiss
            </button>
          </Form>
          <Form method="post" className="inline">
            <input type="hidden" name="intent" value="cover" />
            <button type="submit" className="btn btn-secondary" disabled={busy}>Mark already covered</button>
          </Form>
          <Form method="post" className="inline row-actions">
            <input type="hidden" name="intent" value="snooze" />
            <input className="snooze-input" type="number" name="days" defaultValue={30} min={1} aria-label="Snooze days" />
            <button type="submit" className="btn btn-secondary" disabled={busy}>Snooze</button>
          </Form>
        </div>
      </section>

      {opp.proposalMd && (
        <section className="card">
          <div className="detail-card-title">
            <div>
              <h2>Proposal draft</h2>
              <p className="muted">Edit the draft before you take it into your proposal tool.</p>
            </div>
            <span className="status proposal">Editable</span>
          </div>
          <Form method="post" className="stack">
            <input type="hidden" name="intent" value="save-proposal" />
            <textarea name="proposalMd" defaultValue={opp.proposalMd} style={{ minHeight: "22rem" }} />
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                <Icon name="check" size={15} />
                {busy ? "Saving…" : "Save draft"}
              </button>
              <span className="proposal-note">Draft only — nothing is sent.</span>
            </div>
          </Form>
        </section>
      )}
    </div>
  );
}
