import { d1Db } from "../lib/d1.server";
import {
  getProposalShareByToken,
  type ProposalSharePublic,
} from "@/db/proposalShares";
import { Icon, formatCurrencyRange } from "../components/ui";

type PublicShareContext = {
  cloudflare: { env: { DB: unknown } };
};

type LoaderArgs = {
  request: Request;
  context: PublicShareContext;
};

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

export function meta({ data }: { data?: ProposalSharePublic | null }) {
  return [
    {
      title: data
        ? `${data.snapshot.clientName} proposal · ${data.snapshot.agencyName}`
        : "Proposal share · Axiom Orbit",
    },
  ];
}

export function headers(_args?: unknown) {
  return NO_STORE_HEADERS;
}

/**
 * Public by design: the token resolves one stored snapshot and never enters
 * the authenticated tenant/session path or looks up current tenant records.
 */
export async function loader({ request, context }: LoaderArgs): Promise<ProposalSharePublic> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const db = d1Db(context.cloudflare.env.DB as never);
  const share = await getProposalShareByToken(db, token);
  if (!share) {
    throw new Response("This proposal link has expired or is no longer available.", {
      status: 404,
      headers: NO_STORE_HEADERS,
    });
  }
  return share;
}

export default function ProposalShare({ loaderData }: { loaderData: ProposalSharePublic }) {
  const { snapshot } = loaderData;
  const { opportunity } = snapshot;

  return (
    <main className="detail detail-narrow proposal-share-page">
      <header className="detail-head proposal-share-head">
        <div className="proposal-share-brand">
          {snapshot.logo && (
            <img
              src={snapshot.logo}
              alt={`${snapshot.agencyName} logo`}
              referrerPolicy="no-referrer"
            />
          )}
          <div>
            <span className="eyebrow">Proposal</span>
            <h1 className="title-lg">{snapshot.agencyName}</h1>
          </div>
        </div>
        <p className="detail-meta">Prepared by {snapshot.preparedBy}</p>
        <p className="faint">Prepared for {snapshot.clientName}</p>
      </header>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">Recommended work</span>
            <h2 className="title-section">{opportunity.title}</h2>
            <p>
              {snapshot.clientName} · {snapshot.clientDomain}
            </p>
          </div>
        </div>
        <dl className="factbar">
          <div className="fact">
            <dt>Estimated investment</dt>
            <dd className="num">{formatCurrencyRange(opportunity.priceMin, opportunity.priceMax)}</dd>
          </div>
          <div className="fact">
            <dt>Confidence</dt>
            <dd className="num">{Math.round(opportunity.confidence * 100)}%</dd>
          </div>
          {opportunity.serviceName && (
            <div className="fact">
              <dt>Service</dt>
              <dd>{opportunity.serviceName}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="section">
        <h2 className="title-section">Proposal</h2>
        <pre className="proposal-share-copy">{snapshot.proposalMd}</pre>
      </section>

      <section className="section">
        <h2 className="title-section">Scope and evidence</h2>
        <div className="case">
          <div className="case-block">
            <h3 className="subhead">What was found</h3>
            <p className="prose">{opportunity.detected}</p>
          </div>
          <div className="case-block">
            <h3 className="subhead">Why it matters</h3>
            <p className="prose">{opportunity.rationale}</p>
          </div>
          {opportunity.suggestedScope.length > 0 && (
            <div className="case-block">
              <h3 className="subhead">What the work includes</h3>
              <ul className="scope-list">
                {opportunity.suggestedScope.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {opportunity.evidenceRefs.length > 0 && (
            <div className="case-block">
              <h3 className="subhead">Sources checked</h3>
              <ul className="scope-list">
                {opportunity.evidenceRefs.map((reference, index) => (
                  <li key={index}>{reference}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <footer className="proposal-share-footer">
        <Icon name="shield" size={14} />
        <span>This proposal reflects the evidence and pricing saved when the link was created.</span>
      </footer>
    </main>
  );
}
