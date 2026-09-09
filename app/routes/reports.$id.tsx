import { useState } from "react";
import { Form, Link } from "react-router";

import { ClientReportDocument } from "../components/client-report";
import { formatDate, Icon } from "../components/ui";
import {
  ClientReportError,
  createClientReportShare,
  getClientReportById,
  isClientReportError,
  listActiveClientReportShares,
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
  const [report, activeShares] = await Promise.all([
    getClientReportById(t.scope, params.id),
    listActiveClientReportShares(t.scope, params.id),
  ]);
  if (!report) throw new Response("Report not found", { status: 404 });
  return {
    report,
    activeShares,
    canManageShares: t.userId === t.workspace.ownerUserId,
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const report = await getClientReportById(t.scope, params.id);
  if (!report) throw new Response("Report not found", { status: 404 });
  const intent = String((await request.formData()).get("intent") ?? "");
  try {
    if (intent === "create-share") {
      const share = await createClientReportShare(t.scope, report.reportId, {
        actingUserId: t.userId,
      });
      const shareUrl = new URL(
        `/report/share?token=${encodeURIComponent(share.token)}`,
        getTrustedAuthBaseURL(context.cloudflare.env),
      ).toString();
      return { ok: true as const, shareUrl, expiresAt: share.expiresAt };
    }
    if (intent === "revoke-shares") {
      const revoked = await revokeClientReportShares(t.scope, report.reportId, {
        actingUserId: t.userId,
      });
      return { ok: true as const, revoked, message: "Active report links revoked." };
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
  const shareUrl = actionData && "shareUrl" in actionData ? actionData.shareUrl : null;
  const shareExpiresAt = actionData && "expiresAt" in actionData ? actionData.expiresAt : null;
  const copyShare = async () => {
    if (!shareUrl || !navigator.clipboard) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
  };

  return (
    <div className="client-report-preview-page">
      <div className="client-report-toolbar">
        <div>
          <Link className="backlink" to={`/clients/${encodeURIComponent(report.clientId)}`}>
            <Icon name="arrow-left" size={14} />
            {report.snapshot.public.client.name}
          </Link>
          <span className="client-report-toolbar-status">
            Private preview · snapshot generated {" "}
            <time dateTime={report.snapshot.public.generatedAt}>
              {formatDate(report.snapshot.public.generatedAt)}
            </time>
          </span>
        </div>
        <div className="client-report-toolbar-actions">
          <button type="button" className="btn" onClick={() => window.print()}>
            Print / save PDF
          </button>
          {canManageShares && (
            <Form method="post">
              <input type="hidden" name="intent" value="create-share" />
              <button type="submit" className="btn btn-primary">
                {activeShares.length > 0 ? "Create replacement link" : "Create secure share link"}
              </button>
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
      {activeShares.length > 0 && (
        <section className="client-report-share-callout" aria-label="Active report share links">
          <div>
            <span className="eyebrow">Active share links</span>
            <h2>{activeShares.length} active {activeShares.length === 1 ? "link" : "links"}</h2>
            <p>
              The next link expires {" "}
              <time dateTime={activeShares[activeShares.length - 1]!.expiresAt}>
                {formatDate(activeShares[activeShares.length - 1]!.expiresAt)}
              </time>.
            </p>
          </div>
          {canManageShares && (
            <Form method="post">
              <input type="hidden" name="intent" value="revoke-shares" />
              <button type="submit" className="btn btn-quiet">Revoke active links</button>
            </Form>
          )}
        </section>
      )}
      {shareUrl && (
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
          {shareExpiresAt && (
            <p className="client-report-share-expiry">
              Expires <time dateTime={shareExpiresAt}>{formatDate(shareExpiresAt)}</time>
            </p>
          )}
        </section>
      )}

      <ClientReportDocument snapshot={report.snapshot.public} />
    </div>
  );
}
