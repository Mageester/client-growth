import { getAuth } from "../lib/auth.server";
import type { Route } from "./+types/api.auth.$";

/**
 * Better Auth mounts here: /api/auth/sign-up/email, /sign-in/email, /sign-out,
 * /get-session, ... Both verbs delegate to its handler.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  return getAuth(context.cloudflare.env as never).handler(request);
}

export async function action({ request, context }: Route.ActionArgs) {
  return getAuth(context.cloudflare.env as never).handler(request);
}
