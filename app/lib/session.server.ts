import { redirect } from "react-router";

import { requestReturnTo } from "./return-to";

import type { SqlDb } from "@/db/sql";
import type { TenantScope } from "@/db/tenant";
import { getWorkspaceForUser, type Workspace } from "@/db/workspaces";
import { d1Db } from "./d1.server";
import { getAuth, type AuthEnv } from "./auth.server";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified?: boolean;
}
export interface AuthedContext {
  userId: string;
  user: SessionUser;
}
export interface TenantContext extends AuthedContext {
  db: SqlDb;
  workspace: Workspace;
  scope: TenantScope;
}

type ContextLike = { cloudflare: { env: AuthEnv } };

/** Resolve the signed-in user from the request, or null. Swappable in tests. */
type Resolver = (request: Request, env: AuthEnv) => Promise<AuthedContext | null>;

async function defaultResolver(request: Request, env: AuthEnv): Promise<AuthedContext | null> {
  const session = await getAuth(env).api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  return {
    userId: session.user.id,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? "",
      emailVerified: session.user.emailVerified,
    },
  };
}

let resolver: Resolver = defaultResolver;

/** Test hook: replace (or reset with null) the session resolver. */
export function __setSessionResolver(next: Resolver | null): void {
  resolver = next ?? defaultResolver;
}

export async function getSession(
  request: Request,
  context: ContextLike,
): Promise<AuthedContext | null> {
  return resolver(request, context.cloudflare.env);
}

/**
 * Signed-in user, or a redirect to /login that remembers where they were going.
 *
 * The destination matters. The audit opened a private report deep link while
 * signed out, was sent to a bare `/login`, signed in, and landed on Home — with
 * the report reachable again only by finding it. Carrying the path here is what
 * makes signing back in resume the work instead of restarting it.
 *
 * Login remains the final sanitizer before it navigates anywhere: this encodes
 * a path this server itself produced, and `safeReturnTo` re-checks whatever
 * comes back through the query string.
 */
export async function requireSession(
  request: Request,
  context: ContextLike,
): Promise<AuthedContext> {
  const authed = await resolver(request, context.cloudflare.env);
  if (!authed) {
    throw redirect(`/login?returnTo=${encodeURIComponent(requestReturnTo(request))}`);
  }
  return authed;
}

/**
 * Signed-in user WITH a workspace, plus a workspace-scoped DB handle. No
 * workspace yet -> redirect to /onboarding. Every protected loader/action must
 * call this and use `scope` for all repo access.
 */
export async function requireTenant(
  request: Request,
  context: ContextLike,
): Promise<TenantContext> {
  const authed = await requireSession(request, context);
  const env = context.cloudflare.env;
  const db = d1Db(env.DB as never);
  const workspace = await getWorkspaceForUser(db, authed.userId);
  if (!workspace) throw redirect("/onboarding");
  return { ...authed, db, workspace, scope: { db, workspaceId: workspace.id } };
}
