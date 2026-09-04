import { describe, expect, it } from "vitest";
import { nodeSqliteDb } from "@/db/nodeSqlite";
import { SCHEMA_SQL } from "@/db/schema";
import { portfolioChanges } from "@/db/portfolioChanges";

describe("weekly portfolio changes", () => {
  it("keeps recent inconclusive checks visible, excludes old/future/other-tenant runs, and sums durable changes", async () => {
    const db = nodeSqliteDb();
    try {
      await db.exec(SCHEMA_SQL);
      await db.exec(`INSERT INTO workspaces VALUES ('a','Agency','ua','2026-01-01'),('b','Other','ub','2026-01-01');
        INSERT INTO clients (id,workspace_id,name,domain,updated_at) VALUES ('ca','a','Alpha','alpha.example','2026-01-01'),('cb','b','Beta','beta.example','2026-01-01');`);
      for (const [ws,client,date,outcome,added,fixed] of [
        ['a','ca','2026-09-03T12:00:00.000Z','findings',2,1],
        ['a','ca','2026-09-04T11:00:00.000Z','inconclusive',0,0],
        ['a','ca','2026-08-01T00:00:00.000Z','findings',9,9],
        ['a','ca','2026-09-05T00:00:00.000Z','findings',9,9],
        ['b','cb','2026-09-03T00:00:00.000Z','findings',9,9],
      ] as const) await db.prepare(`INSERT INTO analysis_runs
        (workspace_id,client_id,started_at,finished_at,source,outcome,summary,pages_read,pages_fetched,blocked_events,inconclusive_events,surfaced,stats,new_count,resolved_count)
        VALUES (?,?,?,?, 'http',?, 'Measured result',1,1,0,0,0,'{}',?,?)`).bind(ws,client,date,date,outcome,added,fixed).run();
      const result = await portfolioChanges({db,workspaceId:'a'},new Date('2026-09-04T12:00:00.000Z'));
      expect(result.summary).toMatchObject({checks:2,newFindings:2,resolvedFindings:1,inconclusive:1,clientsChecked:1});
      expect(result.runs).toHaveLength(2);
      expect(result.runs[0]).toMatchObject({outcome:'inconclusive',clientName:'Alpha'});
      expect(JSON.stringify(result)).not.toContain('Beta');
    } finally { db.close(); }
  });
});
