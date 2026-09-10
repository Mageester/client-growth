import { Form, Link, redirect } from "react-router";

import { decideSignup, parseSignupPolicy } from "@/core/signupAccess";
import {
  getWorkspaceInvitationByToken,
  hasPendingInvitationForEmail,
} from "@/db/teamInvitations";
import { createWorkspaceForOwner, newWorkspaceId } from "@/db/workspaces";
import { getAuth, getTrustedAuthBaseURL } from "../lib/auth.server";
import { canDeliverEmail } from "../lib/resend.server";
import { getSession } from "../lib/session.server";
import { d1Db } from "../lib/d1.server";
import { verificationEmailCookie } from "../lib/verification-email.server";
import { AxiomCredit, BrandLockup, Icon } from "../components/ui";
import type { Route } from "./+types/signup";

function safeReturnTo(value: string | null | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return undefined;
  try {
    const parsed = new URL(candidate, "https://orbit.invalid");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return undefined;
  }
}

function invitationTokenFromReturnTo(returnTo: string | undefined): string | undefined {
  const token = returnTo?.startsWith("/invite/") ? returnTo.slice("/invite/".length) : "";
  return /^[a-f0-9]{64}$/i.test(token) ? token : undefined;
}

async function hasLiveInvitationReturn(
  db: Parameters<typeof getWorkspaceInvitationByToken>[0],
  returnTo: string | undefined,
): Promise<boolean> {
  const token = invitationTokenFromReturnTo(returnTo);
  if (!token) return false;
  const invitation = await getWorkspaceInvitationByToken(db, token);
  if (!invitation || invitation.acceptedAt || invitation.revokedAt) return false;
  return invitation.expiresAt > new Date().toISOString();
}

export function meta(args?: Route.MetaArgs) {
  const data = args?.data;
  const canCreateAccount = data?.publicSignup === true || data?.invitationSignup === true;
  return [{ title: canCreateAccount ? "Create account · Axiom Orbit" : "Request pilot access · Axiom Orbit" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  if (await getSession(request, context)) throw redirect(returnTo ?? "/");
  const policy = parseSignupPolicy(context.cloudflare.env as never);
  const db = d1Db(context.cloudflare.env.DB as never);
  return {
    returnTo,
    publicSignup: policy.mode === "open",
    // A closed signup page may show an access step only when the server can
    // prove this is a live invitation handoff or an operator-configured
    // allowlist exists. The action still checks the submitted email before auth writes.
    invitationSignup: await hasLiveInvitationReturn(db, returnTo),
    allowlistSignup: policy.allowlist.length > 0,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const workspaceName = String(form.get("workspaceName") ?? "").trim();
  const returnTo = safeReturnTo(
    String(form.get("returnTo") ?? "") || new URL(request.url).searchParams.get("returnTo"),
  );

  // Admission to the product, checked before Better Auth creates anything. An
  // invited colleague passes on the invitation their owner already sent them.
  const policy = parseSignupPolicy(context.cloudflare.env as never);
  // The pilot access check is deliberately allowlist-only. It must not query
  // pending invitations or reveal that an address was invited; invitations are
  // admitted through the validated returnTo handoff and final signup action.
  const decision =
    intent === "check-access"
      ? decideSignup({
          policy: { ...policy, mode: "invite" },
          email,
          hasPendingInvitation: false,
        })
      : decideSignup({
          policy,
          email,
          hasPendingInvitation:
            policy.mode === "open"
              ? false
              : await hasPendingInvitationForEmail(
                  d1Db(context.cloudflare.env.DB as never),
                  email,
                ),
        });
  const hasValidatedInvitationReturn =
    intent !== "check-access" && decision.allowed && returnTo
      ? await hasLiveInvitationReturn(d1Db(context.cloudflare.env.DB as never), returnTo)
      : false;
  const exposeAccessState =
    decision.allowed && (intent === "check-access" || hasValidatedInvitationReturn);
  const accessState = exposeAccessState
    ? { accessChecked: true as const, accessEmail: email, returnTo }
    : {};
  const withAccessState = <T extends object>(result: T): T & typeof accessState =>
    exposeAccessState ? { ...accessState, ...result } : result;

  if (intent === "check-access") {
    if (!email) {
      return { accessError: "Enter your agency email to check pilot access.", returnTo };
    }
    if (!decision.allowed) {
      return {
        accessError:
          "That email is not on the current pilot allowlist. Use an invited email or contact Axiom Orbit for access.",
        returnTo,
      };
    }
    return accessState;
  }

  if (!email || !password || !workspaceName) return withAccessState({ error: "Fill in every field." });
  if (password.length < 8) {
    return withAccessState({ error: "Use a password of at least 8 characters." });
  }

  if (!decision.allowed) return { error: decision.reason };

  // Signing in REQUIRES a verified email, so an environment that cannot send
  // one cannot create a usable account — it creates a dead one, silently, with
  // no way back for the person holding it. Refuse before Better Auth writes a
  // user row, and make the cause loud where an operator will see it.
  if (!canDeliverEmail(context.cloudflare.env as never)) {
    console.error(
      "[auth] sign-up refused: no email transport is configured, so the required " +
        "verification email cannot be sent. Set RESEND_API_KEY and RESEND_FROM_EMAIL.",
    );
    return withAccessState({
      error:
        "Account creation is temporarily unavailable. Nothing was created — please try again shortly.",
    });
  }

  const auth = getAuth(context.cloudflare.env as never);
  let cookie: string | null = null;
  let userId: string;
  try {
    const callbackURL = new URL("/login?verified=success", getTrustedAuthBaseURL(context.cloudflare.env as never));
    if (returnTo) callbackURL.searchParams.set("returnTo", returnTo);
    const res = await auth.api.signUpEmail({
      body: { email, password, name: workspaceName, callbackURL: callbackURL.toString() },
      headers: request.headers,
      asResponse: true,
    });
    cookie = res.headers.get("set-cookie");
    if (!res.ok) {
      return withAccessState({ error: "That email is already in use, or the details were rejected." });
    }
    // With requireEmailVerification enabled Better Auth intentionally returns
    // no session cookie. Do not create a workspace from the response body:
    // duplicate signups use the same generic response shape for privacy.
    if (!cookie) {
      const verificationLocation = new URL("/login?verify=sent", getTrustedAuthBaseURL(context.cloudflare.env as never));
      if (returnTo) verificationLocation.searchParams.set("returnTo", returnTo);
      throw redirect(`${verificationLocation.pathname}${verificationLocation.search}`, {
        headers: {
          "set-cookie": verificationEmailCookie(email, verificationLocation.origin),
        },
      });
    }
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    if (!session?.user) return withAccessState({ error: "Sign-up failed. Please try again." });
    userId = session.user.id;
  } catch (error) {
    if (error instanceof Response) throw error;
    return withAccessState({ error: "That email is already in use, or the details were rejected." });
  }

  try {
    await createWorkspaceForOwner(d1Db(context.cloudflare.env.DB as never), {
      id: newWorkspaceId(),
      name: workspaceName,
      ownerUserId: userId,
    });
    return redirect("/onboarding", { headers: { "set-cookie": cookie } });
  } catch {
    return redirect("/onboarding", { headers: { "set-cookie": cookie } });
  }
}

export default function Signup({ loaderData, actionData }: Route.ComponentProps) {
  const returnTo = loaderData.returnTo;
  const actionFields = actionData as Record<string, unknown> | undefined;
  const accessEmail = typeof actionFields?.accessEmail === "string" ? actionFields.accessEmail : undefined;
  const accessChecked = actionFields?.accessChecked === true && accessEmail !== undefined;
  const accessError = typeof actionFields?.accessError === "string" ? actionFields.accessError : undefined;
  const error = typeof actionFields?.error === "string" ? actionFields.error : undefined;
  const canCreateAccount =
    loaderData.publicSignup || loaderData.invitationSignup || accessChecked;
  const showAccessCheck =
    !loaderData.publicSignup && !loaderData.invitationSignup && loaderData.allowlistSignup && !accessChecked;
  return (
    <main className="auth">
      <BrandLockup className="auth-lockup" />
      <h1>{canCreateAccount ? "Start with your portfolio" : "Request pilot access"}</h1>
      <p className="auth-sub">
        {canCreateAccount
          ? "Create a workspace for the client sites you already look after."
          : "Axiom Orbit is currently an invitation-only pilot for agencies growing the client relationships they already manage."}
      </p>
      {!loaderData.publicSignup && (
        <div className="notice" role="status" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
          <Icon name="alert" size={15} />
          <span>
            {loaderData.invitationSignup
              ? "You are following an invitation. Use the address the invitation was sent to so your account can join the right workspace."
              : loaderData.allowlistSignup
                ? "Axiom Orbit is running a controlled pilot. Use an allowlisted agency email or the invitation link your colleague sent you."
                : "Request pilot access from Axiom Orbit, or use the invitation link your colleague sent you. Invited colleagues can create an account with the address the invitation was sent to."}
          </span>
        </div>
      )}
      {!canCreateAccount && (
        <>
          <p className="prose auth-access-explanation" style={{ marginTop: "1.25rem" }}>
            There is no open self-serve account creation right now. If you already have an
            invitation, start from that link so we can keep the invitation and account email
            together.
          </p>
          {showAccessCheck ? (
            <Form method="post">
              {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
              <input type="hidden" name="intent" value="check-access" />
              <div className="field">
                <label htmlFor="pilotAccessEmail">Agency email</label>
                <input
                  id="pilotAccessEmail"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary btn-lg">
                Check pilot access
              </button>
            </Form>
          ) : (
            <Link className="btn btn-primary btn-lg" to="/login">
              Already invited? Log in
            </Link>
          )}
        </>
      )}
      {accessError && (
        <div className="notice err" role="alert" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
          <Icon name="alert" size={15} />
          <span>{accessError}</span>
        </div>
      )}
      {error && (
        <div className="notice err" role="alert" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
          <Icon name="alert" size={15} />
          <span>{error}</span>
        </div>
      )}
      {canCreateAccount && (
        <Form method="post">
          {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
          <div className="field">
            <label htmlFor="workspaceName">Agency name</label>
            <input
              id="workspaceName"
              name="workspaceName"
              type="text"
              autoComplete="organization"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              defaultValue={accessEmail}
              readOnly={Boolean(accessEmail)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <div className="field-hint">At least 8 characters.</div>
          </div>
          <button type="submit" className="btn btn-primary btn-lg">
            Create account
          </button>
        </Form>
      )}
      <p className="auth-foot">
        Already have an account?{" "}
        <Link
          className="link"
          to={returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login"}
        >
          Log in
        </Link>
      </p>
      <div className="auth-credit">
        <AxiomCredit />
      </div>
    </main>
  );
}
