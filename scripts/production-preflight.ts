import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

type JsonObject = Record<string, unknown>;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(ROOT, "wrangler.jsonc");
const PRODUCTION_DATABASE_NAME = "client-growth-production";
const REQUIRED_SECRETS = ["BETTER_AUTH_SECRET", "RESEND_API_KEY"] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectValue(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function containsPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("replace-with") ||
    normalized.includes("__set") ||
    normalized.includes(".invalid") ||
    normalized.includes("example.com") ||
    normalized.includes("example.") ||
    normalized.includes("localhost") ||
    normalized.includes("127.0.0.1")
  );
}

/** Remove JSONC comments while preserving strings and line breaks. */
export function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i] ?? "";
    const next = input[i + 1] ?? "";

    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
        output += char;
      } else {
        output += " ";
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        output += "  ";
        i++;
      } else {
        output += char === "\n" || char === "\r" ? char : " ";
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      inLineComment = true;
      output += "  ";
      i++;
    } else if (char === "/" && next === "*") {
      inBlockComment = true;
      output += "  ";
      i++;
    } else {
      output += char;
    }
  }

  return output;
}

function productionConfig(config: unknown): JsonObject {
  return objectValue(objectValue(config).env && objectValue(objectValue(config).env).production);
}

function validateHttpsOrigin(value: string | undefined, name: string, errors: string[]): void {
  if (!value) {
    errors.push(`${name} must be configured in production vars`);
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    errors.push(`${name} must be a non-placeholder HTTPS origin`);
    return;
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    containsPlaceholder(parsed.hostname)
  ) {
    errors.push(`${name} must be a non-placeholder HTTPS origin`);
  }
}

export function validateProductionConfig(config: unknown): string[] {
  const errors: string[] = [];
  const root = objectValue(config);
  const production = productionConfig(config);
  const productionDbs = arrayValue(production.d1_databases).map(objectValue);
  const productionDb = productionDbs[0] ?? {};
  const productionVars = objectValue(production.vars);
  const declaredSecrets = arrayValue(objectValue(production.secrets).required).filter(
    (secret): secret is string => typeof secret === "string",
  );
  const observability = objectValue(production.observability ?? root.observability);
  const logs = objectValue(observability.logs);
  const flags = arrayValue(production.compatibility_flags ?? root.compatibility_flags);
  const assets = objectValue(production.assets ?? root.assets);

  if (stringValue(production.name) !== "client-growth-production") {
    errors.push('production Worker name must be "client-growth-production"');
  }

  if (productionDbs.length !== 1 || stringValue(productionDb.binding) !== "DB") {
    errors.push('production must declare exactly one D1 binding named DB');
  }
  if (stringValue(productionDb.database_name) !== PRODUCTION_DATABASE_NAME) {
    errors.push(`production D1 database_name must be "${PRODUCTION_DATABASE_NAME}"`);
  }
  const databaseId = stringValue(productionDb.database_id);
  if (!databaseId || !UUID_PATTERN.test(databaseId)) {
    errors.push("production D1 database_id is missing or not a UUID");
  }
  if (stringValue(productionDb.migrations_dir) !== "migrations") {
    errors.push('production D1 migrations_dir must be "migrations"');
  }

  const localDb = arrayValue(root.d1_databases).map(objectValue)[0];
  if (stringValue(localDb?.database_name) === PRODUCTION_DATABASE_NAME) {
    errors.push("local and production D1 database names must be different");
  }

  validateHttpsOrigin(stringValue(productionVars.BETTER_AUTH_URL), "BETTER_AUTH_URL", errors);

  const fromEmail = stringValue(productionVars.RESEND_FROM_EMAIL)?.trim();
  if (!fromEmail || containsPlaceholder(fromEmail) || !fromEmail.includes("@")) {
    errors.push("RESEND_FROM_EMAIL must be a verified non-placeholder email");
  }

  for (const secret of REQUIRED_SECRETS) {
    if (!declaredSecrets.includes(secret)) {
      errors.push(`production secret requirement missing: ${secret}`);
    }
  }

  const provider = stringValue(productionVars.AI_PROVIDER);
  if (provider !== "mock" && provider !== "deepseek") {
    errors.push('production AI_PROVIDER must be "mock" or "deepseek"');
  }
  if (provider === "deepseek") {
    if (!declaredSecrets.includes("DEEPSEEK_API_KEY")) {
      errors.push("production secret requirement missing: DEEPSEEK_API_KEY for deepseek");
    }
    validateHttpsOrigin(stringValue(productionVars.DEEPSEEK_BASE_URL), "DEEPSEEK_BASE_URL", errors);
    if (!stringValue(productionVars.DEEPSEEK_MODEL)?.trim()) {
      errors.push("DEEPSEEK_MODEL must be configured for deepseek");
    }
  }

  if (!flags.includes("nodejs_compat")) {
    errors.push('compatibility_flags must include "nodejs_compat"');
  }
  if (assets.binding !== "ASSETS" || assets.directory !== "./build/client") {
    errors.push('the Worker must bind ASSETS to "./build/client"');
  }
  if (observability.enabled !== true || logs.invocation_logs !== false) {
    errors.push("Workers observability must stay enabled with invocation_logs disabled");
  }

  return [...new Set(errors)];
}

function readConfig(): unknown {
  return JSON.parse(stripJsonComments(readFileSync(CONFIG_PATH, "utf8"))) as unknown;
}

function main(): void {
  let config: unknown;
  try {
    config = readConfig();
  } catch (error) {
    console.error(
      `Production preflight could not read ${CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
    return;
  }

  const errors = validateProductionConfig(config);
  if (errors.length > 0) {
    console.error("Production preflight failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    "Production preflight passed: config is structurally ready. Wrangler will still validate the remote D1 and encrypted secrets.",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
