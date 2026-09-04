import { Link } from "react-router";

import { analysisHealth } from "@/db/workspaceOperations";
import { formatDate } from "../components/ui";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/operations";

export function meta() {
  return [{ title: "Check health · Axiom Orbit" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  return analysisHealth(t.scope);
}

export default function Operations({ loaderData: d }: Route.ComponentProps) {
  return (
    <main className="detail">
      <div className="pagehead">
        <div>
          <span className="eyebrow">Workspace health</span>
          <h1 className="title-page">Can you rely on these checks?</h1>
          <p className="prose">
            The last seven days, compared with the seven days before. Only this workspace is
            included.
          </p>
        </div>
      </div>

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
            <dt>Evaluation errors</dt>
            <dd>{d.current.evaluatorErrors}</dd>
          </div>
          <div className="kv-row">
            <dt>Analysis failures</dt>
            <dd>{d.failedStarts}</dd>
          </div>
          <div className="kv-row">
            <dt>Evaluator calls recorded</dt>
            <dd>{d.current.evaluatorCalls}</dd>
          </div>
        </dl>
        <p className="faint">
          An alert appears with at least five checks when half are inconclusive and the rate rose
          by 20 percentage points, there is no earlier baseline, or the rate is at least 80%.
        </p>
      </section>

      <section className="section">
        <h2 className="title-section">Checks to investigate</h2>
        {d.recentErrors.length === 0 ? (
          <p className="prose">
            No recorded inconclusive checks or evaluation errors in this window. This is not a
            claim that every client was checked.
          </p>
        ) : (
          <ul className="weekly-list">
            {d.recentErrors.map((r) => (
              <li key={r.id}>
                <b>{r.clientName}</b> · {formatDate(r.finishedAt)}
                <p>{r.summary}</p>
                <p className="faint">{r.evaluatorErrors} evaluation errors</p>
              </li>
            ))}
          </ul>
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
    </main>
  );
}
