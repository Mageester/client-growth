import { useEffect, useState } from "react";
import { Form, Link } from "react-router";

import { ClientReportDocument } from "../components/client-report";
import { Icon } from "../components/ui";
import {
  ClientReportError,
  createClientReportShare,
  getClientReportById,
  isClientReportError,
  listClientReportShares,
  revokeClientReportShare,
  revokeClientReportShares,
} from "@/db/clientReports";
import { getTrustedAuthBaseURL } from "../lib/auth.server";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/reports.$id";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.report.snapshot.public.client.name} report` : "Client report" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  const report = await getClientReportById(t.scope, params.id);
  if (!report) throw new Response("Report not found", { status: 404 });
  const shares = await listClientReportShares(t.scope, report.reportId);
  const now = new Date().toISOString();
  return {
    report,
    activeShares: shares.filter((share) => !share.revokedAt && share.expiresAt > now),
    canManageShares: t.userId === t.workspace.ownerUserId,
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const report = await getClientReportById(t.scope, params.id);
  if (!report) throw new Response("Report not found", { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "create-share") {
      const share = await createClientReportShare(t.scope, report.reportId, {
        actingUserId: t.userId,
      });
      const shareUrl = new URL(
        `/report/share?token=${encodeURIComponent(share.token)}`,
        getTrustedAuthBaseURL(context.cloudflare.env),
      ).toString();
      return { ok: true as const, shareId: share.shareId, shareUrl, expiresAt: share.expiresAt };
    }
    if (intent === "revoke-shares") {
      const revoked = await revokeClientReportShares(t.scope, report.reportId, {
        actingUserId: t.userId,
      });
      return { ok: true as const, revoked, message: "Active report links revoked." };
    }
    if (intent === "revoke-share") {
      const shareId = String(form.get("shareId") ?? "");
      const revoked = shareId
        ? await revokeClientReportShare(t.scope, report.reportId, shareId, {
            actingUserId: t.userId,
          })
        : false;
      return { ok: true as const, revoked: revoked ? 1 : 0, message: "Report link revoked." };
    }
    throw new Response("Unknown action", { status: 400 });
  } catch (error) {
    if (error instanceof ClientReportError || isClientReportError(error)) {
      return { ok: false as const, error: error.message };
    }
    throw error;
  }
}

export default function ClientReportPreview({ loaderData, actionData }: Route.ComponentProps) {
  const { report, activeShares, canManageShares } = loaderData;
  const [copied, setCopied] = useState(false);
  const [shareUrls, setShareUrls] = useState<Record<string, string>>({});
  const shareUrl = actionData && "shareUrl" in actionData ? actionData.shareUrl : null;
  const shareExpiresAt = actionData && "expiresAt" in actionData ? actionData.expiresAt : null;
  const copyShare = async () => {
    if (!shareUrl || !navigator.clipboard) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
  };

  useEffect(() => {
    try {
      setShareUrls(
        JSON.parse(window.localStorage.getItem("axiom-orbit:report-share-links") ?? "{}") as Record<string, string>,
      );
    } catch {
      setShareUrls({});
    }
  }, []);

  useEffect(() => {
    if (!actionData || !("shareId" in actionData) || !("shareUrl" in actionData) || !actionData.shareId || !actionData.shareUrl) return;
    setShareUrls((current) => {
      const next = { ...current, [String(actionData.shareId)]: String(actionData.shareUrl) };
      try { window.localStorage.setItem("axiom-orbit:report-share-links", JSON.stringify(next)); } catch { /* server metadata remains visible */ }
      return next;
    });
  }, [actionData]);

  return (
    <div className="client-report-preview-page">
      <div className="client-report-toolbar">
        <div>
          <Link className="backlink" to={`/clients/${encodeURIComponent(report.clientId)}`}>
            <Icon name="arrow-left" size={14} />
            {report.snapshot.public.client.name}
          </Link>
          <span className="client-report-toolbar-status">Private preview · snapshot generated {report.snapshot.public.generatedAt.slice(0, 10)}</span>
        </div>
        <div className="client-report-toolbar-actions">
          <button type="button" className="btn" onClick={() => window.print()}>
            Print / save PDF
          </button>
          {canManageShares && (
            <Form method="post">
              <input type="hidden" name="intent" value="create-share" />
              <button type="submit" className="btn btn-primary">Create secure share link</button>
            </Form>
          )}
        </div>
      </div>

      {actionData && !actionData.ok && (
        <div className="notice err" role="alert"><Icon name="alert" size={15} />{actionData.error}</div>
      )}
      {actionData && actionData.ok && "message" in actionData && (
        <div className="notice ok" role="status"><Icon name="check" size={15} />{actionData.message}</div>
      )}
      {shareUrl && activeShares.length === 0 && (
        <section className="client-report-share-callout" aria-label="Secure report link">
          <div>
            <span className="eyebrow">Ready to share</span>
            <h2>The report is still a fixed snapshot.</h2>
            <p>Anyone with this link can read it until it expires or you revoke it.</p>
          </div>
          <div className="client-report-share-url">
            <input aria-label="Secure report link" readOnly value={shareUrl} />
            <button type="button" className="btn" onClick={copyShare}>{copied ? "Copied" : "Copy link"}</button>
          </div>
          {shareExpiresAt && <p className="client-report-share-expiry">Expires {new Date(shareExpiresAt).toLocaleDateString()}</p>}
          {canManageShares && (
            <Form method="post">
              <input type="hidden" name="intent" value="revoke-shares" />
              <button type="submit" className="btn btn-quiet">Revoke active links</button>
            </Form>
          )}
        </section>
      )}

      {activeShares.length > 0 && (
        <section className="client-report-share-callout" aria-label="Active report links">
          <div>
            <span className="eyebrow">Active links</span>
            <h2>Manage shared report versions</h2>
            <p>These links remain tied to this fixed report snapshot.</p>
          </div>
          <ul className="report-share-history">
            {activeShares.map((share, index) => {
              const latestUrl = actionData && "shareId" in actionData && actionData.shareId === share.shareId && "shareUrl" in actionData ? String(actionData.shareUrl) : "";
              const url = shareUrls[share.shareId] ?? latestUrl;
              return <li key={share.shareId}>
                <div><b>Link {activeShares.length - index}</b><small>Expires {new Date(share.expiresAt).toLocaleDateString()}</small></div>
                <div className="row-tight">
                  {url ? <><a className="btn btn-sm" href={url} target="_blank" rel="noreferrer">Open</a><button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(url)}>Copy</button></> : <span className="faint">URL is stored only in the browser that created it.</span>}
                  {canManageShares && <Form method="post" className="inline"><input type="hidden" name="intent" value="revoke-share" /><input type="hidden" name="shareId" value={share.shareId} /><button type="submit" className="btn btn-sm btn-quiet">Revoke</button></Form>}
                </div>
              </li>;
            })}
          </ul>
        </section>
      )}

      <ClientReportDocument snapshot={report.snapshot.public} />
    </div>
  );
}
