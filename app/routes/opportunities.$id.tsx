import { Form, Link, redirect, useNavigation } from "react-router";

import * as repo from "@/db/repositories";
import { generateProposalDraft } from "@/core/proposal";
import {
  Icon,
  Meter,
  formatCurrencyRange,
  formatDate,
  pluralize,
  shortUrl,
} from "../components/ui";
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
  if (opp.status === "proposal_prepared") return { label: "Proposal ready", tone: "pos" };
  if (opp.status === "dismissed") return { label: "Dismissed", tone: "quiet" };
  if (opp.status === "snoozed") return { label: "Snoozed", tone: "quiet" };
  if (opp.billableStatus === "already_covered" || opp.status === "already_covered") {
    return { label: "Already covered", tone: "warn" };
  }
  return { label: "Open", tone: "accent" };
}

export default function OpportunityDetail({ loaderData }: Route.ComponentProps) {
  const { opportunity: opp, client, service, capturedAt } = loaderData;
  const pageRefs = opp.evidenceRefs.filter((ref) => !ref.startsWith("nav:"));
  const navRefs = opp.evidenceRefs.filter((ref) => ref.startsWith("nav:")).map((ref) => ref.slice(4));
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const pending = navigation.formData?.get("intent");
  const status = statusLabel(opp);

  return (
    <div className="detail">
      <Link
        className="backlink"
        to={client ? "/opportunities?client=" + client.id : "/opportunities"}
      >
        <Icon name="arrow-left" size={14} />
        Opportunities
      </Link>

      <header className="detail-head">
        <div className="detail-head-row">
          <div>
            <div className="detail-meta" style={{ marginTop: 0 }}>
              {client ? (
                <Link className="finding-client" to={"/clients/" + client.id}>
                  {client.name}
                </Link>
              ) : (
                <span>Unknown client</span>
              )}
              <span className={"pill " + status.tone}>{status.label}</span>
            </div>
            <h1 className="title-lg">{opp.title}</h1>
          </div>
        </div>

        <dl className="factbar">
          <div className="fact">
            <dt>Potential value</dt>
            <dd>{formatCurrencyRange(opp.priceMin, opp.priceMax)}</dd>
          </div>
          <div className="fact">
            <dt>Confidence</dt>
            <dd>
              <span className="row-tight">
                <Meter value={opp.confidence} />
                {Math.round(opp.confidence * 100)}%
              </span>
            </dd>
          </div>
          <div className="fact">
            <dt>Suggested service</dt>
            <dd style={{ fontWeight: 550 }}>{service ? service.name : opp.suggestedServiceId}</dd>
          </div>
          {opp.snoozeUntil && (
            <div className="fact">
              <dt>Snoozed until</dt>
              <dd style={{ fontWeight: 550 }}>{formatDate(opp.snoozeUntil)}</dd>
            </div>
          )}
        </dl>
      </header>

      <section className="section">
        <h2 className="title-section">What we found</h2>
        <p className="prose" style={{ marginTop: "0.5rem" }}>
          {opp.detected}
        </p>

        <h3 className="subhead">Why it matters</h3>
        <p className="prose" style={{ marginTop: "0.4rem" }}>
          {opp.rationale}
        </p>

        {opp.suggestedScope.length > 0 && (
          <>
            <h3 className="subhead">Proposed scope</h3>
            <ul className="scope-list">
              {opp.suggestedScope.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Evidence</h2>
            <p>Pages read during the latest analysis. Every claim above traces back to these.</p>
          </div>
          {capturedAt && <span className="faint" style={{ fontSize: "0.78rem" }}>{formatDate(capturedAt, true)}</span>}
        </div>
        {pageRefs.length > 0 ? (
          <ul className="source-list">
            {pageRefs.map((ref) => (
              <li key={ref}>
                <a href={ref} target="_blank" rel="noreferrer">
                  <Icon name="link" size={13} />
                  <span>{shortUrl(ref)}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="prose">No page references were stored for this opportunity.</p>
        )}
        {navRefs.length > 0 && (
          <p className="faint" style={{ marginTop: "0.85rem", fontSize: "0.8rem" }}>
            Navigation checked: {navRefs.join(", ")}
          </p>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Decide</h2>
            <p>Proposal drafts stay inside Client Growth until you copy them out. Nothing is sent.</p>
          </div>
        </div>
        <div className="actionbar">
          <Form method="post" className="inline">
            <input type="hidden" name="intent" value="prepare-proposal" />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Icon name="document" size={14} />
              {pending === "prepare-proposal"
                ? "Preparing…"
                : opp.proposalMd
                  ? "Regenerate draft"
                  : "Prepare proposal"}
            </button>
          </Form>
          {opp.status !== "new" && (
            <Form method="post" className="inline">
              <input type="hidden" name="intent" value="reopen" />
              <button type="submit" className="btn" disabled={busy}>
                Reopen
              </button>
            </Form>
          )}
          <Form method="post" className="inline">
            <input type="hidden" name="intent" value="cover" />
            <button type="submit" className="btn" disabled={busy}>
              Already covered
            </button>
          </Form>
          <Form method="post" className="row-tight">
            <input type="hidden" name="intent" value="snooze" />
            <span className="snooze-field">
              <input
                type="number"
                name="days"
                defaultValue={30}
                min={1}
                aria-label="Number of days to snooze"
              />
            </span>
            <span className="faint" style={{ fontSize: "0.78rem" }}>
              days
            </span>
            <button type="submit" className="btn" disabled={busy}>
              Snooze
            </button>
          </Form>
          <span className="spacer" />
          <Form method="post" className="inline">
            <input type="hidden" name="intent" value="dismiss" />
            <button type="submit" className="btn btn-danger" disabled={busy}>
              Dismiss
            </button>
          </Form>
        </div>
      </section>

      {opp.proposalMd && (
        <section className="section draft-area">
          <div className="section-head">
            <div>
              <h2 className="title-section">Proposal draft</h2>
              <p>Edit before you take it into your proposal tool.</p>
            </div>
            <span className="pill">Editable</span>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="save-proposal" />
            <textarea name="proposalMd" defaultValue={opp.proposalMd} aria-label="Proposal draft" />
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {pending === "save-proposal" ? "Saving…" : "Save draft"}
              </button>
              <span className="faint" style={{ fontSize: "0.78rem" }}>
                {opp.suggestedScope.length}{" "}
                {pluralize(opp.suggestedScope.length, "scope line", "scope lines")} included
              </span>
            </div>
          </Form>
        </section>
      )}
    </div>
  );
}
