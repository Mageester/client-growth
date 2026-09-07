import { useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";

import * as repo from "@/db/repositories";
import { applyFunnelTransition } from "@/db/opportunityFunnel";
import {
  countActiveProposalShares,
  createProposalShare,
  isProposalShareError,
  revokeProposalShares,
} from "@/db/proposalShares";
import { generateProposalDraft } from "@/core/proposal";
import { rationaleForOpportunity } from "@/core/rules/deterministicEvaluation";
import { jobsToPayback, parseJobValue, paybackSentence } from "@/core/clientValue";
import { buildEvidenceCase } from "../lib/evidence";
import { isOpen, isSnoozeExpired, statusBadge } from "../lib/portfolio";
import { salesStageOf } from "@/db/opportunityFunnel";
import {
  Fact,
  Icon,
  PageContextMeta,
  formatCurrencyRange,
  formatDate,
  formatRelative,
  pluralize,
} from "../components/ui";
import { SectionNav } from "../components/section-nav";
import { proposalActionLabel } from "../components/signal-desk";
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
    // Null whenever the agency has not recorded what a job is worth to this
    // client. Nothing is defaulted or estimated in its place.
    payback: paybackSentence(
      jobsToPayback({
        priceMin: opportunity.priceMin,
        priceMax: opportunity.priceMax,
        averageJobValue: client?.averageJobValue,
      }),
    ),
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const opp = await repo.getOpportunity(t.scope, params.id);
  if (!opp) throw new Response("Opportunity not found", { status: 404 });

  switch (intent) {
    case "accept": {
      // "Worth pursuing" — the funnel's explicit acceptance decision.
      const ok = await applyFunnelTransition(t.scope, opp.id, { kind: "accept" });
      if (!ok) return { error: "This finding cannot be accepted from its current state." };
      break;
    }
    case "dismiss": {
      // Internal rejection: the agency declines to sell. Deliberately NOT a
      // client loss — it must never feed a close rate.
      const ok = await applyFunnelTransition(t.scope, opp.id, { kind: "dismiss" });
      if (!ok) return { error: "This finding cannot be dismissed from its current state." };
      break;
    }
    case "sold": {
      // The one outcome that teaches the product anything. Everything else it
      // records is a judgement about a finding; this is what happened to it.
      const raw = String(form.get("soldAmount") ?? "").trim();
      const parsed = parseJobValue(raw);
      if (!parsed.ok) {
        return { error: "Enter what you charged as a number, or leave it blank." };
      }
      const ok = await applyFunnelTransition(t.scope, opp.id, {
        kind: "sold",
        soldAmount: parsed.value,
      });
      if (!ok) return { error: "This outcome cannot be recorded from the finding's current state." };
      break;
    }
    case "lost": {
      // The client saw the pitch and declined — a client decision, distinct
      // from an internal dismissal.
      const ok = await applyFunnelTransition(t.scope, opp.id, { kind: "lost" });
      if (!ok) return { error: "This outcome cannot be recorded from the finding's current state." };
      break;
    }
    case "pitch": {
      // The single client-presented milestone, however it happened.
      const ok = await applyFunnelTransition(t.scope, opp.id, { kind: "pitch" });
      if (!ok) return { error: "This finding cannot be marked pitched from its current state." };
      break;
    }
    case "reopen": {
      if (opp.billableStatus === "already_covered") {
        return {
          error:
            "This work is covered by the client's contract, so it cannot be reopened as billable. Remove the coverage on the client page first.",
        };
      }
      const ok = await applyFunnelTransition(t.scope, opp.id, { kind: "reopen" });
      if (!ok) {
        return {
          error:
            "A client-decided outcome (sold or lost) is kept as history and cannot be reopened.",
        };
      }
      break;
    }
    case "cover": {
      const ok = await applyFunnelTransition(t.scope, opp.id, { kind: "cover" });
      if (!ok) return { error: "This finding cannot be marked covered from its current state." };
      await repo.setCoverage(
        t.scope,
        opp.clientId,
        opp.suggestedServiceId,
        "Marked covered from opportunity review",
      );
      break;
    }
    case "snooze": {
      const raw = Number(form.get("days"));
      if (!Number.isFinite(raw) || raw < 1 || raw > 365) {
        return { error: "Snooze for between 1 and 365 days." };
      }
      const days = Math.floor(raw);
      const until = new Date(Date.now() + days * 86_400_000).toISOString();
      const ok = await applyFunnelTransition(t.scope, opp.id, { kind: "snooze", snoozeUntil: until });
      if (!ok) return { error: "This finding cannot be snoozed from its current state." };
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
      // First proposal implies acceptance and stamps both milestones; editing
      // an existing draft never resets proposalPreparedAt.
      const ok = await applyFunnelTransition(t.scope, opp.id, {
        kind: "prepare-proposal",
        proposalMd: draft,
      });
      if (!ok) {
        return {
          error:
            "This finding is closed. Reopen it before preparing a proposal so the client's status stays truthful.",
        };
      }
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
    payback,
  } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const pending = navigation.formData?.get("intent");
  const now = new Date();
  const rationale = rationaleForOpportunity(opp);
  const snoozeActive = opp.status === "snoozed" && !isSnoozeExpired(opp, now);
  const badge = statusBadge(opp, now);
  const live = isOpen(opp, now);
  const proposalAction = proposalActionLabel(opp);
  const stage = salesStageOf(opp);
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const [copied, setCopied] = useState(false);

  const evidenceShown = showAllEvidence
    ? [...evidence.primary, ...evidence.secondary]
    : evidence.primary;
  const hiddenEvidence = evidence.secondary.length;

  // Compact funnel progress: Found -> Accepted -> Proposal -> Pitched ->
  // Sold/Not-closed. Proposal is optional; rows that never entered the funnel
  // (snoozed, covered, resolved) show no stepper at all.
  let funnelStepper: React.ReactNode = null;
  if (stage) {
    const steps: Array<{ key: string; label: string }> = [
      { key: "found", label: "Found" },
      { key: "accepted", label: "Accepted" },
      { key: "proposal", label: "Proposal" },
      { key: "pitched", label: "Pitched" },
      { key: "outcome", label: stage === "sold" ? "Sold" : stage === "lost" ? "Not closed" : "Outcome" },
    ];
    const order = ["found", "accepted", "proposal", "pitched"];
    const terminal = stage === "sold" || stage === "lost";
    funnelStepper = (
      <p className="funnel-stepper faint" aria-label="Sales progress">
        {steps.map((step, index) => {
          const reached = terminal || order.indexOf(stage) >= index;
          const isOutcome = index === steps.length - 1 && terminal;
          return (
            <span key={step.key}>
              {index > 0 && <span className="funnel-sep">→</span>}
              <span className={reached ? "funnel-step is-done" : "funnel-step"}>
                {isOutcome ? (stage === "sold" ? "Sold" : "Not closed") : step.label}
              </span>
            </span>
          );
        })}
      </p>
    );
  }

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
      <PageContextMeta className="detail-context-meta" />
      <Link
        className="backlink"
        to={client ? "/opportunities?client=" + client.id : "/opportunities"}
      >
        <Icon name="arrow-left" size={14} />
        Back to opportunities
      </Link>

      <header className="detail-head">
        <div className="detail-head-row">
          <div className="detail-head-copy">
            <span className="eyebrow">Opportunity</span>
            <h1 className="title-lg">{opp.title}</h1>
            <div className="detail-meta detail-meta-top">
              {client ? (
                <Link className="finding-client" to={"/clients/" + client.id}>
                  {client.name}
                </Link>
              ) : (
                <span>Unknown client</span>
              )}
              {client && <span className="dot-sep">·</span>}
              {client && <span className="faint">{client.domain}</span>}
              <span className={"pill " + badge.tone}>{badge.label}</span>
              {lastRunAt && (
                <>
                  <span className="dot-sep">·</span>
                  <span className="faint">analyzed {formatRelative(lastRunAt)}</span>
                </>
              )}
            </div>
            <div className="detail-evidence-summary" aria-label="Evidence summary">
              <span className="eyebrow">Evidence summary</span>
              <p>{evidence.headline}</p>
              <small>
                {evidence.inspectedCount} {pluralize(evidence.inspectedCount, "source", "sources")} checked
              </small>
            </div>
          </div>
          <div className="detail-primary-actions">
            {proposalAction === "Review proposal" ? (
              <Link to="#proposal-draft" className="btn btn-primary">
                <Icon name="document" size={15} />
                Review proposal
              </Link>
            ) : proposalAction === "Prepare client proposal" && live ? (
              <Form method="post" className="inline">
                <input type="hidden" name="intent" value="prepare-proposal" />
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  <Icon
                    name="document"
                    size={15}
                    className={pending === "prepare-proposal" ? "spin" : undefined}
                  />
                  {pending === "prepare-proposal" ? "Creating…" : "Prepare client proposal"}
                </button>
              </Form>
            ) : null}
          </div>
        </div>

        <dl className="factbar">
          <Fact label="Potential value">
            <span className="num">{formatCurrencyRange(opp.priceMin, opp.priceMax)}</span>
          </Fact>
          {/* What it costs the client in their own terms. Shown only when the
              agency recorded a job value for them — never estimated. */}
          {payback && <Fact label="For the client">{payback}</Fact>}
          {opp.status === "sold" && (
            <Fact label="Sold">
              {typeof opp.soldAmount === "number"
                ? formatCurrencyRange(opp.soldAmount, opp.soldAmount)
                : "Recorded"}
            </Fact>
          )}
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
          {opp.snoozeUntil && snoozeActive && (
            <Fact label="Returns">{formatDate(opp.snoozeUntil)}</Fact>
          )}
        </dl>
        <SectionNav
          label="Opportunity sections"
          items={[
            { id: "overview", label: "Overview", icon: "document" },
            { id: "evidence", label: "Evidence", icon: "image", count: evidence.primary.length + evidence.secondary.length },
            { id: "recommendations", label: "Recommendations", icon: "briefcase" },
            { id: "activity", label: "Activity", icon: "clock" },
          ]}
        />
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

      <section className="section detail-overview" id="overview">
        <div className="case">
          <div className="case-block">
            <h3 className="subhead">What was found</h3>
            <p className="prose">{opp.detected}</p>
          </div>
          <div className="case-block">
            <h3 className="subhead">Why it matters</h3>
             <p className="prose">{rationale}</p>
          </div>
          {opp.suggestedScope.length > 0 && (
            <div className="case-block recommendation-block" id="recommendations">
              <h3 className="subhead">Recommended service</h3>
              {service && <Link className="recommended-service" to="/services"><Icon name="briefcase" size={18} /><span><b>{service.name}</b><small>{service.description}</small></span><Icon name="chevron-right" size={16} /></Link>}
              <ul className="scope-list">
                {opp.suggestedScope.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="section" id="evidence">
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

      <section className="section" id="activity">
        <div className="section-head">
          <div>
            <h2 className="title-section">Decide</h2>
            <p>Nothing is sent automatically. Share a saved draft with an expiring link when it is ready.</p>
          </div>
        </div>
        {funnelStepper}

        <div className="actionbar">
          {/* Reopen is offered for the agency's own non-terminal states:
              dismissed (internal decision, reconsiderable), snoozed, and
              resolved. Sold and lost are client-decided history — no reopen. */}
          {!live &&
            opp.billableStatus === "billable" &&
            opp.status !== "sold" &&
            opp.status !== "lost" && (
              <Form method="post" className="inline">
                <input type="hidden" name="intent" value="reopen" />
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {pending === "reopen" ? "Reopening…" : "Reopen"}
                </button>
              </Form>
            )}

          {live && stage === "found" && (
            <div className="disposition-controls" aria-labelledby="disposition-label">
              <span className="disposition-label" id="disposition-label">Worth pursuing?</span>
              <div className="disposition-actions">
                {/* Primary: the funnel's first decision. */}
                <Form method="post" className="inline">
                  <input type="hidden" name="intent" value="accept" />
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {pending === "accept" ? "Accepting…" : "Worth pursuing"}
                  </button>
                </Form>
                <Form method="post" className="inline">
                  <input type="hidden" name="intent" value="prepare-proposal" />
                  <button type="submit" className="btn" disabled={busy}>
                    {pending === "prepare-proposal" ? "Preparing…" : "Prepare proposal"}
                  </button>
                </Form>
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
                {/* Internal rejection: never a client loss, never in a close rate. */}
                <Form method="post" className="inline">
                  <input type="hidden" name="intent" value="dismiss" />
                  <button type="submit" className="btn btn-danger" disabled={busy}>
                    Dismiss
                  </button>
                </Form>
              </div>
            </div>
          )}

          {live && (stage === "accepted" || stage === "proposal") && (
            <div className="disposition-controls" aria-labelledby="disposition-label">
              <span className="disposition-label" id="disposition-label">Next step</span>
              <div className="disposition-actions">
                {!opp.proposalMd && (
                  <Form method="post" className="inline">
                    <input type="hidden" name="intent" value="prepare-proposal" />
                    <button type="submit" className="btn btn-primary" disabled={busy}>
                      {pending === "prepare-proposal" ? "Preparing…" : "Prepare proposal"}
                    </button>
                  </Form>
                )}
                {opp.proposalMd && proposalAction === "Review proposal" && (
                  <a className="btn btn-primary" href="#proposal-draft">
                    Review proposal
                  </a>
                )}
                <Form method="post" className="inline">
                  <input type="hidden" name="intent" value="pitch" />
                  <button type="submit" className="btn" disabled={busy}>
                    {pending === "pitch" ? "Marking…" : "Mark pitched"}
                  </button>
                </Form>
                <Form method="post" className="inline">
                  <input type="hidden" name="intent" value="cover" />
                  <button type="submit" className="btn" disabled={busy}>
                    Already covered
                  </button>
                </Form>
                <Form method="post" className="inline">
                  <input type="hidden" name="intent" value="dismiss" />
                  <button type="submit" className="btn btn-danger" disabled={busy}>
                    Dismiss
                  </button>
                </Form>
              </div>
            </div>
          )}

          {live && stage === "pitched" && (
            <div className="disposition-controls" aria-labelledby="disposition-label">
              <span className="disposition-label" id="disposition-label">Client outcome</span>
              <div className="disposition-actions">
                <Form method="post" className="row-tight">
                  <input type="hidden" name="intent" value="sold" />
                  <label className="sr-only" htmlFor="sold-amount">
                    What you charged
                  </label>
                  <input
                    id="sold-amount"
                    name="soldAmount"
                    type="text"
                    inputMode="decimal"
                    placeholder="Amount (optional)"
                    size={14}
                  />
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {pending === "sold" ? "Recording…" : "Mark sold"}
                  </button>
                </Form>
                <Form method="post" className="inline">
                  <input type="hidden" name="intent" value="lost" />
                  <button type="submit" className="btn btn-danger" disabled={busy}>
                    {pending === "lost" ? "Recording…" : "Mark lost"}
                  </button>
                </Form>
              </div>
            </div>
          )}

          {(stage === "sold" || stage === "lost") && (
            <p className="action-note">
              {stage === "sold"
                ? "Recorded as sold" + (opp.soldAt ? " " + formatDate(opp.soldAt) : ".")
                : "Presented to the client but not closed. This is a client decision — different from an internal dismissal."}
            </p>
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
        <section className="section draft-area" id="proposal-draft">
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
            <label className="sr-only" htmlFor="proposal-draft-editor">
              Proposal draft
            </label>
            <textarea id="proposal-draft-editor" name="proposalMd" defaultValue={opp.proposalMd} rows={18} />
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
