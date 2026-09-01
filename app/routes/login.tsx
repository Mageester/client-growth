import { Form, Link, redirect } from "react-router";

import { getAuth } from "../lib/auth.server";
import { getSession } from "../lib/session.server";
import { Icon } from "../components/ui";
import type { Route } from "./+types/login";

export function meta() {
  return [{ title: "Log in · Client Growth" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  if (await getSession(request, context)) throw redirect("/");
  return { resetSuccess: new URL(request.url).searchParams.get("reset") === "success" };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const auth = getAuth(context.cloudflare.env as never);
  try {
    const res = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    const cookie = res.headers.get("set-cookie");
    if (!res.ok || !cookie) return { error: "Incorrect email or password." };
    return redirect("/", { headers: { "set-cookie": cookie } });
  } catch {
    return { error: "Incorrect email or password." };
  }
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main className="auth-layout">
      <section className="card auth-card">
        <div className="auth-header">
          <h1>Welcome back</h1>
          <p>Log in to see what’s worth bringing to your next client conversation.</p>
        </div>
        {loaderData.resetSuccess && (
          <div className="notice ok" role="status">
            <Icon name="check" size={17} />
            <span>Password reset successfully. Log in with your new password.</span>
          </div>
        )}
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
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <p className="auth-link-row"><Link to="/forgot-password">Forgot password?</Link></p>
          <button type="submit" className="btn btn-primary">Log in</button>
        </Form>
      </section>
      <p className="auth-footer">No account? <Link to="/signup">Create one</Link></p>
    </main>
  );
}
