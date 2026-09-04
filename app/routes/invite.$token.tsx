import { Form, Link, redirect } from "react-router";

import { getWorkspace } from "@/db/workspaces";
import {
  acceptWorkspaceInvitation,
  getWorkspaceInvitationByToken,
} from "@/db/teamInvitations";
import { d1Db } from "../lib/d1.server";
import { getSession } from "../lib/session.server";
import type { AuthEnv } from "../lib/auth.server";
import { AxiomCredit, BrandLockup, Icon } from "../components/ui";

interface InviteContext {
  cloudflare: { env: AuthEnv };
}

interface InviteArgs {
  request: Request;
  context: InviteContext;
  params: { token?: string };
}

interface InviteDetails {
  workspaceName: string;
  invitedEmail: string;
  role: string;
  expiresAt: string;
  expired: boolean;
  accepted: boolean;
  revoked: boolean;
}

interface InviteLoaderData {
  token: string;
  invitation: InviteDetails | null;
  signedIn: boolean;
  emailVerified: boolean;
}

interface InviteActionData {
  error?: string;
}

const INVALID_INVITATION = "This invitation is invalid, expired, or no longer available.";
const UNVERIFIED_INVITATION = "Verify your email before accepting this invitation.";
const MISMATCHED_INVITATION = "This invitation was sent to a different email address.";
const ACCEPTED_INVITATION = "This invitation has already been accepted.";
const ALREADY_MEMBER_INVITATION =
  "This account already belongs to a workspace and cannot accept another invitation.";
const INVITATION_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
};

function tokenFromParams(params: { token?: string }): string {
  const token = params.token?.trim() ?? "";
  return /^[a-f0-9]{64}$/i.test(token) ? token : "";
}

function returnTo(token: string): string {
  return `/invite/${encodeURIComponent(token)}`;
}

export function meta() {
  return [{ title: "Team invitation · Axiom Orbit" }];
}

export function headers(_args: unknown) {
  return INVITATION_HEADERS;
}

export async function loader({ request, context, params }: InviteArgs): Promise<InviteLoaderData> {
  const token = tokenFromParams(params);
  const db = d1Db(context.cloudflare.env.DB as never);
  const invite = token ? await getWorkspaceInvitationByToken(db, token) : null;
  const workspace = invite ? await getWorkspace(db, invite.workspaceId) : null;
  const session = await getSession(request, context);
  const invitation =
    invite && workspace
      ? {
          workspaceName: workspace.name,
          invitedEmail: invite.invitedEmail,
          role: invite.role,
          expiresAt: invite.expiresAt,
          expired: invite.expiresAt <= new Date().toISOString(),
          accepted: invite.acceptedAt !== null,
          revoked: invite.revokedAt !== null,
        }
      : null;
  return {
    token,
    invitation,
    signedIn: session !== null,
    emailVerified: session?.user.emailVerified === true,
  };
}

export async function action({ request, context, params }: InviteArgs): Promise<never | InviteActionData> {
  const token = tokenFromParams(params);
  if (!token) return { error: INVALID_INVITATION };

  const session = await getSession(request, context);
  if (!session) {
    throw redirect(`/login?returnTo=${encodeURIComponent(returnTo(token))}`);
  }
  if (session.user.emailVerified !== true) return { error: UNVERIFIED_INVITATION };

  const result = await acceptWorkspaceInvitation(d1Db(context.cloudflare.env.DB as never), {
    token,
    userId: session.user.id,
    email: session.user.email,
    emailVerified: true,
  });
  if (result.ok) throw redirect("/");

  if (result.reason === "email_mismatch") return { error: MISMATCHED_INVITATION };
  if (result.reason === "email_unverified") return { error: UNVERIFIED_INVITATION };
  if (result.reason === "already_used") return { error: ACCEPTED_INVITATION };
  if (result.reason === "already_member") return { error: ALREADY_MEMBER_INVITATION };
  return { error: INVALID_INVITATION };
}

export default function TeamInvitation({ loaderData, actionData }: {
  loaderData: InviteLoaderData;
  actionData?: InviteActionData;
}) {
  const invitation = loaderData.invitation;
  const unusable =
    !invitation || invitation.expired || invitation.accepted || invitation.revoked;
  const invitePath = returnTo(loaderData.token);

  return (
    <main className="auth">
      <BrandLockup className="auth-lockup" />
      <span className="auth-eyebrow">Team invitation</span>
      <h1>Join an Axiom Orbit workspace</h1>
      {actionData?.error && (
        <div className="notice err" role="alert" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}
      {unusable ? (
        <>
          <div className="notice err" role="alert" style={{ marginTop: "1.25rem" }}>
            <Icon name="alert" size={15} />
            <span>{INVALID_INVITATION}</span>
          </div>
          <p className="auth-foot">
            Need a new invitation? Ask the workspace owner to send another one.
          </p>
          <Link className="btn btn-block" to="/login">
            Back to log in
          </Link>
        </>
      ) : (
        <>
          <p className="auth-sub">
            {invitation.workspaceName} invited {invitation.invitedEmail} to join as a {invitation.role}.
          </p>
          <p className="prose">This invitation expires on {invitation.expiresAt}.</p>
          {!loaderData.signedIn ? (
            <>
              <p className="prose">Log in with the invited email address to accept it.</p>
              <Link className="btn btn-primary btn-block" to={`/login?returnTo=${encodeURIComponent(invitePath)}`}>
                Log in to accept
              </Link>
            </>
          ) : !loaderData.emailVerified ? (
            <div className="notice warn" role="status">
              <Icon name="alert" size={15} />
              <span>{UNVERIFIED_INVITATION}</span>
            </div>
          ) : (
            <Form method="post">
              <button type="submit" className="btn btn-primary btn-lg">
                Accept invitation
              </button>
            </Form>
          )}
        </>
      )}
      <div className="auth-credit">
        <AxiomCredit />
      </div>
    </main>
  );
}
