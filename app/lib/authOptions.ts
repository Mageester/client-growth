import type { BetterAuthOptions } from "better-auth";

/**
 * The single source of truth for Better Auth configuration. The Worker builds
 * its auth instance from these options + the D1 binding (auth.server.ts); the
 * schema generator and the drift test import the same function so the committed
 * migration can never disagree with the pinned version.
 */
export const PINNED_BETTER_AUTH_VERSION = "1.7.2";

export interface AuthDeps {
  /** A D1Database in the Worker, or a better-sqlite3 instance in tooling/tests. */
  database: BetterAuthOptions["database"];
  secret: string;
  baseURL: string;
}

export function buildAuthOptions(deps: AuthDeps): BetterAuthOptions {
  return {
    appName: "Client Growth",
    database: deps.database,
    secret: deps.secret,
    baseURL: deps.baseURL,
    emailAndPassword: {
      enabled: true,
      // Deferred this phase — see README: PASSWORD RESET IS REQUIRED BEFORE
      // EXTERNAL AGENCY PILOT.
      requireEmailVerification: false,
    },
    // Plain database-backed sessions. Cookie caching intentionally OFF for now.
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // sliding refresh, once per day
    },
    // Authentication boundary: persist rate-limit counters in D1, not per-isolate memory.
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 20,
    },
  };
}
