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
