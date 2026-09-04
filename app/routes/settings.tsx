import { Form, useNavigation } from "react-router";

import * as monitoringRepo from "@/db/monitoring";
import {
  getWorkspaceBranding,
  isProposalShareError,
  saveWorkspaceBranding,
  validateLogo,
} from "@/db/proposalShares";
import {
  createWorkspaceInvitation,
  listPendingWorkspaceInvitations,
  listWorkspaceMembers,
  revokeWorkspaceInvitation,
  TeamInvitationError,
} from "@/db/teamInvitations";
import { renameWorkspace } from "@/db/workspaces";
import {
  createResendTeamInvitationSender,
  getResendConfig,
} from "../lib/resend.server";
import { getTrustedAuthBaseURL } from "../lib/auth.server";
import { AxiomCredit, Icon, pluralize } from "../components/ui";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/settings";

export function meta() {
  return [{ title: "Settings · Axiom Orbit" }];
}

/** The window the monitoring health section reports on. */
const HEALTH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export async function loader({ request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  const [states, health, members, invitations, branding] = await Promise.all([
    monitoringRepo.listMonitoringByClient(t.scope),
    monitoringRepo.scheduledRunHealth(t.scope, {
      since: new Date(Date.now() - HEALTH_WINDOW_MS).toISOString(),
    }),
    listWorkspaceMembers(t.db, t.workspace.id),
    listPendingWorkspaceInvitations(t.db, t.workspace.id),
    getWorkspaceBranding(t.scope),
  ]);
  return {
    email: t.user.email,
    workspaceName: t.workspace.name,
    logo: branding.logo,
    isOwner: t.userId === t.workspace.ownerUserId,
    members,
    invitations,
    monitoring: { ...monitoringRepo.summarizePortfolio(states.values()), ...health },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create-invitation") {
    if (t.userId !== t.workspace.ownerUserId) {
      return { error: "Only the workspace owner can manage invitations." };
    }
    const invitedEmail = String(form.get("email") ?? "").trim();
    const role = String(form.get("role") ?? "member");
    let resendConfig: ReturnType<typeof getResendConfig>;
    try {
      resendConfig = getResendConfig(context.cloudflare.env);
    } catch {
      return { error: "Invitation email delivery is not configured correctly." };
    }

    try {
      const invitation = await createWorkspaceInvitation(t.db, {
        workspaceId: t.workspace.id,
        invitedEmail,
        role: role as "member",
        invitedByUserId: t.userId,
      });
      const invitationURL = new URL(
        `/invite/${invitation.token}`,
        getTrustedAuthBaseURL(context.cloudflare.env),
      ).toString();
      let invitationEmailSent = false;
      if (resendConfig) {
        try {
          await createResendTeamInvitationSender(resendConfig)({
            email: invitation.invitedEmail,
            workspaceName: t.workspace.name,
            role: invitation.role,
            url: invitationURL,
            token: invitation.token,
            expiresAt: invitation.expiresAt,
          });
          invitationEmailSent = true;
        } catch {
          // Keep the invitation usable through the owner-visible link even if
          // the optional email transport is temporarily unavailable.
        }
      }
      return {
        ok: true,
        invitationLink: invitationURL,
        invitedEmail: invitation.invitedEmail,
        invitationEmailSent,
      };
    } catch (error) {
      if (error instanceof TeamInvitationError) return { error: error.message };
      return { error: "Could not create that invitation. Please try again." };
    }
  }

  if (intent === "revoke-invitation") {
    if (t.userId !== t.workspace.ownerUserId) {
      return { error: "Only the workspace owner can manage invitations." };
    }
    const invitationId = String(form.get("invitationId") ?? "").trim();
    if (!invitationId || !(await revokeWorkspaceInvitation(t.db, t.workspace.id, invitationId))) {
      return { error: "That invitation is no longer pending." };
    }
    return { ok: true };
  }

  const name = String(form.get("workspaceName") ?? "").trim();
  if (!name) return { error: "Workspace name cannot be empty." };
  const logo = form.has("logo") ? form.get("logo") : undefined;
  if (form.has("logo")) {
    const checkedLogo = validateLogo(logo);
    if (!checkedLogo.ok) return { error: checkedLogo.error };
  }
  try {
    await renameWorkspace(t.db, t.workspace.id, name);
    if (form.has("logo")) await saveWorkspaceBranding(t.scope, { logo });
  } catch (error) {
    if (isProposalShareError(error)) return { error: error.message };
    throw error;
  }
  return { ok: true };
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const saving = navigation.state !== "idle";

  return (
    <div className="detail detail-narrow">
      <div className="pagehead">
        <div className="pagehead-copy">
          <span className="eyebrow">Account</span>
          <h1 className="title-page">Settings</h1>
        </div>
      </div>

      {actionData && "ok" in actionData && actionData.ok && (
        <div className="notice ok" role="status">
          <Icon name="check" size={15} />
          <span>Workspace saved.</span>
        </div>
      )}
      {actionData && "error" in actionData && actionData.error && (
        <div className="notice err" role="alert">
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}
      {actionData && "invitationLink" in actionData && actionData.invitationLink && (
        <div className="notice ok" role="status">
          <Icon name="check" size={15} />
          <span>
            {actionData.invitationEmailSent
              ? `Invitation sent to ${actionData.invitedEmail}.`
              : "Invitation created. Share this link with the recipient:"}
            <input
              aria-label="Team invitation link"
              readOnly
              value={actionData.invitationLink}
              style={{ display: "block", width: "100%", marginTop: "0.6rem" }}
            />
          </span>
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Workspace</h2>
            <p>The agency name shown across Axiom Orbit.</p>
          </div>
        </div>
        <Form method="post">
          <div className="field">
            <label htmlFor="workspaceName">Workspace name</label>
            <input
              id="workspaceName"
              name="workspaceName"
              type="text"
              defaultValue={loaderData.workspaceName}
            />
          </div>
          <div className="field">
            <label htmlFor="workspaceLogo">Proposal logo</label>
            <input
              id="workspaceLogo"
              name="logo"
              type="text"
              inputMode="url"
              defaultValue={loaderData.logo ?? ""}
              placeholder="data:image/png;base64,… or https://…"
              aria-describedby="workspaceLogoHelp"
            />
            <p id="workspaceLogoHelp" className="field-help">
              Optional PNG or JPEG. A small inline data URL is safest; public logos must use HTTPS.
            </p>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </Form>
      </section>

      <MonitoringHealth monitoring={loaderData.monitoring} />

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Team</h2>
            <p>People with access to this workspace and their roles.</p>
          </div>
        </div>

        <dl>
          {loaderData.members.map((member) => (
            <div className="kv-row" key={member.userId}>
              <dt>{member.name || member.email}</dt>
              <dd>
                {member.email} · {member.role}
              </dd>
            </div>
          ))}
        </dl>

        {loaderData.isOwner ? (
          <>
            <h3 className="title-section" style={{ marginTop: "1.5rem" }}>
              Invite a teammate
            </h3>
            <Form method="post">
              <input type="hidden" name="intent" value="create-invitation" />
              <div className="field">
                <label htmlFor="inviteEmail">Recipient email</label>
                <input id="inviteEmail" name="email" type="email" autoComplete="email" required />
              </div>
              <div className="field">
                <label htmlFor="inviteRole">Role</label>
                <select id="inviteRole" name="role" defaultValue="member">
                  <option value="member">Member</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary">
                Create invitation
              </button>
            </Form>

            {loaderData.invitations.length > 0 && (
              <>
                <h3 className="title-section" style={{ marginTop: "1.5rem" }}>
                  Pending invitations
                </h3>
                <dl>
                  {loaderData.invitations.map((invitation) => (
                    <div className="kv-row" key={invitation.id}>
                      <dt>{invitation.invitedEmail}</dt>
                      <dd>
                        {invitation.role} · expires {invitation.expiresAt}{" "}
                        <Form method="post" style={{ display: "inline" }}>
                          <input type="hidden" name="intent" value="revoke-invitation" />
                          <input type="hidden" name="invitationId" value={invitation.id} />
                          <button type="submit" className="btn" style={{ marginLeft: "0.5rem" }}>
                            Revoke
                          </button>
                        </Form>
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </>
        ) : (
          <p className="prose faint" style={{ marginTop: "1rem" }}>
            The workspace owner manages invitations and roles.
          </p>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Account</h2>
            <p>The signed-in account that owns this workspace.</p>
          </div>
        </div>
        <dl>
          <div className="kv-row">
            <dt>Email</dt>
            <dd>{loaderData.email}</dd>
          </div>
        </dl>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Session</h2>
            <p>Sign out of this browser when you are finished.</p>
          </div>
          <Form method="post" action="/logout">
            <button type="submit" className="btn">
              <Icon name="logout" size={14} />
              Log out
            </button>
          </Form>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">About</h2>
            <p>
              Axiom Orbit watches the websites of the clients you already look after and surfaces
              evidence-backed work worth bringing up.
            </p>
          </div>
        </div>
        <AxiomCredit />
      </section>
    </div>
  );
}

/**
 * Whether monitoring is actually working, in the agency's language.
 *
 * The operator-facing version of these numbers (evaluator calls, rejections,
 * errors) is deliberately separate: it lives in the Worker's scheduled-run log
 * line and in the operator trigger's JSON. What belongs here is only what an
 * agency owner can act on — how much is watched, how much it found, and whether
 * any site could not be read.
 */
function MonitoringHealth({
  monitoring,
}: {
  monitoring: Awaited<ReturnType<typeof loader>>["monitoring"];
}) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2 className="title-section">Monitoring</h2>
          <p>
            Axiom Orbit re-checks monitored clients on their own schedule. Turn it on for a
            client from that client&rsquo;s page.
          </p>
        </div>
      </div>

      {monitoring.monitored === 0 ? (
        <p className="prose faint">
          No client is monitored yet, so nothing is checked automatically and nothing runs in the
          background.
        </p>
      ) : (
        <dl>
          <div className="kv-row">
            <dt>Clients monitored</dt>
            <dd>
              {monitoring.monitored}
              {monitoring.due > 0 && (
                <span className="faint">
                  {" "}
                  · {monitoring.due} {pluralize(monitoring.due, "check", "checks")} due
                </span>
              )}
            </dd>
          </div>
          <div className="kv-row">
            <dt>Checks in the last 30 days</dt>
            <dd>
              {monitoring.runs}
              {monitoring.inconclusive > 0 && (
                <span className="faint">
                  {" "}
                  · {monitoring.inconclusive} could not be fully analyzed
                </span>
              )}
            </dd>
          </div>
          <div className="kv-row">
            <dt>What they changed</dt>
            <dd>
              {monitoring.newFindings + monitoring.resolvedFindings === 0
                ? "Nothing new"
                : `${monitoring.newFindings} new · ${monitoring.resolvedFindings} fixed by the client`}
            </dd>
          </div>
          {monitoring.evaluatorErrors > 0 && (
            <div className="kv-row">
              <dt>Incomplete checks</dt>
              <dd>
                {monitoring.evaluatorErrors}{" "}
                {pluralize(monitoring.evaluatorErrors, "finding", "findings")} could not be assessed
                and {monitoring.evaluatorErrors === 1 ? "was" : "were"} dropped rather than guessed.
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
