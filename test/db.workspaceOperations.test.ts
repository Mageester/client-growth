import { expect, it } from "vitest";
import { buildPortfolio } from "./helpers/portfolio";
import { workspaceExport, analysisHealth } from "@/db/workspaceOperations";
import { createProposalShare, saveWorkspaceBranding } from "@/db/proposalShares";
import { OpportunitySchema } from "@/core/schema";
import * as repo from "@/db/repositories";
import { runAnalysis } from "../app/lib/analysis.server";

it("exports safe workspace metadata while excluding invitation and share secrets", async () => {
  const now = new Date("2026-09-04T12:00:00.000Z");
  const p = await buildPortfolio({ workspaces: 2, perWorkspace: 2, now });
  try {
    const scope = p.scopeFor("ws_a");
    const client = p.clients.find((entry) => entry.workspaceId === "ws_a")!;
    await repo.saveAnalysis(scope, [
      OpportunitySchema.parse({
        id: "opp_export_a",
        dedupeKey: "export-metadata-check",
        clientId: client.clientId,
        ruleId: "missing-service-page",
        title: "Export snapshot finding",
        detected: "The service page is missing.",
        evidenceRefs: ["https://site-a.example/services"],
        rationale: "A dedicated page gives visitors a clear next step.",
        suggestedServiceId: "svc_page_ws_a",
        suggestedScope: ["Write the service page"],
        priceMin: 900,
        priceMax: 1800,
        confidence: 0.88,
        billableStatus: "billable",
        status: "proposal_prepared",
        proposalMd: "# Export snapshot",
        updatedAt: now.toISOString(),
      }),
    ]);
    await saveWorkspaceBranding(scope, { logo: "data:image/png;base64,iVBORw0KGgo=" });
    await p.db
      .prepare(
        `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind("ws_a", "u_member_export", "member", now.toISOString())
      .run();
    await p.db
      .prepare(
        `INSERT INTO workspace_invitations
           (id, workspace_id, invited_email, role, token_hash, expires_at, invited_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "invite_export_a",
        "ws_a",
        "invite@example.test",
        "member",
        "invite-secret-hash",
        new Date(now.getTime() + 86_400_000).toISOString(),
        "u_ws_a",
        now.toISOString(),
      )
      .run();

    const created = await createProposalShare(scope, "opp_export_a", {
      createdByUserId: "u_ws_a",
      preparedBy: "Export Owner",
      now,
    });
    const data = await workspaceExport(scope, now);
    const serialized = JSON.stringify(data);

    expect(data.branding).toMatchObject({
      workspace_id: "ws_a",
      logo: "data:image/png;base64,iVBORw0KGgo=",
    });
    expect(data.members).toContainEqual(
      expect.objectContaining({
        workspace_id: "ws_a",
        user_id: "u_member_export",
        role: "member",
      }),
    );
    expect(data.proposalShares).toContainEqual(
      expect.objectContaining({
        id: created.shareId,
        status: "active",
        snapshot: expect.stringContaining("Export snapshot"),
      }),
    );
    expect(serialized).not.toContain(created.token);
    expect(serialized).not.toContain("token_hash");
    expect(serialized).not.toContain("workspace_invitations");
    expect(serialized).not.toContain("invite-secret-hash");
    expect(serialized).not.toContain("ws_b");
  } finally {
    p.close();
  }
});

it("exports tenant application records without auth secrets or another workspace",async()=>{
  const p=await buildPortfolio({workspaces:2,perWorkspace:6,now:new Date()});
  try {
    const data=await workspaceExport(p.scopeFor("ws_a"));
    expect(data.clients).toHaveLength(6);
    expect(data.workspace).toMatchObject({id:"ws_a"});
    expect(JSON.stringify(data)).not.toContain('ws_b');
    for(const key of ['user','session','account','verification','rateLimit']) expect(data).not.toHaveProperty(key);
  }finally{p.close();}
});

it("records thrown analysis failures without storing provider secrets or losing daily accounting",async()=>{
  const now=new Date('2026-09-04T12:00:00.000Z');
  const p=await buildPortfolio({workspaces:2,perWorkspace:6,now});
  try {
    const scope=p.scopeFor('ws_a');
    const client=p.clients.find(c=>c.workspaceId==='ws_a')!;
    await expect(runAnalysis(scope,{AI_PROVIDER:'not-a-provider'},client.clientId,{now})).rejects.toThrow();
    const row=await p.db.prepare('SELECT * FROM analysis_limit_reservations WHERE workspace_id = ?').bind('ws_a').first<Record<string,unknown>>();
    expect(row?.failed).toBe(1);
    expect(row?.finished_at).toBeTruthy();
    expect(row).not.toHaveProperty('error');
    await p.db.prepare(`UPDATE analysis_limit_reservations
      SET reserved_at = ?, finished_at = ?, day_utc = ?
      WHERE workspace_id = ?`).bind(
        '2026-09-04T11:40:00.000Z',
        '2026-09-04T11:41:00.000Z',
        '2026-09-04',
        'ws_a',
      ).run();
    await p.db.prepare(`INSERT INTO analysis_limit_reservations
      (workspace_id, client_id, reserved_at, day_utc, finished_at, failed)
      VALUES (?, ?, ?, ?, ?, 1)`).bind(
        'ws_a',
        client.clientId,
        '2026-09-04T11:55:00.000Z',
        '2026-09-04',
        '2026-09-04T11:56:00.000Z',
      ).run();
    const health=await analysisHealth(scope,now);
    expect(health.failedStarts).toBe(1);
    expect(health.investigations).toContainEqual({
      kind:'failed-start',
      clientName:`Client ${client.clientId}`,
      stage:'Analysis start',
      at:'2026-09-04T11:41:00.000Z',
      reason:'The run stopped before a detailed record was created.',
    });
    expect(health.investigations).toHaveLength(1);
    const otherWorkspace=await analysisHealth(p.scopeFor('ws_b'),now);
    expect(otherWorkspace.failedStarts).toBe(0);
    expect(otherWorkspace.investigations).toEqual([]);
  }finally{p.close();}
});

it("correlates a timestamp-skewed scheduled failure without merging nearby unrelated runs",async()=>{
  const now=new Date('2026-09-04T12:00:00.000Z');
  const p=await buildPortfolio({workspaces:2,perWorkspace:2,now});
  try {
    const scope=p.scopeFor('ws_a');
    const client=p.clients.find(c=>c.workspaceId==='ws_a')!;
    await p.db.prepare(`INSERT INTO analysis_limit_reservations
      (workspace_id, client_id, reserved_at, day_utc, finished_at, failed)
      VALUES (?, ?, ?, ?, ?, 1)`).bind(
        'ws_a',
        client.clientId,
        '2026-09-04T11:40:01.000Z',
        '2026-09-04',
        '2026-09-04T11:41:00.000Z',
      ).run();

    const recordFailure = (input:{startedAt:string;finishedAt:string;summary:string;trigger:'manual'|'scheduled'}) =>
      repo.recordAnalysisRun(scope,{
        clientId:client.clientId,
        startedAt:input.startedAt,
        finishedAt:input.finishedAt,
        source:'http',
        outcome:'inconclusive',
        summary:input.summary,
        limitation:null,
        pagesRead:0,
        pagesFetched:0,
        blockedEvents:0,
        inconclusiveEvents:0,
        surfaced:0,
        stats:{failed:1},
        trigger:input.trigger,
        newCount:0,
        resolvedCount:0,
        evaluatorCalls:0,
        evaluatorRejections:0,
        evaluatorErrors:0,
      });
    await recordFailure({
      startedAt:'2026-09-04T11:40:00.000Z',
      finishedAt:'2026-09-04T11:41:01.000Z',
      summary:'This scheduled check could not be completed, so nothing was assessed.',
      trigger:'scheduled',
    });
    await recordFailure({
      startedAt:'2026-09-04T11:40:00.500Z',
      finishedAt:'2026-09-04T11:40:30.000Z',
      summary:'Nearby manual failure.',
      trigger:'manual',
    });
    await recordFailure({
      startedAt:'2026-09-04T11:34:59.000Z',
      finishedAt:'2026-09-04T11:35:30.000Z',
      summary:'Earlier scheduled failure outside the correlation window.',
      trigger:'scheduled',
    });

    const health=await analysisHealth(scope,now);
    expect(health.failedStarts).toBe(1);
    expect(health.investigations).toHaveLength(3);
    expect(health.investigations).toContainEqual({
      kind:'failed-start',
      clientName:`Client ${client.clientId}`,
      stage:'Analysis start',
      at:'2026-09-04T11:41:01.000Z',
      reason:'This scheduled check could not be completed, so nothing was assessed.',
    });
    expect(health.investigations).toContainEqual(expect.objectContaining({
      kind:'completed-run',
      reason:'Nearby manual failure.',
    }));
    expect(health.investigations).toContainEqual(expect.objectContaining({
      kind:'completed-run',
      reason:'Earlier scheduled failure outside the correlation window.',
    }));
    expect(health.investigations.filter(row=>row.reason.startsWith('This scheduled check'))).toHaveLength(1);
  }finally{p.close();}
});

it("alerts on an elevated inconclusive rate and exposes incomplete starts without calling them clean",async()=>{
  const now=new Date('2026-09-04T12:00:00.000Z');
  const p=await buildPortfolio({workspaces:2,perWorkspace:6,now});
  try {
    const client=p.clients.find(c=>c.workspaceId==='ws_a')!;
    for(let i=0;i<6;i++) await p.db.prepare(`INSERT INTO analysis_runs
      (workspace_id,client_id,started_at,finished_at,source,outcome,summary,pages_read,pages_fetched,blocked_events,inconclusive_events,surfaced,stats,evaluator_errors)
      VALUES ('ws_a',?,'2026-09-03T10:00:00.000Z','2026-09-03T10:01:00.000Z','http',?,'Measured result',1,1,0,0,0,'{}',?)`)
      .bind(client.clientId,i<5?'inconclusive':'clean',i===0?1:0).run();
    await p.db.prepare(`INSERT INTO analysis_limit_reservations (workspace_id,client_id,reserved_at,day_utc)
      VALUES ('ws_a',?,'2026-09-04T10:00:00.000Z','2026-09-04')`).bind(client.clientId).run();
    const health=await analysisHealth(p.scopeFor('ws_a'),now);
    expect(health.current).toMatchObject({checks:6,clean:1,findings:0,inconclusive:5,evaluatorErrors:1});
    expect(health.alert).toMatch(/could not fully assess/i);
    expect(health.incompleteStarts).toBe(1);
    expect(health.investigations).toHaveLength(5);
    expect(health.investigations).toContainEqual({
      kind:'completed-run',
      clientName:`Client ${client.clientId}`,
      stage:'Evaluation',
      at:'2026-09-03T10:01:00.000Z',
      reason:'Measured result',
    });
    await p.db.prepare(`UPDATE analysis_limit_reservations SET finished_at = '2026-09-04T10:01:00.000Z', failed = 1
      WHERE workspace_id = 'ws_a'`).run();
    const failed=await analysisHealth(p.scopeFor('ws_a'),now);
    expect(failed.incompleteStarts).toBe(0);
    expect(failed.failedStarts).toBe(1);
    expect((await analysisHealth(p.scopeFor('ws_b'),now)).failedStarts).toBe(0);
    expect((await analysisHealth(p.scopeFor('ws_b'),now)).alert).toBeNull();
  }finally{p.close();}
});
