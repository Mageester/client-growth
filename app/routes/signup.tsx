import { Form, Link, redirect } from "react-router";

import { createWorkspaceForOwner, newWorkspaceId } from "@/db/workspaces";
import { getAuth } from "../lib/auth.server";
import { d1Db } from "../lib/d1.server";
import { getSession } from "../lib/session.server";
import type { Route } from "./+types/signup";

export function meta() {
  return [{ title: "Create account · Client Growth" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  if (await getSession(request, context)) throw redirect("/");
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const workspaceName = String(form.get("workspaceName") ?? "").trim();

  if (!email || !password || !workspaceName) {
    return { error: "Fill in every field." };
  }
  if (password.length < 8) {
    return { error: "Use a password of at least 8 characters." };
  }

  const auth = getAuth(context.cloudflare.env as never);
  let cookie: string | null = null;
  let userId: string;
  try {
    const res = await auth.api.signUpEmail({
      body: { email, password, name: workspaceName },
      asResponse: true,
    });
    cookie = res.headers.get("set-cookie");
    if (!res.ok || !cookie) {
      return { error: "That email is already in use, or the details were rejected." };
    }
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    if (!session?.user) return { error: "Sign-up failed. Please try again." };
    userId = session.user.id;
  } catch {
    return { error: "That email is already in use, or the details were rejected." };
  }

  // Workspace creation is a separate step. If it fails here, the account still
  // exists and the next authed visit lands on /onboarding to finish (idempotent).
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

export default function Signup({ actionData }: Route.ComponentProps) {
  return (
    <main style={{ maxWidth: 400, margin: "6vh auto", padding: "0 1.25rem" }}>
      <h1>Create your account</h1>
      <p className="muted">One account, one agency workspace.</p>
      {actionData?.error && <div className="notice err">{actionData.error}</div>}
      <Form method="post" className="stack">
        <div className="field">
          <label htmlFor="workspaceName">Agency / workspace name</label>
          <input id="workspaceName" name="workspaceName" type="text" required />
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
        </div>
        <button type="submit" className="primary">
          Create account
        </button>
      </Form>
      <p className="muted" style={{ marginTop: "1rem" }}>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
