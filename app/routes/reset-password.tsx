import { Form, Link, redirect } from "react-router";

import { getAuth } from "../lib/auth.server";
import { Icon } from "../components/ui";
import type { Route } from "./+types/reset-password";

const INVALID_RESET = "That reset link is invalid or expired. Request a new one.";
const PASSWORD_LENGTH_ERROR = "Use a password between 8 and 128 characters.";
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
};

export function meta() {
  return [{ title: "Reset password · Client Growth" }];
}

export function headers(_args: Route.HeadersArgs) {
  return NO_STORE_HEADERS;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const token = url.searchParams.get("token")?.trim() ?? "";
  if (error || !token) return { token: "", invalid: true };
  return { token, invalid: false };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "").trim();
  const newPassword = String(form.get("newPassword") ?? "");
  const confirmPassword = String(form.get("confirmPassword") ?? "");

  if (!token) return { error: INVALID_RESET };
  if (newPassword.length < 8 || newPassword.length > 128) return { error: PASSWORD_LENGTH_ERROR };
  if (newPassword !== confirmPassword) return { error: "The passwords do not match." };

  try {
    const response = await getAuth(context.cloudflare.env as never).api.resetPassword({
      body: { newPassword, token },
      headers: request.headers,
      asResponse: true,
    });
    if (!response.ok) return { error: INVALID_RESET };
    const body = (await response.json().catch(() => null)) as { status?: unknown } | null;
    if (body?.status !== true) return { error: INVALID_RESET };
    throw redirect("/login?reset=success");
  } catch (error) {
    if (error instanceof Response) throw error;
    return { error: INVALID_RESET };
  }
}

export default function ResetPassword({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main className="auth-layout">
      <section className="card auth-card">
        <div className="auth-header">
          <h1>Choose a new password</h1>
          <p>Use a password you’ll be comfortable keeping for your Client Growth account.</p>
        </div>
        {loaderData.invalid ? (
          <>
            <div className="notice err" role="alert">
              <Icon name="x" size={17} />
              <span>{INVALID_RESET}</span>
            </div>
            <Link className="btn btn-secondary" to="/forgot-password">Request a new reset link</Link>
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
              <input type="hidden" name="token" value={loaderData.token} />
              <div className="field">
                <label htmlFor="newPassword">New password</label>
                <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
              </div>
              <div className="field">
                <label htmlFor="confirmPassword">Confirm new password</label>
                <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
              </div>
              <button type="submit" className="btn btn-primary">Reset password</button>
            </Form>
            <p className="auth-footer">Need a fresh link? <Link to="/forgot-password">Start again</Link></p>
          </>
        )}
      </section>
    </main>
  );
}
