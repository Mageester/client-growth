import { Form, Link, redirect } from "react-router";

import { createWorkspaceForOwner, newWorkspaceId } from "@/db/workspaces";
import { getAuth } from "../lib/auth.server";
import { getSession } from "../lib/session.server";
import { d1Db } from "../lib/d1.server";
import { AxiomCredit, Icon } from "../components/ui";
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

  if (!email || !password || !workspaceName) return { error: "Fill in every field." };
  if (password.length < 8) return { error: "Use a password of at least 8 characters." };

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
    <main className="auth">
      <span className="auth-eyebrow">Client Growth</span>
      <h1>Start with your portfolio</h1>
      <p className="auth-sub">
        Create a workspace for the client sites you already look after.
      </p>
      {actionData?.error && (
        <div className="notice err" role="alert" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}
      <Form method="post">
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
        <Link className="link" to="/login">
          Log in
        </Link>
      </p>
      <div className="auth-credit">
        <AxiomCredit />
      </div>
    </main>
  );
}
