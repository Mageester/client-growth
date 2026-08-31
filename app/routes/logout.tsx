import { redirect } from "react-router";

import { getAuth } from "../lib/auth.server";
import type { Route } from "./+types/logout";

export async function action({ request, context }: Route.ActionArgs) {
  const auth = getAuth(context.cloudflare.env as never);
  let cookie: string | null = null;
  try {
    const res = await auth.api.signOut({ headers: request.headers, asResponse: true });
    cookie = res.headers.get("set-cookie");
  } catch {
    /* fall through — always send the user to /login */
  }
  return redirect("/login", cookie ? { headers: { "set-cookie": cookie } } : undefined);
}

export function loader() {
  return redirect("/login");
}
