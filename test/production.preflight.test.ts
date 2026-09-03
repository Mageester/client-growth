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
    // Production runs the real evaluator. This is pinned deliberately: an
    // accidental provider change - in either direction - must fail CI rather
    // than ship quietly. A rollback to "mock" flips this line and the wrangler
    // var together, in one commit.
    expect(production?.vars).toMatchObject({
      AI_PROVIDER: "deepseek",
      DEEPSEEK_BASE_URL: "https://api.deepseek.com",
      DEEPSEEK_MODEL: "deepseek-chat",
      MAX_AI_CALLS_PER_RUN: "10",
    });
    expect(production?.secrets?.required).toEqual(
      expect.arrayContaining(["BETTER_AUTH_SECRET", "RESEND_API_KEY", "DEEPSEEK_API_KEY"]),
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
            RESEND_FROM_EMAIL: "Axiom Orbit <auth@replace-with-verified-sender.invalid>",
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

  it("rejects secret-like values from plaintext Wrangler vars", () => {
    const config = JSON.parse(stripJsonComments(readFileSync(configPath, "utf8"))) as {
      vars?: Record<string, string>;
      env?: { production?: { vars?: Record<string, string> } };
    };
    config.vars = { ...config.vars, INTERNAL_TOKEN: "token-fixture" };
    config.env = {
      ...config.env,
      production: {
        ...config.env?.production,
        vars: {
          ...config.env?.production?.vars,
          RESEND_API_KEY: "re_test_fixture",
        },
      },
    };

    const errors = validateProductionConfig(config);

    expect(errors).toEqual(
      expect.arrayContaining([
        'root vars must not contain secret-like key "INTERNAL_TOKEN"; use a Wrangler secret binding',
        'production vars must not contain secret-like key "RESEND_API_KEY"; use a Wrangler secret binding',
      ]),
    );
  });

  it("requires exactly one cron trigger for recurring monitoring", () => {
    const config = clone(readConfig());
    expect(validateProductionConfig(config)).toEqual([]);

    // One trigger for the whole product. The tick selects due clients itself, so
    // a second schedule is duplicated unattended spend, and none is a scheduler
    // that silently never runs.
    for (const triggers of [undefined, { crons: [] }, { crons: ["0 * * * *", "30 * * * *"] }]) {
      const broken = clone(config);
      // Remove the inheritable root trigger too, or production would inherit it.
      delete broken.triggers;
      if (triggers === undefined) delete broken.env.production.triggers;
      else broken.env.production.triggers = triggers;

      expect(validateProductionConfig(broken)).toEqual(
        expect.arrayContaining([expect.stringMatching(/exactly one cron trigger/)]),
      );
    }
  });

  it("rejects a monitoring batch size that could surprise a bill", () => {
    const config = clone(readConfig());
    for (const value of ["0", "-1", "40", "many", "2.5"]) {
      const broken = clone(config);
      broken.env.production.vars.MONITORING_MAX_CLIENTS_PER_RUN = value;
      expect(validateProductionConfig(broken), value).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/MONITORING_MAX_CLIENTS_PER_RUN must be a whole number/),
        ]),
      );
    }
  });
});

/** The parts of wrangler.jsonc these two cases mutate. */
interface MutableConfig {
  triggers?: { crons?: string[] };
  env: {
    production: {
      triggers?: { crons?: string[] };
      vars: Record<string, string>;
    };
  };
}

function readConfig(): MutableConfig {
  return JSON.parse(stripJsonComments(readFileSync(configPath, "utf8"))) as MutableConfig;
}

function clone(config: MutableConfig): MutableConfig {
  return structuredClone(config);
}
