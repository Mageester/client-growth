import { useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";

import * as repo from "@/db/repositories";
import {
  countActiveProposalShares,
  createProposalShare,
  isProposalShareError,
  revokeProposalShares,
} from "@/db/proposalShares";
import { generateProposalDraft } from "@/core/proposal";
import { buildEvidenceCase } from "../lib/evidence";
import { isOpen, isSnoozeExpired, nextAction, statusBadge } from "../lib/portfolio";
import {
  Fact,
  Icon,
  formatCurrencyRange,
  formatDate,
  formatRelative,
  pluralize,
} from "../components/ui";
import { requireTenant } from "../lib/session.server";
import { getTrustedAuthBaseURL } from "../lib/auth.server";
import type { Route } from "./+types/opportunities.$id";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? data.opportunity.title + " · Axiom Orbit" : "Opportunity" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  const opportunity = await repo.getOpportunity(t.scope, params.id);
  if (!opportunity) throw new Response("Opportunity not found", { status: 404 });
  const [client, service, run, activeShareCount] = await Promise.all([
    repo.getClient(t.scope, opportunity.clientId),
    repo.getService(t.scope, opportunity.suggestedServiceId),
    repo.getLatestAnalysisRun(t.scope, opportunity.clientId),
    countActiveProposalShares(t.scope, opportunity.id),
  ]);
  return {
    opportunity,
    client,
    service,
    lastRunAt: run?.finishedAt ?? null,
    activeShareCount,
    canManageShares: t.userId === t.workspace.ownerUserId,
    evidence: buildEvidenceCase(opportunity),
  };
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
      if (opp.billableStatus === "already_covered") {
        return {
          error:
            "This work is covered by the client's contract, so it cannot be reopened as billable. Remove the coverage on the client page first.",
        };
      }
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
      const raw = Number(form.get("days"));
      if (!Number.isFinite(raw) || raw < 1 || raw > 365) {
        return { error: "Snooze for between 1 and 365 days." };
      }
      const days = Math.floor(raw);
      const until = new Date(Date.now() + days * 86_400_000).toISOString();
      await repo.setOpportunityStatus(t.scope, opp.id, "snoozed", until);
      break;
    }
    case "prepare-proposal": {
      // A proposal is a commitment to sell this work. Drafting one for a finding
      // the agency already dismissed, snoozed or marked covered would both
      // resurrect it into the feed and put a price on work nobody intends to do.
      if (!isOpen(opp)) {
        return {
          error:
            "This finding is closed. Reopen it before preparing a proposal so the client's status stays truthful.",
        };
      }
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
      if (!body) return { error: "The draft cannot be empty." };
      await repo.saveOpportunityProposalText(t.scope, opp.id, body);
      break;
    }
    case "create-share": {
      try {
        const created = await createProposalShare(t.scope, opp.id, {
          createdByUserId: t.userId,
          preparedBy: t.user.name.trim() || t.user.email,
        });
        const shareUrl = new URL(
          "/proposal/share",
          getTrustedAuthBaseURL(context.cloudflare.env),
        );
        shareUrl.searchParams.set("token", created.token);
        // Keep the token in the action response only. A later loader/reload
        // has no way to recover it from the hash-only database row.
        return {
          ok: true as const,
          shareUrl: shareUrl.toString(),
          expiresAt: created.expiresAt,
        };
      } catch (error) {
        if (isProposalShareError(error)) {
          if (error.code === "not-owner") {
            throw new Response("Only the workspace owner can manage share links.", { status: 403 });
          }
          return { ok: false as const, error: error.message };
        }
        throw error;
      }
    }
    case "revoke-shares": {
      try {
        const revoked = await revokeProposalShares(t.scope, opp.id, {
          actingUserId: t.userId,
        });
        return { ok: true as const, revoked };
      } catch (error) {
        if (isProposalShareError(error) && error.code === "not-owner") {
          throw new Response("Only the workspace owner can manage share links.", { status: 403 });
        }
        throw error;
      }
    }
    default:
      throw new Response("Unknown action", { status: 400 });
  }
  return redirect("/opportunities/" + opp.id);
}

export default function OpportunityDetail({ loaderData, actionData }: Route.ComponentProps) {
  const {
    opportunity: opp,
    client,
    service,
    lastRunAt,
    evidence,
    activeShareCount = 0,
    canManageShares = false,
  } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const pending = navigation.formData?.get("intent");
  const now = new Date();
  const snoozeActive = opp.status === "snoozed" && !isSnoozeExpired(opp, now);
  const badge = statusBadge(opp, now);
  const live = isOpen(opp, now);
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const [copied, setCopied] = useState(false);

  const evidenceShown = showAllEvidence
    ? [...evidence.primary, ...evidence.secondary]
    : evidence.primary;
  const hiddenEvidence = evidence.secondary.length;

  async function copyDraft() {
    if (!opp.proposalMd) return;
    try {
      await navigator.clipboard.writeText(opp.proposalMd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard access can be denied; the textarea below is still selectable.
    }
  }

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
          <div className="detail-head-copy">
            <div className="detail-meta detail-meta-top">
              {client ? (
                <Link className="finding-client" to={"/clients/" + client.id}>
                  {client.name}
                </Link>
              ) : (
                <span>Unknown client</span>
              )}
              <span className={"pill " + badge.tone}>{badge.label}</span>
              {lastRunAt && (
                <>
                  <span className="dot-sep">·</span>
                  <span className="faint">analyzed {formatRelative(lastRunAt)}</span>
                </>
              )}
            </div>
            <h1 className="title-lg">{opp.title}</h1>
            <p className="detail-next">
              <Icon name="arrow-right" size={13} />
              {nextAction(opp, now)}
            </p>
          </div>
        </div>

        <dl className="factbar">
          <Fact label="Potential value">
            <span className="num">{formatCurrencyRange(opp.priceMin, opp.priceMax)}</span>
          </Fact>
          <Fact label="Confidence">
            <span className="num">{Math.round(opp.confidence * 100)}%</span>
          </Fact>
          <Fact label="Service to sell">
            {service ? (
              <Link className="link" to="/services">
                {service.name}
              </Link>
            ) : (
              <span className="faint">Removed from catalog</span>
            )}
          </Fact>
          <Fact label="Evidence">
            {evidence.inspectedCount}{" "}
            {pluralize(evidence.inspectedCount, "page checked", "pages checked")}
          </Fact>
          {opp.snoozeUntil && snoozeActive && (
            <Fact label="Returns">{formatDate(opp.snoozeUntil)}</Fact>
          )}
        </dl>
      </header>

      {actionData?.error && (
        <div className="notice err" role="alert">
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}
      {actionData && "shareUrl" in actionData && actionData.shareUrl && (
        <div className="notice ok" role="status">
          <Icon name="link" size={15} />
          <span>
            Share link ready for 30 days: {" "}
            <a href={actionData.shareUrl} target="_blank" rel="noreferrer">
              {actionData.shareUrl}
            </a>
          </span>
        </div>
      )}
      {actionData && "revoked" in actionData && typeof actionData.revoked === "number" && (
        <div className="notice ok" role="status">
          <Icon name="check" size={15} />
          <span>
            {actionData.revoked === 0
              ? "There were no active proposal links to revoke."
              : `Revoked ${actionData.revoked} proposal ${actionData.revoked === 1 ? "link" : "links"}.`}
          </span>
        </div>
      )}

      <section className="section">
        <h2 className="title-section">The case</h2>
        <div className="case">
          <div className="case-block">
            <h3 className="subhead">What was found</h3>
            <p className="prose">{opp.detected}</p>
          </div>
          <div className="case-block">
            <h3 className="subhead">Why it matters to the client</h3>
            <p className="prose">{opp.rationale}</p>
          </div>
          {opp.suggestedScope.length > 0 && (
            <div className="case-block">
              <h3 className="subhead">What the work would be</h3>
              <ul className="scope-list">
                {opp.suggestedScope.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Evidence</h2>
            <p>{evidence.headline}</p>
          </div>
        </div>
        {evidenceShown.length > 0 ? (
          <ul className="evidence-list">
            {evidenceShown.map((item) => (
              <li key={item.kind + (item.url ?? item.title)} className={"ev ev-" + item.kind}>
                <span className="ev-mark" aria-hidden="true">
                  <Icon
                    name={
                      item.kind === "defect"
                        ? "alert"
                        : item.kind === "nav"
                          ? "sliders"
                          : item.kind === "near-miss"
                            ? "search"
                            : "document"
                    }
                    size={13}
                  />
                </span>
                <div className="ev-body">
                  {item.url ? (
                    <a className="ev-title" href={item.url} target="_blank" rel="noreferrer">
                      {item.title}
                      <Icon name="external" size={11} />
                    </a>
                  ) : (
                    <span className="ev-title is-static">{item.title}</span>
                  )}
                  <p className="ev-note">{item.note}</p>
                  {item.url && <p className="ev-url">{item.url}</p>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="prose faint">No provenance was stored with this finding.</p>
        )}
        {hiddenEvidence > 0 && (
          <button
            type="button"
            className="disclose"
            onClick={() => setShowAllEvidence((value) => !value)}
            aria-expanded={showAllEvidence}
          >
            {showAllEvidence
              ? "Show less"
              : `Show all ${hiddenEvidence} supporting ${pluralize(hiddenEvidence, "check", "checks")}`}
            <Icon name={showAllEvidence ? "chevron-down" : "chevron-right"} size={13} />
          </button>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Decide</h2>
            <p>Nothing is sent automatically. Share a saved draft with an expiring link when it is ready.</p>
          </div>
        </div>
        <div className="actionbar">
          {live ? (
            <Form method="post" className="inline">
              <input type="hidden" name="intent" value="prepare-proposal" />
              <button type="submit" className="btn btn-primary" disabled={busy}>
                <Icon
                  name="document"
                  size={14}
                  className={pending === "prepare-proposal" ? "spin" : undefined}
                />
                {pending === "prepare-proposal"
                  ? "Preparing…"
                  : opp.proposalMd
                    ? "Regenerate draft"
                    : "Prepare proposal"}
              </button>
            </Form>
          ) : (
            opp.billableStatus === "billable" && (
              <Form method="post" className="inline">
                <input type="hidden" name="intent" value="reopen" />
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {pending === "reopen" ? "Reopening…" : "Reopen"}
                </button>
              </Form>
            )
          )}

          {live && (
            <>
              <Form method="post" className="inline">
                <input type="hidden" name="intent" value="cover" />
                <button type="submit" className="btn" disabled={busy}>
                  Already covered
                </button>
              </Form>
              <Form method="post" className="row-tight snooze-form">
                <input type="hidden" name="intent" value="snooze" />
                <label className="sr-only" htmlFor="snooze-days">
                  Snooze for how many days
                </label>
                <span className="snooze-field">
                  <input id="snooze-days" type="number" name="days" defaultValue={30} min={1} max={365} />
                </span>
                <span className="faint snooze-unit">days</span>
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
            </>
          )}

          {opp.status === "already_covered" && (
            <p className="action-note">
              This work is marked as covered by {client ? client.name + "'s" : "the client's"}{" "}
              contract, so it is not offered as billable.{" "}
              {client && (
                <Link className="link" to={"/clients/" + client.id}>
                  Change contract coverage
                </Link>
              )}
            </p>
          )}
          {canManageShares && (
            <>
              {opp.status === "proposal_prepared" && opp.proposalMd && (
                <Form method="post" className="inline">
                  <input type="hidden" name="intent" value="create-share" />
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    <Icon
                      name="link"
                      size={14}
                      className={pending === "create-share" ? "spin" : undefined}
                    />
                    {pending === "create-share" ? "Creating link…" : "Create share link"}
                  </button>
                </Form>
              )}
              {activeShareCount > 0 && (
                <Form method="post" className="inline">
                  <input type="hidden" name="intent" value="revoke-shares" />
                  <button type="submit" className="btn btn-danger" disabled={busy}>
                    {pending === "revoke-shares"
                      ? "Revoking…"
                      : `Revoke ${activeShareCount} active link${activeShareCount === 1 ? "" : "s"}`}
                  </button>
                </Form>
              )}
            </>
          )}
          {snoozeActive && opp.snoozeUntil && (
            <p className="action-note">
              Hidden from the feed until {formatDate(opp.snoozeUntil)}.
            </p>
          )}
        </div>
      </section>

      {opp.proposalMd && (
        <section className="section draft-area">
          <div className="section-head">
            <div>
              <h2 className="title-section">Proposal draft</h2>
              <p>Built from the evidence above. Edit it here, then take it to the client.</p>
            </div>
            <button type="button" className="btn btn-sm" onClick={copyDraft}>
              <Icon name={copied ? "check" : "copy"} size={13} />
              {copied ? "Copied" : "Copy draft"}
            </button>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="save-proposal" />
            <label className="sr-only" htmlFor="proposal-draft">
              Proposal draft
            </label>
            <textarea id="proposal-draft" name="proposalMd" defaultValue={opp.proposalMd} rows={18} />
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {pending === "save-proposal" ? "Saving…" : "Save draft"}
              </button>
              <span className="faint form-actions-note">
                {opp.suggestedScope.length}{" "}
                {pluralize(opp.suggestedScope.length, "scope line", "scope lines")} ·{" "}
                {evidence.inspectedCount}{" "}
                {pluralize(evidence.inspectedCount, "source", "sources")} cited
              </span>
            </div>
          </Form>
        </section>
      )}
    </div>
  );
}
