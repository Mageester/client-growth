import { betterAuth } from "better-auth";

import { buildAuthOptions } from "./authOptions";
import {
  createConsoleEmailSender,
  createResendPasswordResetSender,
  createResendVerificationEmailSender,
  resolveMailTransport,
} from "./resend.server";
import { waitUntilInCurrentWorker } from "./workerContext.server";

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
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  EMAIL_TRANSPORT?: string;
}

export function getTrustedAuthBaseURL(env: Pick<AuthEnv, "BETTER_AUTH_URL">): string {
  const baseURL = env.BETTER_AUTH_URL?.trim();
  if (!baseURL || !/^https?:\/\//.test(baseURL)) {
    throw new Error(
      "BETTER_AUTH_URL is missing. Set the explicit, trusted base URL (e.g. http://localhost:8787 locally, https://app.example.com in production).",
    );
  }
  return baseURL;
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
  const baseURL = getTrustedAuthBaseURL(env);
  const transport = resolveMailTransport(env);

  const auth = betterAuth(
    buildAuthOptions({
      database: env.DB as never,
      secret,
      baseURL,
      sendResetPassword:
        transport.kind === "resend"
          ? createResendPasswordResetSender(transport.config)
          : transport.kind === "console"
            ? createConsoleEmailSender("password reset")
            : undefined,
      sendVerificationEmail:
        transport.kind === "resend"
          ? createResendVerificationEmailSender(transport.config)
          : transport.kind === "console"
            ? createConsoleEmailSender("email verification")
            : undefined,
      backgroundTaskHandler: waitUntilInCurrentWorker,
    }),
  );
  cache.set(binding, auth);
  return auth;
}
