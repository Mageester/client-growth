import { redirect } from "react-router";

import { getWorkspaceForUser } from "@/db/workspaces";
import { d1Db } from "../lib/d1.server";
import { getSession } from "../lib/session.server";
import type { Route } from "./+types/_index";

export async function loader({ request, context }: Route.LoaderArgs) {
  const authed = await getSession(request, context);
  if (!authed) return redirect("/login");
  const ws = await getWorkspaceForUser(d1Db(context.cloudflare.env.DB as never), authed.userId);
  return redirect(ws ? "/changes" : "/onboarding");
}

export default function Index() {
  return null;
}
