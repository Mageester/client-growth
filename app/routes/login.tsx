import { Form, Link, redirect } from "react-router";

import { getAuth } from "../lib/auth.server";
import { getSession } from "../lib/session.server";
import type { Route } from "./+types/login";

export function meta() {
  return [{ title: "Log in · Client Growth" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  if (await getSession(request, context)) throw redirect("/");
  return null;
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

export default function Login({ actionData }: Route.ComponentProps) {
  return (
    <main style={{ maxWidth: 380, margin: "6vh auto", padding: "0 1.25rem" }}>
      <h1>Log in</h1>
      {actionData?.error && <div className="notice err">{actionData.error}</div>}
      <Form method="post" className="stack">
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
        </div>
        <button type="submit" className="primary">
          Log in
        </button>
      </Form>
      <p className="muted" style={{ marginTop: "1rem" }}>
        No account? <Link to="/signup">Create one</Link>
      </p>
    </main>
  );
}
