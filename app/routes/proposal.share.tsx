import { d1Db } from "../lib/d1.server";
import {
  getProposalShareByToken,
  type ProposalSharePublic,
} from "@/db/proposalShares";
import { describeEvidenceRef, isPageRef, parseEvidenceRef } from "@/core/evidenceRef";
import { titleFromUrl } from "../lib/evidence";
import { Icon, formatCurrencyRange } from "../components/ui";
import type { ReactNode } from "react";

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
        <div className="proposal-share-copy"><ProposalText text={snapshot.proposalMd} /></div>
      </section>

      <section className="section">
        <h2 className="title-section">Scope and evidence</h2>
        <div className="case">
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
                  <li key={index}>
                    <PublicEvidenceReference reference={reference} />
                  </li>
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

export function publicEvidenceReference(reference: string): {
  label: string;
  url: string | null;
} {
  const parsed = parseEvidenceRef(reference);
  if (isPageRef(parsed) && parsed.url) {
    const qualifier =
      parsed.kind === "verified"
        ? " (fetched to confirm)"
        : parsed.kind === "considered"
          ? " (considered and ruled out)"
          : "";
    return { label: titleFromUrl(parsed.url) + qualifier, url: parsed.url };
  }
  return { label: describeEvidenceRef(parsed), url: null };
}

function PublicEvidenceReference({ reference }: { reference: string }) {
  const item = publicEvidenceReference(reference);
  return item.url ? (
    <a href={item.url} target="_blank" rel="noreferrer">
      {item.label}
    </a>
  ) : (
    item.label
  );
}

const SAVED_EVIDENCE_TOKEN =
  /(^|\s)(images-without-alt:\d+|word-count:\d+|title:missing|h1:missing|meta-description:missing|structured-data:localbusiness-or-service-missing|competitor:[^\s]+)(?=\s|$)/gi;

/** A small presentation grammar for saved drafts; URLs and evidence tokens become readable. */
function ProposalText({ text }: { text: string }) {
  const inline = (line: string): ReactNode[] => {
    const readableLine = line.replace(SAVED_EVIDENCE_TOKEN, (_match, prefix: string, token: string) =>
      `${prefix}${describeEvidenceRef(parseEvidenceRef(token))}`,
    );

    return readableLine.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s]+)/g).map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }

      if (!/^https?:\/\//i.test(part)) return part;
      let url = part;
      let trailing = "";
      while (/[.,;:!?]$/.test(url)) {
        trailing = url.slice(-1) + trailing;
        url = url.slice(0, -1);
      }
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return part;
        return (
          <span key={index}>
            <a href={url} target="_blank" rel="noreferrer">
              {titleFromUrl(url)}
            </a>
            {trailing}
          </span>
        );
      } catch {
        return part;
      }
    });
  };
  const blocks: ReactNode[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const heading = /^#{1,3}\s+(.+)$/.exec(line);
    if (heading) { blocks.push(<h3 key={i}>{inline(heading[1]!)}</h3>); continue; }
    if (/^-\s+/.test(line)) {
      const items: ReactNode[] = [];
      const key = i;
      while (i < lines.length && /^-\s+/.test(lines[i]!)) {
        items.push(<li key={i}>{inline(lines[i]!.replace(/^-\s+/, ""))}</li>);
        i++;
      }
      i--;
      blocks.push(<ul className="scope-list" key={key}>{items}</ul>);
      continue;
    }
    blocks.push(<p key={i}>{inline(line)}</p>);
  }
  return <>{blocks}</>;
}
