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
    expect((await analysisHealth(scope,new Date(now.getTime()+1000))).failedStarts).toBe(1);
    expect((await analysisHealth(p.scopeFor('ws_b'),new Date(now.getTime()+1000))).failedStarts).toBe(0);
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
    await p.db.prepare(`UPDATE analysis_limit_reservations SET finished_at = '2026-09-04T10:01:00.000Z', failed = 1
      WHERE workspace_id = 'ws_a'`).run();
    const failed=await analysisHealth(p.scopeFor('ws_a'),now);
    expect(failed.incompleteStarts).toBe(0);
    expect(failed.failedStarts).toBe(1);
    expect((await analysisHealth(p.scopeFor('ws_b'),now)).failedStarts).toBe(0);
    expect((await analysisHealth(p.scopeFor('ws_b'),now)).alert).toBeNull();
  }finally{p.close();}
});

/**
 * A failure in the headline count has to have a row underneath it.
 *
 * Operations counted failed analysis starts from `analysis_limit_reservations`
 * and listed "checks to investigate" from `analysis_runs`. A run that failed
 * before it recorded anything therefore appeared as a number with nothing to
 * investigate — the operator is told something broke and given no way to find
 * out what. Two queries, two boundaries, one contradiction.
 *
 * Counts and rows now come from the same boundary. Where no safe stored reason
 * exists the row says so; it does not guess a cause, and it never surfaces a
 * raw provider exception or payload.
 */
it("gives every counted analysis failure a matching investigation row", async () => {
  const now = new Date("2026-09-08T12:00:00.000Z");
  const p = await buildPortfolio({ workspaces: 2, perWorkspace: 2, now });
  try {
    const scope = p.scopeFor("ws_a");
    const mine = p.clients.find((entry) => entry.workspaceId === "ws_a")!;
    const theirs = p.clients.find((entry) => entry.workspaceId === "ws_b")!;
    const failedAt = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

    // A start that was reserved, failed, and never became a run: the exact
    // shape the count reported and the list could not explain.
    for (const [workspaceId, clientId] of [
      ["ws_a", mine.clientId],
      ["ws_b", theirs.clientId],
    ] as const) {
      await p.db
        .prepare(
          `INSERT INTO analysis_limit_reservations
             (workspace_id, client_id, reserved_at, day_utc, finished_at, failed)
           VALUES (?, ?, ?, ?, ?, 1)`,
        )
        .bind(workspaceId, clientId, failedAt, failedAt.slice(0, 10), failedAt)
        .run();
    }

    const health = await analysisHealth(scope, now);

    expect(health.failedStarts).toBe(1);
    const failures = health.recentErrors.filter((row) => row.kind === "failed-start");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.clientName).toBe(`Client ${mine.clientId}`);
    expect(failures[0]?.at).toBe(failedAt);
    expect(failures[0]?.stage).toBeTruthy();
    // No cause is invented for a run that stopped before recording one.
    expect(failures[0]?.reason).toBe("The run stopped before a detailed record was created.");

    // The other agency's failure stays in the other agency.
    expect(health.recentErrors.some((row) => row.clientName.includes(theirs.clientId))).toBe(false);
  } finally {
    p.close();
  }
});

it("keeps a completed inconclusive run in the same list, with its stored summary", async () => {
  const now = new Date("2026-09-08T12:00:00.000Z");
  const p = await buildPortfolio({ workspaces: 1, perWorkspace: 1, now });
  try {
    const scope = p.scopeFor("ws_a");
    const client = p.clients.find((entry) => entry.workspaceId === "ws_a")!;
    const at = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
    await repo.recordAnalysisRun(scope, {
      clientId: client.clientId,
      startedAt: at,
      finishedAt: at,
      source: "http",
      outcome: "inconclusive",
      summary: "The site could not be read far enough to check anything.",
      limitation: "coverage",
      pagesRead: 0,
      pagesFetched: 1,
      blockedEvents: 1,
      inconclusiveEvents: 0,
      surfaced: 0,
      stats: {},
      trigger: "manual",
      newCount: 0,
      resolvedCount: 0,
      evaluatorCalls: 0,
      evaluatorRejections: 0,
      evaluatorErrors: 0,
    });

    const health = await analysisHealth(scope, now);
    const completed = health.recentErrors.find((row) => row.kind === "completed-run");

    expect(completed?.reason).toBe("The site could not be read far enough to check anything.");
    expect(completed?.at).toBe(at);
  } finally {
    p.close();
  }
});
