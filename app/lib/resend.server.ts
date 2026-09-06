import type { BetterAuthOptions } from "better-auth";

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";

const PASSWORD_RESET_SUBJECT = "Reset your Axiom Orbit password";
const EMAIL_VERIFICATION_SUBJECT = "Verify your Axiom Orbit email";
const TEAM_INVITATION_TIMEOUT_MS = 10_000;
const PASSWORD_RESET_TIMEOUT_MS = 10_000;
const EMAIL_VERIFICATION_TIMEOUT_MS = 10_000;

export interface ResendEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  /**
   * Development escape hatch. "console" prints the link that would have been
   * emailed instead of sending it, so local sign-up works without a Resend
   * key. Production preflight refuses to let this exist in production vars —
   * see scripts/production-preflight.ts.
   */
  EMAIL_TRANSPORT?: string;
}

/**
 * How this environment can deliver an email, resolved once so that every
 * caller asks the same question and gets the same answer.
 *
 * The reason this exists at all: email verification is REQUIRED to sign in, so
 * an environment that cannot send email cannot create a usable account. Better
 * Auth's `sendOnSignUp` with no sender configured is a silent no-op — the
 * account is created, no mail is sent, nothing is logged, and the person can
 * never log in. Every entry point that depends on delivery checks this first
 * and refuses out loud instead.
 */
export type MailTransport =
  | { kind: "resend"; config: ResendConfig }
  | { kind: "console" }
  | { kind: "none"; reason: string };

export function resolveMailTransport(env: ResendEnv): MailTransport {
  if (env.EMAIL_TRANSPORT?.trim() === "console") return { kind: "console" };

  // `getResendConfig` throws when exactly one of the pair is set, which is the
  // single likeliest production misconfiguration: the sender address lives in
  // wrangler.jsonc where it is easy to see, and the API key is an encrypted
  // secret that is easy to forget. Callers of this function are deciding
  // whether they can send at all, and the honest answer to "half configured" is
  // "no, and here is why" — not a 500 on somebody's sign-up.
  try {
    const config = getResendConfig(env);
    if (config) return { kind: "resend", config };
  } catch (error) {
    return {
      kind: "none",
      reason:
        error instanceof Error
          ? `${error.message}. Set both RESEND_API_KEY and RESEND_FROM_EMAIL.`
          : "Email configuration is incomplete. Set both RESEND_API_KEY and RESEND_FROM_EMAIL.",
    };
  }

  return {
    kind: "none",
    reason:
      "No email transport is configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL, or EMAIL_TRANSPORT=console for local development.",
  };
}

/** Whether this environment can deliver the mail a sign-in depends on. */
export function canDeliverEmail(env: ResendEnv): boolean {
  return resolveMailTransport(env).kind !== "none";
}

/**
 * Local-development sender: prints the link a real transport would have
 * emailed. Never reachable in production — preflight rejects the variable that
 * selects it.
 */
export function createConsoleEmailSender(
  label: string,
): (message: { user: { email: string }; url: string }) => Promise<void> {
  return async ({ user, url }) => {
    console.log(`[email:console] ${label} for ${user.email}: ${url}`);
  };
}

export interface ResendConfig {
  apiKey: string;
  from: string;
}

export type PasswordResetSender = NonNullable<
  NonNullable<BetterAuthOptions["emailAndPassword"]>["sendResetPassword"]
>;

export type VerificationEmailSender = NonNullable<
  NonNullable<BetterAuthOptions["emailVerification"]>["sendVerificationEmail"]
>;

export interface TeamInvitationEmail {
  email: string;
  workspaceName: string;
  role: string;
  url: string;
  token: string;
  expiresAt: string;
}

export type TeamInvitationSender = (message: TeamInvitationEmail) => Promise<void>;

export function getResendConfig(env: ResendEnv): ResendConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM_EMAIL?.trim();

  if (!apiKey && !from) return null;
  if (!apiKey || !from) {
    throw new Error("Resend password-reset email configuration is incomplete");
  }

  return { apiKey, from };
}

export function createResendPasswordResetSender(
  config: ResendConfig,
  fetcher: typeof fetch = fetch,
): PasswordResetSender {
  return async ({ user, url, token }) => {
    const body = {
      from: config.from,
      to: [user.email],
      subject: PASSWORD_RESET_SUBJECT,
      text: [
        "We received a request to reset your Axiom Orbit password.",
        "",
        `Reset your password: ${url}`,
        "",
        "This link expires in 1 hour and can be used once.",
        "If you did not request this, you can ignore this email.",
      ].join("\n"),
    };

    let response: Response;
    try {
      response = await fetcher(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `password-reset/${token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PASSWORD_RESET_TIMEOUT_MS),
      });
    } catch {
      throw new Error("Password reset email delivery failed");
    }

    if (!response.ok) {
      throw new Error("Password reset email delivery failed");
    }
  };
}

export function createResendVerificationEmailSender(
  config: ResendConfig,
  fetcher: typeof fetch = fetch,
): VerificationEmailSender {
  return async ({ user, url, token }) => {
    const body = {
      from: config.from,
      to: [user.email],
      subject: EMAIL_VERIFICATION_SUBJECT,
      text: [
        "Please verify your Axiom Orbit email address.",
        "",
        `Verify your email: ${url}`,
        "",
        "This link expires in 1 hour.",
        "If you did not create an Axiom Orbit account, you can ignore this email.",
      ].join("\n"),
    };

    let response: Response;
    try {
      response = await fetcher(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `email-verification/${token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(EMAIL_VERIFICATION_TIMEOUT_MS),
      });
    } catch {
      throw new Error("Verification email delivery failed");
    }

    if (!response.ok) throw new Error("Verification email delivery failed");
  };
}

export function createResendTeamInvitationSender(
  config: ResendConfig,
  fetcher: typeof fetch = fetch,
): TeamInvitationSender {
  return async ({ email, workspaceName, role, url, token, expiresAt }) => {
    const body = {
      from: config.from,
      to: [email],
      subject: `Join ${workspaceName} on Axiom Orbit`,
      text: [
        `${workspaceName} invited you to collaborate in Axiom Orbit as a ${role}.`,
        "",
        `Accept the invitation: ${url}`,
        "",
        `This invitation expires on ${expiresAt} and can be accepted once.`,
        "If you were not expecting this, you can ignore this email.",
      ].join("\n"),
    };

    let response: Response;
    try {
      response = await fetcher(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `team-invitation/${token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TEAM_INVITATION_TIMEOUT_MS),
      });
    } catch {
      throw new Error("Team invitation email delivery failed");
    }

    if (!response.ok) throw new Error("Team invitation email delivery failed");
  };
}
