import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { stripJsonComments, validateProductionConfig } from "../scripts/production-preflight";

const configPath = join(process.cwd(), "wrangler.jsonc");

describe("production Wrangler configuration", () => {
  it("declares an isolated production Worker and D1 environment", () => {
    // wrangler.jsonc is JSONC. Parse it exactly the way the preflight script
    // does, so a legitimate config comment cannot fail this guard.
    const config = JSON.parse(stripJsonComments(readFileSync(configPath, "utf8"))) as {
      compatibility_date?: string;
      compatibility_flags?: string[];
      assets?: { binding?: string; directory?: string };
      observability?: { enabled?: boolean; logs?: { invocation_logs?: boolean } };
      d1_databases?: Array<{ binding?: string; database_name?: string }>;
      env?: {
        production?: {
          name?: string;
          d1_databases?: Array<{
            binding?: string;
            database_name?: string;
            database_id?: string;
            migrations_dir?: string;
          }>;
          vars?: Record<string, string>;
          secrets?: { required?: string[] };
        };
      };
    };
    const production = config.env?.production;
    const productionDb = production?.d1_databases?.[0];

    expect(config.compatibility_date).toBe("2026-08-31");
    expect(config.compatibility_flags).toContain("nodejs_compat");
    expect(config.assets).toEqual({ directory: "./build/client", binding: "ASSETS" });
    expect(config.observability?.enabled).toBe(true);
    expect(config.observability?.logs?.invocation_logs).toBe(false);
    expect(config.d1_databases?.[0]).toMatchObject({
      binding: "DB",
      database_name: "client-growth-dev",
    });
    expect(production?.name).toBe("client-growth-production");
    expect(productionDb).toMatchObject({
      binding: "DB",
      database_name: "client-growth-production",
      migrations_dir: "migrations",
    });
    expect(production?.vars).toMatchObject({
      AI_PROVIDER: "mock",
      MAX_AI_CALLS_PER_RUN: "10",
    });
    expect(production?.secrets?.required).toEqual(
      expect.arrayContaining(["BETTER_AUTH_SECRET", "RESEND_API_KEY"]),
    );
  });

  it("rejects placeholders and unsafe production settings before Wrangler runs", () => {
    const config = {
      compatibility_date: "2026-08-31",
      compatibility_flags: ["nodejs_compat"],
      assets: { directory: "./build/client", binding: "ASSETS" },
      observability: { enabled: true, logs: { invocation_logs: false } },
      d1_databases: [
        {
          binding: "DB",
          database_name: "client-growth-dev",
          database_id: "local-dev-placeholder",
          migrations_dir: "migrations",
        },
      ],
      env: {
        production: {
          name: "client-growth-production",
          d1_databases: [
            {
              binding: "DB",
              database_name: "client-growth-production",
              database_id: "__SET_AFTER_WRANGLER_D1_CREATE__",
              migrations_dir: "migrations",
            },
          ],
          vars: {
            AI_PROVIDER: "mock",
            MAX_AI_CALLS_PER_RUN: "10",
            BETTER_AUTH_URL: "https://replace-with-production-host.invalid",
            RESEND_FROM_EMAIL: "Client Growth <auth@replace-with-verified-sender.invalid>",
          },
          secrets: { required: ["BETTER_AUTH_SECRET"] },
        },
      },
    };

    const errors = validateProductionConfig(config);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("production D1 database_id"),
        expect.stringContaining("BETTER_AUTH_URL"),
        expect.stringContaining("RESEND_FROM_EMAIL"),
        expect.stringContaining("RESEND_API_KEY"),
      ]),
    );
  });
});
