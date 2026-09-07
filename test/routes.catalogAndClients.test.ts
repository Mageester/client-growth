import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as repo from "@/db/repositories";
import { createWorkspaceForOwner } from "@/db/workspaces";
import { SCHEMA_SQL } from "@/db/schema";
import { ClientSchema, EvidenceBundleSchema, OpportunitySchema, ServiceSchema } from "@/core/schema";
import { suggestServiceTags } from "@/core/serviceTagSuggestions";
import { __setSessionResolver } from "../app/lib/session.server";
import { d1LikeOver } from "./helpers/testAuth";

import * as servicesIndex from "../app/routes/services._index";
import * as clientsIndex from "../app/routes/clients._index";
import * as clientDetail from "../app/routes/clients.$id";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let raw: Database.Database;
let scope: { db: never; workspaceId: string };
let ctx: { cloudflare: { env: Record<string, unknown> } };

function sqlDbOver(db: Database.Database) {
  const stmt = (sql: string, bound: unknown[]) => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    all: async () => db.prepare(sql).all(...(bound as never[])),
    first: async () => db.prepare(sql).get(...(bound as never[])) ?? null,
    run: async () => ({ rowsAffected: db.prepare(sql).run(...(bound as never[])).changes }),
  });
  return { prepare: (sql: string) => stmt(sql, []), exec: async (s: string) => void db.exec(s) };
}

function formReq(fields: Record<string, string | string[]>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
  }
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

async function call(fn: (a: unknown) => unknown, args: unknown): Promise<unknown> {
  try {
    return await fn(args);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

beforeEach(async () => {
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  raw.exec(readFileSync(join(migrationsDir, "0004_better_auth.sql"), "utf8"));
  raw.exec(SCHEMA_SQL);
  const db = sqlDbOver(raw) as never;
  await createWorkspaceForOwner(db, { id: "ws_a", name: "A", ownerUserId: "u_a" });
  scope = { db, workspaceId: "ws_a" };
  __setSessionResolver(async () => ({
    userId: "u_a",
    user: { id: "u_a", email: "a@x.example", name: "A" },
  }));
  ctx = {
    cloudflare: {
      env: {
        DB: d1LikeOver(raw),
        BETTER_AUTH_SECRET: "x".repeat(40),
        BETTER_AUTH_URL: "http://localhost:8787",
        AI_PROVIDER: "mock",
      },
    },
  };
});

afterEach(() => {
  __setSessionResolver(null);
  raw.close();
});

const saveService = (fields: Record<string, string | string[]>) =>
  call(servicesIndex.action as never, {
    request: formReq({ intent: "save", ...fields }),
    context: ctx,
  });

describe("service catalog", () => {
  it("creates a service connected to the kind of gap it answers", async () => {
    const res = (await saveService({
      name: "Service Landing Page",
      priceMin: "900",
      priceMax: "1800",
      description: "A page for one service line.",
      matches: ["landing-page"],
    })) as { ok: boolean };
    expect(res.ok).toBe(true);

    const [service] = await repo.listServices(scope);
    expect(service!.name).toBe("Service Landing Page");
    expect(service!.tags).toEqual(["landing-page"]);
    expect(service!.active).toBe(true);
  });

  it("applies deterministic text mapping for new services while keeping edits explicit", async () => {
    const proposal = suggestServiceTags({
      name: "Page title repair",
      description: "Fix missing HTML title tags.",
    });
    expect(proposal.map((suggestion) => suggestion.tag)).toEqual(["missing-title"]);

    await saveService({
      name: "Page title repair",
      priceMin: "150",
      priceMax: "400",
      description: "Fix missing HTML title tags.",
    });
    const [service] = await repo.listServices(scope);
    expect(service!.tags).toEqual(["missing-title"]);

    await saveService({
      id: service!.id,
      name: service!.name,
      priceMin: "150",
      priceMax: "400",
      description: service!.description,
      matches: ["missing-title"],
    });
    expect((await repo.getService(scope, service!.id))!.tags).toEqual(["missing-title"]);
  });

  it("maps a plain-language service phrase conservatively and leaves broad copy unmapped", () => {
    expect(
      suggestServiceTags({
        name: "Website service page design",
        description: "Design and build a focused page for each service line.",
      }).map((suggestion) => suggestion.tag),
    ).toEqual(["service-pages-build"]);
    expect(
      suggestServiceTags({
        name: "Website design and marketing",
        description: "A broad package for growing an online presence.",
      }),
    ).toEqual([]);
  });

  it("rejects an invalid price range without writing anything", async () => {
    const res = (await saveService({
      name: "Bad",
      priceMin: "2000",
      priceMax: "500",
      matches: ["landing-page"],
    })) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/top of the range/i);
    expect(await repo.listServices(scope)).toHaveLength(0);
  });

  it("rejects a nameless service", async () => {
    const res = (await saveService({ name: "  ", priceMin: "1", priceMax: "2" })) as {
      ok: boolean;
      error?: string;
    };
    expect(res.ok).toBe(false);
    expect(await repo.listServices(scope)).toHaveLength(0);
  });

  it("allows a service matched to nothing, and the page warns about it", async () => {
    await saveService({ name: "Care Plan", priceMin: "250", priceMax: "700" });
    const [service] = await repo.listServices(scope);
    expect(service!.tags).toEqual([]);

    const data = (await servicesIndex.loader({
      request: new Request("http://localhost/services"),
      context: ctx,
    } as never)) as { services: unknown[] };
    expect(data.services).toHaveLength(1);
  });

  it("ignores a match value the form does not own", async () => {
    await saveService({
      name: "Odd",
      priceMin: "1",
      priceMax: "2",
      matches: ["landing-page", "not-a-real-rule"],
    });
    const [service] = await repo.listServices(scope);
    expect(service!.tags).toEqual(["landing-page"]);
  });

  it("preserves tags this form does not manage when editing", async () => {
    await repo.upsertService(
      scope,
      ServiceSchema.parse({
        id: "svc_legacy",
        name: "Legacy",
        description: "",
        priceMin: 100,
        priceMax: 200,
        tags: ["landing-page", "imported", "seo"],
        active: true,
      }),
    );
    await saveService({
      id: "svc_legacy",
      name: "Legacy",
      priceMin: "100",
      priceMax: "200",
      matches: ["conversion-fix"],
    });
    const service = await repo.getService(scope, "svc_legacy");
    expect(service!.tags).toContain("conversion-fix");
    expect(service!.tags).toContain("imported");
    expect(service!.tags).toContain("seo");
    expect(service!.tags).not.toContain("landing-page");
  });

  it("does not silently reactivate a deactivated service when it is edited", async () => {
    await saveService({ name: "X", priceMin: "1", priceMax: "2", matches: ["landing-page"] });
    const [created] = await repo.listServices(scope);
    await repo.setServiceActive(scope, created!.id, false);

    await saveService({
      id: created!.id,
      name: "X renamed",
      priceMin: "1",
      priceMax: "2",
      matches: ["landing-page"],
    });
    expect((await repo.getService(scope, created!.id))!.active).toBe(false);
  });

  it("refuses to edit a service that no longer exists", async () => {
    const res = (await saveService({
      id: "svc_gone",
      name: "Ghost",
      priceMin: "1",
      priceMax: "2",
    })) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no longer in your catalog/i);
  });

  it("toggling a missing service reports the problem rather than claiming success", async () => {
    const res = (await call(servicesIndex.action as never, {
      request: formReq({ intent: "toggle-active", id: "svc_gone", active: "on" }),
      context: ctx,
    })) as { ok: boolean };
    expect(res.ok).toBe(false);
  });
});

describe("adding a client", () => {
  const add = (fields: Record<string, string>) =>
    call(clientsIndex.action as never, { request: formReq(fields), context: ctx });

  it("reads a new site before asking the agency to confirm offerings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/robots.txt") || url.endsWith("/sitemap.xml")) {
          return new Response("", { status: 404 });
        }
        return new Response(
          "<!doctype html><html><head><title>Acme</title></head><body><h1>Acme</h1><p>" +
            "Roofing and siding for local homes. ".repeat(20) +
            "</p></body></html>",
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }),
    );

    const res = (await add({ name: "Acme", domain: "acme.example" })) as Response;

    expect(res.status).toBe(302);
    const clientId = new URL(res.headers.get("location")!, "http://localhost").searchParams.get(
      "client",
    )!;
    expect(res.headers.get("location")).toBe("/onboarding?client=" + clientId);
    const client = await repo.getClient(scope, clientId);
    expect(client!.offerings).toEqual([]);
    expect((await repo.getLatestEvidence(scope, clientId))?.site.pages.length).toBeGreaterThan(0);
    expect(await repo.getLatestAnalysisRun(scope, clientId)).toBeNull();
  });

  it("normalizes a pasted URL down to a hostname", async () => {
    const res = (await add({
      name: "Acme",
      domain: "HTTPS://Acme.example/services?x=1",
      offerings: "roofing\nsiding",
    })) as { ok: boolean };
    expect(res.ok).toBe(true);
    const [client] = await repo.listClients(scope);
    expect(client!.domain).toBe("acme.example");
    expect(client!.offerings).toEqual(["roofing", "siding"]);
  });

  it("rejects a domain that is not a hostname", async () => {
    const res = (await add({ name: "Acme", domain: "not a domain", offerings: "" })) as {
      ok: boolean;
      error?: string;
    };
    expect(res.ok).toBe(false);
    expect(await repo.listClients(scope)).toHaveLength(0);
  });

  it("refuses to watch the same domain twice", async () => {
    await add({ name: "Acme", domain: "acme.example", offerings: "" });
    const res = (await add({ name: "Acme Copy", domain: "https://acme.example/", offerings: "" })) as {
      ok: boolean;
      error?: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already watching/i);
    expect(await repo.listClients(scope)).toHaveLength(1);
  });

  it("gives each client a distinct id even with the same name", async () => {
    await add({ name: "Acme", domain: "acme-one.example", offerings: "" });
    await add({ name: "Acme", domain: "acme-two.example", offerings: "" });
    const clients = await repo.listClients(scope);
    expect(new Set(clients.map((c) => c.id)).size).toBe(2);
  });
});

describe("editing a client", () => {
  beforeEach(async () => {
    await repo.upsertClient(
      scope,
      ClientSchema.parse({
        id: "cli_a",
        name: "Acme",
        domain: "acme.example",
        offerings: ["roofing"],
        notes: "",
      }),
    );
  });

  const edit = (fields: Record<string, string>) =>
    call(clientDetail.action as never, {
      request: formReq({ intent: "save", ...fields }),
      params: { id: "cli_a" },
      context: ctx,
    });

  it("stores only owner-authorized official profile provenance and does not analyze by itself", async () => {
    const res = (await call(clientDetail.action as never, {
      request: formReq({
        intent: "import-external-profile",
        profileExport: JSON.stringify({
          provider: "google-business-profile-export",
          sourceRecordId: "location-123",
          sourceUrl: "https://business.google.com/locations/location-123",
          authorization: "owner-authorized-export",
          sourceField: "services",
          observedAt: "2026-09-07T12:00:00.000Z",
          retrievedAt: "2026-09-07T12:05:00.000Z",
          sourceVersion: "v1",
          services: ["Roofing", "Free Quotes"],
        }),
      }),
      params: { id: "cli_a" },
      context: ctx,
    })) as { ok: boolean; message?: string };

    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/profile service/i);
    const claims = await repo.listExternalBusinessClaims(scope, "cli_a");
    expect(claims).toHaveLength(2);
    expect(new Set(claims.map((claim) => claim.semanticState))).toEqual(
      new Set(["accepted", "rejected"]),
    );
    expect(await repo.getLatestAnalysisRun(scope, "cli_a")).toBeNull();
  });

  it("rejects a profile URL that is not the supported official source", async () => {
    const res = (await call(clientDetail.action as never, {
      request: formReq({
        intent: "import-external-profile",
        profileExport: JSON.stringify({
          provider: "google-business-profile-export",
          sourceRecordId: "location-123",
          sourceUrl: "https://example.com/profile/location-123",
          authorization: "owner-authorized-export",
          sourceField: "services",
          observedAt: "2026-09-07T12:00:00.000Z",
          retrievedAt: "2026-09-07T12:05:00.000Z",
          services: ["Roofing"],
        }),
      }),
      params: { id: "cli_a" },
      context: ctx,
    })) as { ok: boolean; error?: string };

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/official business profile/i);
    expect(await repo.listExternalBusinessClaims(scope, "cli_a")).toEqual([]);
  });

  it("previews an official ServiceList upload, then saves only after normal-user review", async () => {
    const profileJson = JSON.stringify({
      name: "accounts/123/locations/456/serviceList",
      serviceItems: [
        {
          isOffered: true,
          structuredServiceItem: { serviceTypeId: "water_heater_installation" },
        },
        {
          isOffered: true,
          freeFormServiceItem: {
            categoryId: "plumbing",
            label: { displayName: "Water Solutions", languageCode: "en" },
          },
        },
      ],
    });
    const previewBody = new FormData();
    previewBody.set("intent", "preview-business-profile");
    previewBody.set("ownerAuthorized", "on");
    previewBody.set("profileFile", new File([profileJson], "google-service-list.json", {
      type: "application/json",
    }));

    const preview = (await call(clientDetail.action as never, {
      request: new Request("http://localhost/", { method: "POST", body: previewBody }),
      params: { id: "cli_a" },
      context: ctx,
    })) as {
      ok: boolean;
      businessProfilePreview?: {
        profileJson: string;
        items: Array<{ id: string; normalizedLabel: string; semanticState: string }>;
      };
    };

    expect(preview.ok).toBe(true);
    expect(preview.businessProfilePreview?.items.map((item) => item.normalizedLabel)).toEqual([
      "Water Heater Installation",
      "Water Solutions",
    ]);
    expect(await repo.listExternalBusinessClaims(scope, "cli_a")).toEqual([]);

    const ambiguous = preview.businessProfilePreview!.items.find(
      (item) => item.semanticState === "ambiguous",
    )!;
    const confirmBody = new FormData();
    confirmBody.set("intent", "confirm-business-profile");
    confirmBody.set("ownerAuthorized", "on");
    confirmBody.set("profileJson", preview.businessProfilePreview!.profileJson);
    confirmBody.set("confirmClaim", ambiguous.normalizedLabel);

    const confirmed = (await call(clientDetail.action as never, {
      request: new Request("http://localhost/", { method: "POST", body: confirmBody }),
      params: { id: "cli_a" },
      context: ctx,
    })) as { ok: boolean; message?: string };

    expect(confirmed.ok).toBe(true);
    expect(confirmed.message).toMatch(/profile service/i);
    expect((await repo.listExternalBusinessClaims(scope, "cli_a")).map((claim) => claim.semanticState)).toEqual([
      "accepted",
      "accepted",
    ]);
  });

  it("surfaces the stored crawl reason on the client page", async () => {
    await repo.saveEvidence(
      scope,
      EvidenceBundleSchema.parse({
        clientId: "cli_a",
        source: "http",
        capturedAt: "2099-01-01T00:00:00.000Z",
        site: { pages: [], nav: [], links: [], sitemapUrls: [] },
        networkEvents: [
          {
            url: "https://acme.example/",
            outcome: "inconclusive",
            reason: "request timeout",
            code: "timeout",
            stage: "page",
          },
        ],
      }),
    );

    const data = (await clientDetail.loader({
      request: new Request("http://localhost/clients/cli_a"),
      params: { id: "cli_a" },
      context: ctx,
    } as never)) as { crawlFailure: { title: string; detail: string } | null };

    expect(data.crawlFailure?.title).toBe("The site did not respond to Orbit's request");
    expect(data.crawlFailure?.detail).toMatch(/incomplete read/i);
  });

  it("saves valid changes", async () => {
    const res = (await edit({
      name: "Acme Roofing",
      domain: "https://acmeroofing.example",
      offerings: "roofing\ngutters",
      notes: "Owner is Sam",
    })) as { ok: boolean };
    expect(res.ok).toBe(true);
    const client = await repo.getClient(scope, "cli_a");
    expect(client!.name).toBe("Acme Roofing");
    expect(client!.domain).toBe("acmeroofing.example");
    expect(client!.offerings).toEqual(["roofing", "gutters"]);
    expect(client!.notes).toBe("Owner is Sam");
  });

  it("applies the same validation as the create form", async () => {
    const res = (await edit({ name: "Acme", domain: "??", offerings: "" })) as {
      ok: boolean;
      error?: string;
    };
    expect(res.ok).toBe(false);
    expect((await repo.getClient(scope, "cli_a"))!.domain).toBe("acme.example");
  });

  it("refuses coverage for a service outside the catalog", async () => {
    const res = (await call(clientDetail.action as never, {
      request: formReq({ intent: "toggle-coverage", serviceId: "svc_ghost", covered: "on" }),
      params: { id: "cli_a" },
      context: ctx,
    })) as { ok: boolean };
    expect(res.ok).toBe(false);
    expect(await repo.listCoverage(scope, "cli_a")).toHaveLength(0);
  });

  it("marks matching findings covered when a service becomes contract-covered", async () => {
    await repo.upsertService(
      scope,
      ServiceSchema.parse({
        id: "svc_landing",
        name: "Landing page",
        description: "",
        priceMin: 900,
        priceMax: 1800,
        tags: ["landing-page"],
        active: true,
      }),
    );
    const finding = (id: string, status: "new" | "dismissed" | "snoozed", snoozeUntil?: string) =>
      OpportunitySchema.parse({
        id,
        dedupeKey: id,
        clientId: "cli_a",
        ruleId: "missing-service-page",
        title: `Finding ${id}`,
        detected: "The page is missing.",
        evidenceRefs: ["https://acme.example/services"],
        rationale: "It is sellable work.",
        suggestedServiceId: "svc_landing",
        suggestedScope: ["Build the page"],
        priceMin: 900,
        priceMax: 1800,
        confidence: 0.9,
        billableStatus: "billable",
        status,
        snoozeUntil,
        updatedAt: "2026-09-01T00:00:00.000Z",
      });
    await repo.saveAnalysis(scope, [
      finding("opp_open", "new"),
      finding("opp_expired", "snoozed", "2000-01-01T00:00:00.000Z"),
      finding("opp_active_snooze", "snoozed", "2999-01-01T00:00:00.000Z"),
      finding("opp_dismissed", "dismissed"),
    ]);

    const res = (await call(clientDetail.action as never, {
      request: formReq({ intent: "toggle-coverage", serviceId: "svc_landing", covered: "on" }),
      params: { id: "cli_a" },
      context: ctx,
    })) as { ok: boolean };

    expect(res.ok).toBe(true);
    // Open work (including an expired snooze) follows the contract: covered.
    for (const id of ["opp_open", "opp_expired", "opp_active_snooze"]) {
      const saved = await repo.getOpportunity(scope, id);
      expect(saved?.status).toBe("already_covered");
      expect(saved?.billableStatus).toBe("already_covered");
    }
    // A dismissal is the agency's own recorded decision. An unrelated
    // coverage toggle must not rewrite it — coverage wins only over work
    // that is still open. (This row was persisted as dismissed directly, so
    // it carries no dismissedAt; the domain-level milestone is pinned in
    // db.opportunityFunnel.test.ts.)
    const dismissed = await repo.getOpportunity(scope, "opp_dismissed");
    expect(dismissed?.status).toBe("dismissed");
    expect(dismissed?.billableStatus).toBe("billable");
  });
});
