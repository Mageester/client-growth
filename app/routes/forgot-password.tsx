import { Form, Link } from "react-router";

import { getAuth, getTrustedAuthBaseURL } from "../lib/auth.server";
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
    <main style={{ maxWidth: 380, margin: "6vh auto", padding: "0 1.25rem" }}>
      <h1>Forgot your password?</h1>
      {actionData?.submitted ? (
        <>
          <div className="notice">{RESET_SUBMITTED}</div>
          <p className="muted">
            If you don’t see it soon, check your spam folder or request another link.
          </p>
          <Link to="/login">Back to log in</Link>
        </>
      ) : (
        <>
          <p className="muted">Enter your account email and we’ll send a reset link if it matches.</p>
          {actionData?.error && <div className="notice err">{actionData.error}</div>}
          <Form method="post" className="stack">
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <button type="submit" className="primary">
              Send reset link
            </button>
          </Form>
          <p className="muted" style={{ marginTop: "1rem" }}>
            Remembered it? <Link to="/login">Log in</Link>
          </p>
        </>
      )}
    </main>
  );
}
