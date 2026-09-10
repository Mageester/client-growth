import { Form, Link, redirect } from "react-router";

import { getAuth, getTrustedAuthBaseURL } from "../lib/auth.server";
import { canDeliverEmail } from "../lib/resend.server";
import { safeReturnTo } from "../lib/return-to";
import { getSession } from "../lib/session.server";
import { AxiomCredit, BrandLockup, Icon } from "../components/ui";
import type { Route } from "./+types/login";

const VERIFICATION_CALLBACK_PATH = "/login?verified=success";
const VERIFICATION_REQUIRED_ERROR = "Verify your email before logging in.";
const VERIFICATION_RESEND_ERROR = "We couldn’t send a verification email. Please try again later.";

function verificationCallbackURL(baseURL: string, returnTo?: string): string {
  const callbackURL = new URL(VERIFICATION_CALLBACK_PATH, baseURL);
  if (returnTo) callbackURL.searchParams.set("returnTo", returnTo);
  return callbackURL.toString();
}

export function meta() {
  return [{ title: "Log in · Axiom Orbit" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const search = new URL(request.url).searchParams;
  const returnTo = safeReturnTo(search.get("returnTo"));
  if (await getSession(request, context)) throw redirect(returnTo ?? "/");
  return {
    resetSuccess: search.get("reset") === "success",
    verificationSent: search.get("verify") === "sent",
    verificationSuccess: search.get("verified") === "success",
    returnTo,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const returnTo = safeReturnTo(
    String(form.get("returnTo") ?? "") || new URL(request.url).searchParams.get("returnTo"),
  );
  const withReturnTo = <T extends object>(value: T): T & { returnTo?: string } =>
    returnTo ? { ...value, returnTo } : value;

  const auth = getAuth(context.cloudflare.env as never);

  if (intent === "resend-verification") {
    if (!email) return withReturnTo({ error: "Enter your email address." });
    // Better Auth's send is a no-op when no transport is configured, and it
    // reports success. Claiming "we sent a new link" to someone who is locked
    // out and waiting for it is the worst available answer, so check first.
    if (!canDeliverEmail(context.cloudflare.env as never)) {
      console.error(
        "[auth] verification resend refused: no email transport is configured.",
      );
      return withReturnTo({ error: VERIFICATION_RESEND_ERROR, email });
    }
    try {
      const callbackURL = verificationCallbackURL(
        getTrustedAuthBaseURL(context.cloudflare.env as never),
        returnTo,
      );
      const res = await auth.api.sendVerificationEmail({
        body: { email, callbackURL },
        headers: request.headers,
        asResponse: true,
      });
      if (!res.ok) return withReturnTo({ error: VERIFICATION_RESEND_ERROR, email });
      return withReturnTo({ verificationSent: true, email });
    } catch {
      return withReturnTo({ error: VERIFICATION_RESEND_ERROR, email });
    }
  }

  if (!email || !password) return withReturnTo({ error: "Enter your email and password." });

  try {
    const callbackURL = verificationCallbackURL(
      getTrustedAuthBaseURL(context.cloudflare.env as never),
      returnTo,
    );
    const res = await auth.api.signInEmail({
      body: { email, password, callbackURL },
      headers: request.headers,
      asResponse: true,
    });
    const cookie = res.headers.get("set-cookie");
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
      if (body?.code === "EMAIL_NOT_VERIFIED") {
        return withReturnTo({
          error: VERIFICATION_REQUIRED_ERROR,
          verificationRequired: true,
          email,
        });
      }
      return withReturnTo({ error: "Incorrect email or password." });
    }
    if (!cookie) return withReturnTo({ error: "Incorrect email or password." });
    return redirect(returnTo ?? "/", { headers: { "set-cookie": cookie } });
  } catch {
    return withReturnTo({ error: "Incorrect email or password." });
  }
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  const actionEmail = actionData && "email" in actionData ? actionData.email : "";
  const returnTo = loaderData.returnTo ?? (actionData && "returnTo" in actionData ? actionData.returnTo : undefined);
  return (
    <main className="auth">
      <BrandLockup className="auth-lockup" />
      <h1>Welcome back</h1>
      <p className="auth-sub">
        Pick up where your portfolio left off and see what is worth raising next.
      </p>
      {loaderData.resetSuccess && (
        <div className="notice ok" role="status" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
          <Icon name="check" size={15} />
          <span>Password reset successfully. Log in with your new password.</span>
        </div>
      )}
      {loaderData.verificationSuccess && (
        <div className="notice ok" role="status" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
          <Icon name="check" size={15} />
          <span>Email verified. You can log in now.</span>
        </div>
      )}
      {loaderData.verificationSent && (
        <div className="notice ok" role="status" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
          <Icon name="check" size={15} />
          <span>Check your email for a verification link before logging in.</span>
        </div>
      )}
      {actionData && "verificationSent" in actionData && actionData.verificationSent && (
        <div className="notice ok" role="status" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
          <Icon name="check" size={15} />
          <span>If an unverified account uses that address, we sent a new verification link.</span>
        </div>
      )}
      {actionData && "error" in actionData && actionData.error && (
        <div className="notice err" role="alert" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}
      <Form method="post">
        {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={actionEmail}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <p className="auth-aside">
            <Link className="link" to="/forgot-password">
              Forgot password?
            </Link>
          </p>
        </div>
        <button type="submit" className="btn btn-primary btn-lg">
          Log in
        </button>
      </Form>
      {actionData && "verificationRequired" in actionData && actionData.verificationRequired === true && (
        <div style={{ marginTop: "1.25rem" }}>
          <p className="prose">
            Check your inbox for the verification link. If it is missing, request another one below.
          </p>
          <Form method="post">
            <input type="hidden" name="intent" value="resend-verification" />
            <input
              type="hidden"
              name="email"
              value={"email" in actionData ? actionData.email : ""}
            />
            {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
            <button type="submit" className="btn btn-block">
              Resend verification email
            </button>
          </Form>
        </div>
      )}
      <p className="auth-foot">
        No account?{" "}
        <Link
          className="link"
          to={returnTo ? `/signup?returnTo=${encodeURIComponent(returnTo)}` : "/signup"}
        >
          Create one
        </Link>
      </p>
      <div className="auth-credit">
        <AxiomCredit />
      </div>
    </main>
  );
}
