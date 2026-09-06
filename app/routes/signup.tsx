import { Form, Link, redirect } from "react-router";

import { decideSignup, parseSignupPolicy } from "@/core/signupAccess";
import { hasPendingInvitationForEmail } from "@/db/teamInvitations";
import { createWorkspaceForOwner, newWorkspaceId } from "@/db/workspaces";
import { getAuth, getTrustedAuthBaseURL } from "../lib/auth.server";
import { canDeliverEmail } from "../lib/resend.server";
import { getSession } from "../lib/session.server";
import { d1Db } from "../lib/d1.server";
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

export function meta() {
  return [{ title: "Create account · Axiom Orbit" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  if (await getSession(request, context)) throw redirect(returnTo ?? "/");
  // Say so on the page rather than only after the form is filled in. An
  // invited colleague still gets the form: their invitation is checked on
  // submit, against the address they actually type.
  const policy = parseSignupPolicy(context.cloudflare.env as never);
  return { returnTo, publicSignup: policy.mode === "open" };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const workspaceName = String(form.get("workspaceName") ?? "").trim();
  const returnTo = safeReturnTo(
    String(form.get("returnTo") ?? "") || new URL(request.url).searchParams.get("returnTo"),
  );

  if (!email || !password || !workspaceName) return { error: "Fill in every field." };
  if (password.length < 8) return { error: "Use a password of at least 8 characters." };

  // Admission to the product, checked before Better Auth creates anything. An
  // invited colleague passes on the invitation their owner already sent them.
  const policy = parseSignupPolicy(context.cloudflare.env as never);
  const decision = decideSignup({
    policy,
    email,
    hasPendingInvitation:
      policy.mode === "open"
        ? false
        : await hasPendingInvitationForEmail(d1Db(context.cloudflare.env.DB as never), email),
  });
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
    return {
      error:
        "Account creation is temporarily unavailable. Nothing was created — please try again shortly.",
    };
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
      return { error: "That email is already in use, or the details were rejected." };
    }
    // With requireEmailVerification enabled Better Auth intentionally returns
    // no session cookie. Do not create a workspace from the response body:
    // duplicate signups use the same generic response shape for privacy.
    if (!cookie) {
      const verificationLocation = new URL("/login?verify=sent", getTrustedAuthBaseURL(context.cloudflare.env as never));
      if (returnTo) verificationLocation.searchParams.set("returnTo", returnTo);
      throw redirect(`${verificationLocation.pathname}${verificationLocation.search}`);
    }
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    if (!session?.user) return { error: "Sign-up failed. Please try again." };
    userId = session.user.id;
  } catch (error) {
    if (error instanceof Response) throw error;
    return { error: "That email is already in use, or the details were rejected." };
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
  return (
    <main className="auth">
      <BrandLockup className="auth-lockup" />
      <h1>Start with your portfolio</h1>
      <p className="auth-sub">
        Create a workspace for the client sites you already look after.
      </p>
      {!loaderData.publicSignup && (
        <div className="notice" role="status" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
          <Icon name="alert" size={15} />
          <span>
            Axiom Orbit is invitation-only right now. If a colleague invited you, use the
            address the invitation was sent to.
          </span>
        </div>
      )}
      {actionData?.error && (
        <div className="notice err" role="alert" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}
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
          <input id="email" name="email" type="email" autoComplete="email" required />
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
