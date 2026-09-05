import { Link } from "react-router";
import { portfolioChanges } from "@/db/portfolioChanges";
import { requireTenant } from "../lib/session.server";
import { formatDate } from "../components/ui";
import type { Route } from "./+types/changes";

export function meta() { return [{title:"This week · Axiom Orbit"}]; }
export async function loader({request,context}:Route.LoaderArgs) {
  const t = await requireTenant(request,context);
  return portfolioChanges(t.scope);
}
export default function Changes({loaderData:data}:Route.ComponentProps) {
  const s = data.summary;
  return <main className="detail weekly-page">
    <div className="pagehead"><div className="pagehead-copy">
      <span className="eyebrow">Your portfolio</span><h1 className="title-page">What changed this week</h1>
      <p className="prose">The last seven days of completed checks. A site we could not assess stays inconclusive.</p>
    </div><Link className="btn" to="/clients">Manage clients</Link></div>
    <section className="section" aria-label="Weekly totals"><dl>
      <div className="kv-row"><dt>New findings</dt><dd>{s.newFindings}</dd></div>
      <div className="kv-row"><dt>Confirmed fixed</dt><dd>{s.resolvedFindings}</dd></div>
      <div className="kv-row"><dt>Checks completed</dt><dd>{s.checks} across {s.clientsChecked} clients</dd></div>
      <div className="kv-row"><dt>Could not fully assess</dt><dd>{s.inconclusive}</dd></div>
    </dl></section>
    {s.checks === 0 ? <section className="section"><h2 className="title-section">No checks in the last seven days</h2>
      <p className="prose">This does not mean every site is clean. Open a client to run a check or turn on weekly monitoring.</p>
      <Link className="btn" to="/clients">Choose a client</Link></section> : <section className="section">
      <div className="section-head"><div><h2 className="title-section">Recent checks</h2><p>Newest first. Showing up to 200 checks; totals cover the full week.</p></div></div>
      <ul className="weekly-list">{data.runs.map(run=><li key={run.id}>
        <div className="weekly-row"><Link to={`/clients/${encodeURIComponent(run.clientId)}`}>{run.clientName}</Link>
          <time dateTime={run.finishedAt}>{formatDate(run.finishedAt)}</time></div>
        <p>{run.outcome === "inconclusive" ? "Could not fully assess" : `${run.newCount} new · ${run.resolvedCount} confirmed fixed`}
          <span className="faint"> · {run.trigger === "scheduled" ? "Scheduled" : "Manual"}</span></p>
        <p className="faint">{run.summary}</p>
      </li>)}</ul></section>}
    {data.findings.length > 0 && <section className="section"><div className="section-head"><div>
      <h2 className="title-section">Findings updated this week</h2><p>Current status of up to 100 recently updated findings.</p>
    </div></div><ul className="weekly-list">{data.findings.map(f=><li key={f.id}>
      <Link to={`/opportunities/${encodeURIComponent(f.id)}`}>{f.title}</Link>
      <p className="faint">{f.clientName} · {f.status === "resolved" ? "Confirmed fixed" : f.status === "proposal_prepared" ? "Proposal prepared" : "Open"}</p>
    </li>)}</ul></section>}
    <Link className="btn" to="/opportunities">Review all opportunities</Link>
  </main>;
}
