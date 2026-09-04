import { workspaceExport } from "@/db/workspaceOperations";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/export.workspace";

export async function loader({request,context}:Route.LoaderArgs) {
  const t=await requireTenant(request,context);
  const data=await workspaceExport(t.scope);
  return new Response(JSON.stringify(data,null,2),{headers:{
    "Content-Type":"application/json; charset=utf-8",
    "Content-Disposition":'attachment; filename="axiom-orbit-workspace.json"',
    "Cache-Control":"private, no-store",
    "X-Content-Type-Options":"nosniff",
  }});
}
