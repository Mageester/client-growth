import { Form, Link } from "react-router";

import { getAuth, getTrustedAuthBaseURL } from "../lib/auth.server";
import { Icon } from "../components/ui";
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
    <main className="auth-layout">
      <section className="card auth-card">
        <div className="auth-header">
          <h1>Reset your password</h1>
          <p>Enter your account email and we’ll send a reset link if it matches.</p>
        </div>
        {actionData?.submitted ? (
          <>
            <div className="notice ok" role="status">
              <Icon name="check" size={17} />
              <span>{RESET_SUBMITTED}</span>
            </div>
            <p className="muted">If you don’t see it soon, check your spam folder or request another link.</p>
            <Link className="btn btn-secondary" to="/login">Back to log in</Link>
          </>
        ) : (
          <>
            {actionData?.error && (
              <div className="notice err" role="alert">
                <Icon name="x" size={17} />
                <span>{actionData.error}</span>
              </div>
            )}
            <Form method="post" className="stack">
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              <button type="submit" className="btn btn-primary">Send reset link</button>
            </Form>
            <p className="auth-footer">Remembered it? <Link to="/login">Log in</Link></p>
          </>
        )}
      </section>
    </main>
  );
}
