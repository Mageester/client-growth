import { Link } from "react-router";

import { analysisHealth } from "@/db/workspaceOperations";
import * as repo from "@/db/repositories";
import { RULE_SERVICE_LINKS } from "@/core/rules/registry";
import { computeWinRates } from "@/core/winRates";
import { formatCurrencyRange, formatDate, PageContextMeta, pluralize } from "../components/ui";
import { SettingsNavigation } from "../components/settings-navigation";
import { resolveMailTransport } from "../lib/resend.server";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/operations";

export function meta() {
  return [{ title: "Check health · Axiom Orbit" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  const [health, oppsByClient] = await Promise.all([
    analysisHealth(t.scope),
    repo.listOpportunitiesByClient(t.scope),
  ]);
  // What this workspace actually converts. Descriptive only: it reports the
  // decisions the agency has made and predicts nothing from them.
  const winRates = computeWinRates([...oppsByClient.values()].flat());
  const ruleLabel = Object.fromEntries(
    RULE_SERVICE_LINKS.map((link) => [link.ruleId, link.label]),
  );
  // Email delivery is not a per-workspace fact, but it is the failure that
  // strands people outside the product entirely — nobody can verify, nobody
  // can sign in, and nothing else on this page would show it.
  const transport = resolveMailTransport(context.cloudflare.env as never);
  return {
    ...health,
    sales: {
      rows: winRates.ranked.map((entry) => ({
        ruleId: entry.ruleId,
        label: ruleLabel[entry.ruleId] ?? entry.ruleId,
        tier: entry.tier,
        decided: entry.decided,
        sold: entry.sold,
        averageSale: entry.averageSale,
      })),
      totalSold: winRates.totalSold,
      totalSoldValue: winRates.totalSoldValue,
    },
    email: {
      deliverable: transport.kind !== "none",
      detail:
        transport.kind === "resend"
          ? "Verification and password-reset email is configured."
          : transport.kind === "console"
            ? "Email is being printed to the server log, not sent. This is a development setting."
            : transport.reason,
    },
  };
}

export default function Operations({ loaderData: d }: Route.ComponentProps) {
  return (
    <main className="settings-page">
      <PageContextMeta />
      <div className="pagehead">
        <div className="pagehead-copy">
          <span className="eyebrow">Settings</span>
          <h1 className="title-page">Settings</h1>
          <p className="summary-line">Manage your workspace, services, monitoring, team, and account.</p>
        </div>
      </div>

      <div className="settings-layout">
        <SettingsNavigation active="health" />
        <div className="settings-content">
          <div className="settings-content-head">
            <div>
              <h2>Check health</h2>
              <p>
                The last seven days, compared with the seven days before. Only this workspace
                is included.
              </p>
            </div>
          </div>

          {!d.email.deliverable && (
            <div className="notice err" role="alert">
              No one can create an account or reset a password: {d.email.detail}
            </div>
          )}

          {d.alert && (
            <div className="notice warn" role="alert">
              {d.alert}
            </div>
          )}
          {d.incompleteStarts > 0 && (
            <div className="notice warn" role="alert">
              {d.incompleteStarts} {d.incompleteStarts === 1 ? "analysis start has" : "analysis starts have"} no
              completion record after ten minutes. These checks may have failed or been interrupted;
              their outcome is unknown.
            </div>
          )}

          <section className="section">
            <dl>
              <div className="kv-row">
                <dt>Completed checks</dt>
                <dd>{d.current.checks}</dd>
              </div>
              <div className="kv-row">
                <dt>No findings in assessed scope</dt>
                <dd>{d.current.clean}</dd>
              </div>
              <div className="kv-row">
                <dt>Checks with findings</dt>
                <dd>{d.current.findings}</dd>
              </div>
              <div className="kv-row">
                <dt>Could not fully assess</dt>
                <dd>
                  {d.rate === null ? "No checks yet" : `${Math.round(d.rate * 100)}% (${d.current.inconclusive})`}
                </dd>
              </div>
              <div className="kv-row">
                <dt>Previous week</dt>
                <dd>
                  {d.previousRate === null
                    ? "No checks recorded"
                    : `${Math.round(d.previousRate * 100)}% inconclusive`}
                </dd>
              </div>
              <div className="kv-row">
                <dt>Findings that could not be assessed</dt>
                <dd>{d.current.evaluatorErrors}</dd>
              </div>
              <div className="kv-row">
                <dt>Analysis failures</dt>
                <dd>{d.failedStarts}</dd>
              </div>
              <div className="kv-row">
                <dt>Automated review checks recorded</dt>
                <dd>{d.current.evaluatorCalls}</dd>
              </div>
            </dl>
            <details>
              <summary>Technical alert criteria</summary>
              <p className="faint">
                An alert appears with at least five checks when half are inconclusive and the rate rose
                by 20 percentage points, there is no earlier baseline, or the rate is at least 80%.
              </p>
            </details>
          </section>

          <section className="section">
            <h2 className="title-section">Checks to investigate</h2>
            {d.recentErrors.length === 0 ? (
              <p className="prose">
                No recorded inconclusive checks or assessment errors in this window. This is not a
                claim that every client was checked.
              </p>
            ) : (
              <ul className="weekly-list">
                {d.recentErrors.map((r) => (
                  <li key={r.id}>
                    <b>{r.clientName}</b> · {formatDate(r.finishedAt)}
                    <p>{r.summary}</p>
                    <p className="faint">{r.evaluatorErrors} findings could not be assessed</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="settings-section">
            <h2 className="title-section">What you actually sell</h2>
            {d.sales.rows.length === 0 ? (
              <p className="prose">
                Nothing recorded yet. Each time you mark a finding sold — or dismiss one —
                it is counted here, per kind of work. Once there is a history, the
                opportunity queue is ordered by what <em>this</em> agency converts rather
                than by what a rule happens to price highly.
              </p>
            ) : (
              <>
                <p className="prose">
                  {d.sales.totalSold} {pluralize(d.sales.totalSold, "finding", "findings")} sold
                  {d.sales.totalSoldValue > 0 && (
                    <>
                      , {formatCurrencyRange(d.sales.totalSoldValue, d.sales.totalSoldValue)}{" "}
                      recorded
                    </>
                  )}
                  . Counted only where you made a decision; findings still in the queue are
                  not counted either way.
                </p>
                <ul className="weekly-list">
                  {d.sales.rows.map((row) => (
                    <li key={row.ruleId}>
                      <b>{row.label}</b>
                      {row.tier === "health" && <span className="faint"> · site health</span>}
                      <p>
                        Sold {row.sold} of {row.decided}
                        {row.averageSale !== null && (
                          <>
                            {" "}
                            · {formatCurrencyRange(row.averageSale, row.averageSale)} average
                          </>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <div className="form-actions">
            <Link className="btn" to="/clients">
              Review clients
            </Link>
            <a className="btn" href="/export/workspace" download>
              Export workspace data
            </a>
            <Link className="btn" to="/changes">
              This week
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
