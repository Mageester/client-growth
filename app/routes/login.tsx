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
    <main className="auth">
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
      {actionData?.error && (
        <div className="notice err" role="alert" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}
      <Form method="post">
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
      <p className="auth-foot">
        No account?{" "}
        <Link className="link" to="/signup">
          Create one
        </Link>
      </p>
    </main>
  );
}
