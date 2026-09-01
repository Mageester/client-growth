import { Form, Link } from "react-router";

import { getAuth, getTrustedAuthBaseURL } from "../lib/auth.server";
import { AxiomCredit, Icon } from "../components/ui";
import type { Route } from "./+types/forgot-password";

const GENERIC_ERROR = "We couldn’t start the password reset. Please try again later.";
const RESET_SUBMITTED = "If an account matches, we’ll send a reset link. Check your email.";
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
};

export function meta() {
  return [{ title: "Forgot password · Client Growth" }];
}

export function headers(_args: Route.HeadersArgs) {
  return NO_STORE_HEADERS;
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email address." };

  try {
    const env = context.cloudflare.env;
    const redirectTo = new URL("/reset-password", getTrustedAuthBaseURL(env as never)).toString();
    const response = await getAuth(env as never).api.requestPasswordReset({
      body: { email, redirectTo },
      headers: request.headers,
      asResponse: true,
    });
    if (!response.ok) return { error: GENERIC_ERROR };
    return { submitted: true };
  } catch {
    return { error: GENERIC_ERROR };
  }
}

export default function ForgotPassword({ actionData }: Route.ComponentProps) {
  return (
    <main className="auth">
      <span className="auth-eyebrow">Account recovery</span>
      <h1>Reset your password</h1>
      <p className="auth-sub">
        Enter your account email and we will send a reset link if it matches.
      </p>
      {actionData?.submitted ? (
        <>
          <div className="notice ok" role="status" style={{ marginTop: "1.5rem" }}>
            <Icon name="check" size={15} />
            <span>{RESET_SUBMITTED}</span>
          </div>
          <p className="prose">
            If you do not see it soon, check your spam folder or request another link.
          </p>
          <Link className="btn btn-block" to="/login" style={{ marginTop: "1.25rem" }}>
            Back to log in
          </Link>
        </>
      ) : (
        <>
          {actionData?.error && (
            <div
              className="notice err"
              role="alert"
              style={{ marginTop: "1.25rem", marginBottom: 0 }}
            >
              <Icon name="alert" size={15} />
              <span>{actionData.error}</span>
            </div>
          )}
          <Form method="post">
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <button type="submit" className="btn btn-primary btn-lg">
              Send reset link
            </button>
          </Form>
          <p className="auth-foot">
            Remembered it?{" "}
            <Link className="link" to="/login">
              Log in
            </Link>
          </p>
        </>
      )}
      <div className="auth-credit">
        <AxiomCredit />
      </div>
    </main>
  );
}
