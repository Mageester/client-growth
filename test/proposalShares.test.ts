import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PROPOSAL_SHARE_TTL_MS,
  createProposalShare,
  getProposalShareByToken,
  getWorkspaceBranding,
  revokeProposalShares,
  saveWorkspaceBranding,
  validateLogo,
} from "@/db/proposalShares";
import * as repo from "@/db/repositories";
import { SCHEMA_SQL } from "@/db/schema";
import { ClientSchema, OpportunitySchema, ServiceSchema, type Opportunity } from "@/core/schema";
import type { TenantScope } from "@/db/tenant";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { __setSessionResolver } from "../app/lib/session.server";
import * as opportunityDetail from "../app/routes/opportunities.$id";
import * as publicShare from "../app/routes/proposal.share";
import * as settings from "../app/routes/settings";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const NOW = new Date("2026-09-04T12:00:00.000Z");

let raw: Database.Database;
let scopeA: TenantScope;
let scopeB: TenantScope;
let ctx: { cloudflare: { env: Record<string, unknown> } };

function sqlDbOver(db: Database.Database) {
  const stmt = (sql: string, bound: unknown[]) => ({
    bind: (...values: unknown[]) => stmt(sql, values),
    all: async () => db.prepare(sql).all(...(bound as never[])),
    first: async () => db.prepare(sql).get(...(bound as never[])) ?? null,
    run: async () => ({ rowsAffected: db.prepare(sql).run(...(bound as never[])).changes }),
  });
  return {
    prepare: (sql: string) => stmt(sql, []),
    exec: async (sql: string) => void db.exec(sql),
  };
}

function formReq(fields: Record<string, string>) {
  return new Request("http://localhost/opportunities/opp_a", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

async function call(fn: (args: unknown) => unknown, args: unknown): Promise<unknown> {
  try {
    return await fn(args);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

function opportunity(over: Partial<Opportunity> = {}): Opportunity {
  return OpportunitySchema.parse({
    id: "opp_a",
    dedupeKey: "missing-service-page:heat pumps",
    clientId: "client_a",
    ruleId: "missing-service-page",
    title: "No page for heat pumps",
    detected: "The site names heat pumps but has no dedicated page.",
    evidenceRefs: ["https://client-a.example/services"],
    rationale: "A dedicated page gives prospective clients a clear next step.",
    suggestedServiceId: "service_a",
    suggestedScope: ["Plan the page", "Write the service copy"],
    priceMin: 900,
    priceMax: 1800,
    confidence: 0.88,
    billableStatus: "billable",
    status: "proposal_prepared",
    proposalMd: "# Heat pump page\n\nWe can help.",
    updatedAt: NOW.toISOString(),
    ...over,
  });
}

async function createFixture() {
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  raw.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  raw.exec(SCHEMA_SQL);

  const db = sqlDbOver(raw) as never;
  await createWorkspaceForOwner(db, { id: "ws_a", name: "Axiom North", ownerUserId: "u_a" });
  await createWorkspaceForOwner(db, { id: "ws_b", name: "Other Agency", ownerUserId: "u_b" });
  scopeA = { db, workspaceId: "ws_a" };
  scopeB = { db, workspaceId: "ws_b" };
  await repo.upsertService(
    scopeA,
    ServiceSchema.parse({
      id: "service_a",
      name: "Service landing page",
      description: "",
      priceMin: 900,
      priceMax: 1800,
      tags: ["landing-page"],
      active: true,
    }),
  );
  await repo.upsertClient(
    scopeA,
    ClientSchema.parse({
      id: "client_a",
      name: "Northwind Heating",
      domain: "client-a.example",
      offerings: ["heat pumps"],
      notes: "",
    }),
  );
  await repo.saveAnalysis(scopeA, [opportunity()]);

  await repo.upsertService(
    scopeB,
    ServiceSchema.parse({
      id: "service_b",
      name: "Other service",
      description: "",
      priceMin: 100,
      priceMax: 200,
      tags: ["landing-page"],
      active: true,
    }),
  );
  await repo.upsertClient(
    scopeB,
    ClientSchema.parse({
      id: "client_b",
      name: "Other Client",
      domain: "client-b.example",
      offerings: ["other"],
      notes: "",
    }),
  );
  await repo.saveAnalysis(
    scopeB,
    [
      opportunity({
        id: "opp_b",
        dedupeKey: "missing-service-page:other",
        clientId: "client_b",
        suggestedServiceId: "service_b",
        title: "Other finding",
        proposalMd: "# Other draft",
      }),
    ],
  );

  ctx = {
    cloudflare: {
      env: {
        DB: {
          prepare: (sql: string) => {
            const stmt = (bound: unknown[]) => ({
              bind: (...values: unknown[]) => stmt(values),
              all: async () => ({ results: raw.prepare(sql).all(...(bound as never[])) }),
              first: async () => raw.prepare(sql).get(...(bound as never[])) ?? null,
              run: async () => ({ meta: { changes: raw.prepare(sql).run(...(bound as never[])).changes } }),
            });
            return stmt([]);
          },
          exec: async (sql: string) => void raw.exec(sql),
        },
        BETTER_AUTH_URL: "http://localhost",
      },
    },
  };
}

beforeEach(async () => {
  await createFixture();
  __setSessionResolver(async () => ({
    userId: "u_a",
    user: { id: "u_a", email: "owner@axiom.test", name: "Avery Owner" },
  }));
});

afterEach(() => {
  __setSessionResolver(null);
  vi.unstubAllGlobals();
  raw.close();
});

describe("proposal share persistence", () => {
  it("stores only a SHA-256 token hash and snapshots the saved draft", async () => {
    const created = await createProposalShare(scopeA, "opp_a", {
      createdByUserId: "u_a",
      preparedBy: "Avery Owner",
      now: NOW,
    });

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.expiresAt).toBe(new Date(NOW.getTime() + PROPOSAL_SHARE_TTL_MS).toISOString());
    const stored = raw
      .prepare("SELECT token_hash, snapshot FROM proposal_shares WHERE id = ?")
      .get(created.shareId) as { token_hash: string; snapshot: string };
    expect(stored.token_hash).not.toContain(created.token);
    expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.snapshot).toContain("Heat pump page");
    expect(stored.snapshot).toContain("Avery Owner");
  });

  it("keeps the snapshot immutable when the opportunity and branding change", async () => {
    await saveWorkspaceBranding(scopeA, { logo: "data:image/png;base64,iVBORw0KGgo=" });
    const created = await createProposalShare(scopeA, "opp_a", {
      createdByUserId: "u_a",
      preparedBy: "Avery Owner",
      now: NOW,
    });
    await repo.saveOpportunityProposalText(scopeA, "opp_a", "# Changed after sharing");
    await saveWorkspaceBranding(scopeA, { logo: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/" });

    const shared = await getProposalShareByToken(scopeA.db, created.token, NOW);
    expect(shared?.snapshot.proposalMd).toBe("# Heat pump page\n\nWe can help.");
    expect(shared?.snapshot.agencyName).toBe("Axiom North");
    expect(shared?.snapshot.logo).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("expires at the exact expiry and can be revoked for the opportunity", async () => {
    const created = await createProposalShare(scopeA, "opp_a", {
      createdByUserId: "u_a",
      preparedBy: "Avery Owner",
      now: NOW,
    });
    expect(await getProposalShareByToken(scopeA.db, created.token, NOW)).not.toBeNull();
    expect(
      await getProposalShareByToken(
        scopeA.db,
        created.token,
        new Date(NOW.getTime() + PROPOSAL_SHARE_TTL_MS),
      ),
    ).toBeNull();

    const second = await createProposalShare(scopeA, "opp_a", {
      createdByUserId: "u_a",
      preparedBy: "Avery Owner",
      now: new Date(NOW.getTime() + 1),
    });
    expect(await revokeProposalShares(scopeA, "opp_a", { actingUserId: "u_a", now: NOW })).toBe(2);
    expect(await getProposalShareByToken(scopeA.db, second.token, NOW)).toBeNull();
  });

  it("scopes owner mutations to the current tenant", async () => {
    await expect(
      createProposalShare(scopeB, "opp_a", {
        createdByUserId: "u_b",
        preparedBy: "Other Owner",
        now: NOW,
      }),
    ).rejects.toThrow(/not found/i);
    expect(await revokeProposalShares(scopeB, "opp_a", { actingUserId: "u_b", now: NOW })).toBe(0);
  });

  it("requires a saved proposal draft and the prepared status", async () => {
    await repo.saveAnalysis(scopeA, [opportunity({ status: "new", proposalMd: undefined })]);
    await expect(
      createProposalShare(scopeA, "opp_a", {
        createdByUserId: "u_a",
        preparedBy: "Avery Owner",
        now: NOW,
      }),
    ).rejects.toThrow(/saved proposal/i);
  });

  it("validates bounded PNG/JPEG branding without fetching public URLs", async () => {
    expect(validateLogo("data:image/png;base64,iVBORw0KGgo=")).toEqual({
      ok: true,
      value: "data:image/png;base64,iVBORw0KGgo=",
    });
    expect(validateLogo("https://cdn.example/logo.jpg")).toEqual({
      ok: true,
      value: "https://cdn.example/logo.jpg",
    });
    expect(validateLogo("data:image/svg+xml;base64,PHN2Zy8+")).toMatchObject({ ok: false });
    expect(validateLogo("https://127.0.0.1/logo.png")).toMatchObject({ ok: false });
    expect(validateLogo("data:image/png;base64," + "A".repeat(600_000))).toMatchObject({ ok: false });
  });
});

describe("proposal share routes", () => {
  it("saves the agency logo explicitly from workspace settings", async () => {
    const result = await call(settings.action as never, {
      request: new Request("http://localhost/settings", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          workspaceName: "Axiom North Updated",
          logo: "data:image/png;base64,iVBORw0KGgo=",
        }),
      }),
      context: ctx,
    });
    expect(result).toEqual({ ok: true });
    expect(await getWorkspaceBranding(scopeA)).toMatchObject({
      logo: "data:image/png;base64,iVBORw0KGgo=",
    });
  });

  it("creates one link through an explicit owner POST and returns no token on reload", async () => {
    const result = (await call(opportunityDetail.action as never, {
      request: formReq({ intent: "create-share" }),
      params: { id: "opp_a" },
      context: ctx,
    })) as { ok?: boolean; shareUrl?: string; expiresAt?: string };
    expect(result.ok).toBe(true);
    expect(result.shareUrl).toMatch(/^http:\/\/localhost\/proposal\/share\?token=/);

    const token = new URL(result.shareUrl!).searchParams.get("token")!;
    const page = await publicShare.loader({
      request: new Request(result.shareUrl!),
      context: ctx,
    } as never);
    expect(page.snapshot.proposalMd).toContain("Heat pump page");
    expect(page.snapshot.agencyName).toBe("Axiom North");
    expect(publicShare.headers({} as never)["Cache-Control"]).toMatch(/no-store/i);
    expect(publicShare.headers({} as never)["Referrer-Policy"]).toBe("no-referrer");
    const stored = raw.prepare("SELECT token_hash FROM proposal_shares").get() as { token_hash: string };
    expect(token).not.toBe(stored.token_hash);
  });

  it("renders proposal text as escaped React text and revokes every active link", async () => {
    await repo.saveOpportunityProposalText(scopeA, "opp_a", "<script>alert(1)</script>");
    const created = await createProposalShare(scopeA, "opp_a", {
      createdByUserId: "u_a",
      preparedBy: "Avery Owner",
      now: NOW,
    });
    const page = await publicShare.loader({
      request: new Request(`http://localhost/proposal/share?token=${created.token}`),
      context: ctx,
    } as never);
    const html = renderToStaticMarkup(publicShare.default({ loaderData: page } as never));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");

    const result = (await call(opportunityDetail.action as never, {
      request: formReq({ intent: "revoke-shares" }),
      params: { id: "opp_a" },
      context: ctx,
    })) as { ok?: boolean; revoked?: number };
    expect(result).toMatchObject({ ok: true, revoked: 1 });
  });

  it("refuses to create a link for a finding without a saved prepared draft", async () => {
    await repo.saveAnalysis(scopeA, [opportunity({ status: "new", proposalMd: undefined })]);
    const result = (await call(opportunityDetail.action as never, {
      request: formReq({ intent: "create-share" }),
      params: { id: "opp_a" },
      context: ctx,
    })) as { error?: string };
    expect(result.error).toMatch(/saved proposal|prepare/i);
    const count = raw.prepare("SELECT COUNT(*) AS count FROM proposal_shares").get() as { count: number };
    expect(count.count).toBe(0);
  });
});
