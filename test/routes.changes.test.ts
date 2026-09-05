import { afterEach, expect, it } from "vitest";
import { buildPortfolio } from "./helpers/portfolio";
import { __setSessionResolver } from "../app/lib/session.server";
import { loader as index } from "../app/routes/_index";
import { loader as changes } from "../app/routes/changes";

afterEach(()=>__setSessionResolver(null));
it("returns an empty weekly view for the current tenant and lands returning users there",async()=>{
  const p=await buildPortfolio({workspaces:2,perWorkspace:6,now:new Date()});
  try {
    __setSessionResolver(async()=>({userId:"u_ws_a",user:{id:"u_ws_a",email:"a@example.test",name:"A"}}));
    const args={request:new Request("http://localhost/"),context:{cloudflare:{env:{DB:p.d1}}}} as never;
    // `/` renders the public showcase for a visitor and throws a redirect for
    // a signed-in agency, so the landing target is asserted from the throw.
    const landing = await index(args).then(()=>null,(thrown:unknown)=>thrown);
    expect(landing).toBeInstanceOf(Response);
    expect((landing as Response).headers.get("location")).toBe("/changes");
    expect((await changes(args)).summary.checks).toBe(0);
  } finally {p.close();}
});
