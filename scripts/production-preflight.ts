import { readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

type JsonObject = Record<string, unknown>;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(ROOT, "wrangler.jsonc");

/** Kept in step with src/core/signupAccess.ts; this script must not import the app. */
const SIGNUP_MODES = ["open", "invite"] as const;
/** Kept in step with src/core/entitlements.ts; this script must not import the app. */
const MONITOR_ENTITLEMENT_MODES = ["off", "allowlist", "open"] as const;
/** The recurring-monitoring scan cron. The MONITOR digest runs on its own. */
const MONITORING_CRON = "0 * * * *";
const PRODUCTION_DATABASE_NAME = "client-growth-production";
const REQUIRED_SECRETS = ["BETTER_AUTH_SECRET", "RESEND_API_KEY"] as const;
const SECRET_LIKE_VAR_NAME = /(?:^|_)(?:API_KEY|KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS?|PRIVATE_KEY)$/i;
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

function rejectPlaintextSecretVars(vars: JsonObject, scope: string, errors: string[]): void {
  for (const key of Object.keys(vars)) {
    if (SECRET_LIKE_VAR_NAME.test(key)) {
      errors.push(
        `${scope} vars must not contain secret-like key "${key}"; use a Wrangler secret binding`,
      );
    }
  }
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
  rejectPlaintextSecretVars(objectValue(root.vars), "root", errors);
  rejectPlaintextSecretVars(productionVars, "production", errors);
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

  // Recurring monitoring runs unattended against production data, so its two
  // controls — that it is scheduled at all, and how much one tick may spend —
  // are checked here rather than discovered after a deploy.
  const crons = arrayValue(objectValue(production.triggers ?? root.triggers).crons).filter(
    (cron): cron is string => typeof cron === "string" && cron.trim().length > 0,
  );
  if (!crons.includes(MONITORING_CRON)) {
    errors.push(
      `production must declare the hourly recurring-monitoring cron "${MONITORING_CRON}"; ` +
        "the tick selects due clients itself, so one schedule serves every cadence",
    );
  }
  // MONITOR's weekly digest runs on its own daily cron, kept off the hourly scan
  // path so a digest never rides on the schedule that spends on the evaluator.
  const digestCrons = crons.filter((cron) => cron !== MONITORING_CRON);
  if (digestCrons.length !== 1) {
    errors.push(
      `production must declare exactly one daily MONITOR digest cron in addition to "${MONITORING_CRON}"`,
    );
  }

  const batch = stringValue(productionVars.MONITORING_MAX_CLIENTS_PER_RUN);
  const batchSize = batch === undefined ? undefined : Number(batch);
  if (
    batchSize !== undefined &&
    (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 25)
  ) {
    errors.push("MONITORING_MAX_CLIENTS_PER_RUN must be a whole number between 1 and 25");
  }

  // Admission to the product and the ceiling on the operator's own bill are
  // both things that must be true on purpose. Both have safe defaults in code,
  // but a default is what you get when nobody decided — so production is
  // required to say what it means, out loud, in a file under review.
  const signupMode = stringValue(productionVars.SIGNUP_MODE);
  if (signupMode === undefined) {
    errors.push(
      'production must declare SIGNUP_MODE explicitly ("invite" while there is no billing, ' +
        '"open" only as a deliberate decision)',
    );
  } else if (!SIGNUP_MODES.includes(signupMode as (typeof SIGNUP_MODES)[number])) {
    errors.push('production SIGNUP_MODE must be "open" or "invite"');
  }

  // MONITOR is a paid feature whose engine spends on the evaluator unattended
  // and whose digest emails agencies on its own. Whether it is sold, and to
  // whom, is a decision that belongs in a file under review — not a default.
  const monitorMode = stringValue(productionVars.MONITOR_ENTITLEMENT_MODE);
  if (monitorMode === undefined) {
    errors.push(
      'production must declare MONITOR_ENTITLEMENT_MODE explicitly ("off" until MONITOR is ' +
        'sold, "allowlist" to grant named agencies, "open" only once billing enforces it)',
    );
  } else if (
    !MONITOR_ENTITLEMENT_MODES.includes(monitorMode as (typeof MONITOR_ENTITLEMENT_MODES)[number])
  ) {
    errors.push('production MONITOR_ENTITLEMENT_MODE must be "off", "allowlist" or "open"');
  }

  // The console transport prints verification links to the log instead of
  // sending them. In production that would mean every account is unverifiable
  // and every reset link is in a log file, so it may not exist here at all.
  if (productionVars.EMAIL_TRANSPORT !== undefined) {
    errors.push(
      "production must not set EMAIL_TRANSPORT: it selects the development transport that " +
        "prints email instead of sending it",
    );
  }

  const platformCap = stringValue(productionVars.ANALYSIS_PLATFORM_DAILY_LIMIT);
  const platformCapValue = platformCap === undefined ? undefined : Number(platformCap);
  if (platformCap === undefined) {
    errors.push(
      "production must declare ANALYSIS_PLATFORM_DAILY_LIMIT: the per-workspace cap bounds " +
        "one tenant, not how many tenants there are",
    );
  } else if (
    !Number.isInteger(platformCapValue) ||
    platformCapValue! < 1 ||
    platformCapValue! > 10_000
  ) {
    errors.push("ANALYSIS_PLATFORM_DAILY_LIMIT must be a whole number between 1 and 10000");
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

/**
 * Configuration that is legal, but that someone should have to read out loud
 * before a deploy. A warning never fails the gate — it exists so that the
 * expensive settings cannot be changed quietly.
 */
export function productionConfigWarnings(config: unknown): string[] {
  const warnings: string[] = [];
  const root = objectValue(config);
  const production = objectValue(objectValue(root.env).production);
  const vars = objectValue(production.vars);

  if (stringValue(vars.SIGNUP_MODE) === "open") {
    warnings.push(
      'SIGNUP_MODE is "open": anyone with an email address can create a workspace and draw ' +
        "on the platform's daily analysis allowance. Safe only with billing, or with a " +
        "platform ceiling you would be content to pay in full.",
    );
  }

  if (stringValue(vars.MONITOR_ENTITLEMENT_MODE) === "open") {
    warnings.push(
      'MONITOR_ENTITLEMENT_MODE is "open": every workspace may turn on recurring scans and ' +
        "receive weekly digests. Recurring scans spend on the evaluator unattended, so this is " +
        "safe only with billing, or a platform ceiling you would be content to pay in full.",
    );
  }

  const platformCap = Number(stringValue(vars.ANALYSIS_PLATFORM_DAILY_LIMIT));
  const perRun = Number(stringValue(vars.MAX_AI_CALLS_PER_RUN));
  if (Number.isInteger(platformCap) && Number.isInteger(perRun)) {
    warnings.push(
      `Worst-case paid evaluator calls in one UTC day: ${platformCap * perRun} ` +
        `(${platformCap} analyses x ${perRun} calls). Confirm that number is one you would pay.`,
    );
  }

  return warnings;
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

  for (const warning of productionConfigWarnings(config)) {
    console.warn(`! ${warning}`);
  }

  console.log(
    "Production preflight passed: config is structurally ready. Wrangler will still validate the remote D1 and encrypted secrets.",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
