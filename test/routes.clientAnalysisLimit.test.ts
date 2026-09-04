import { afterEach, expect, it, vi } from "vitest";
import { buildPortfolio } from "./helpers/portfolio";
import { reserveAnalysisStart } from "@/db/analysisLimits";
import { __setSessionResolver } from "../app/lib/session.server";
import { action } from "../app/routes/clients.$id";

afterEach(()=>{ __setSessionResolver(null); vi.unstubAllGlobals(); });
it("shows a client cooldown as a normal notice without starting a crawl",async()=>{
  const p = await buildPortfolio({workspaces:1,perWorkspace:6,now:new Date()});
  try {
    const client = p.clients[0]!;
    __setSessionResolver(async()=>({userId:"u_ws_a",user:{id:"u_ws_a",email:"a@example.test",name:"A"}}));
    await reserveAnalysisStart(p.scopeFor("ws_a"),client.clientId);
    const fetch = vi.fn(()=>{throw new Error("Must not crawl");}); vi.stubGlobal("fetch",fetch);
    const response = await action({params:{id:client.clientId},request:new Request("http://localhost/clients/"+client.clientId,{method:"POST",body:new URLSearchParams({intent:"analyze"})}),context:{cloudflare:{env:{DB:p.d1,AI_PROVIDER:"mock"}}}} as never);
    expect(response).toMatchObject({ok:true,limited:true,message:expect.stringMatching(/recently/i)});
    expect(fetch).not.toHaveBeenCalled();
  } finally { p.close(); }
});
