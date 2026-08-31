import { betterAuth } from "better-auth";

import { buildAuthOptions } from "./authOptions";

type AuthInstance = ReturnType<typeof betterAuth>;

/**
 * One Better Auth instance per isolate, keyed by the D1 binding. Native D1:
 * `database` is the binding itself — no adapter dependency.
 */
const cache = new WeakMap<object, AuthInstance>();

export interface AuthEnv {
  DB: unknown;
  BETTER_AUTH_SECRET?: string;
  /** Trusted, explicit base URL. Never derived from a request Host/Origin. */
  BETTER_AUTH_URL?: string;
}

export function getAuth(env: AuthEnv): AuthInstance {
  const binding = env.DB as object;
  const existing = cache.get(binding);
  if (existing) return existing;

  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET is missing or too short (need >= 32 chars). Set it in .dev.vars locally or `wrangler secret put BETTER_AUTH_SECRET`.",
    );
  }
  const baseURL = env.BETTER_AUTH_URL?.trim();
  if (!baseURL || !/^https?:\/\//.test(baseURL)) {
    throw new Error(
      "BETTER_AUTH_URL is missing. Set the explicit, trusted base URL (e.g. http://localhost:8787 locally, https://app.example.com in production).",
    );
  }

  const auth = betterAuth(
    buildAuthOptions({ database: env.DB as never, secret, baseURL }),
  );
  cache.set(binding, auth);
  return auth;
}
