import type { BetterAuthOptions } from "better-auth";

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";

const PASSWORD_RESET_SUBJECT = "Reset your Client Growth password";
const PASSWORD_RESET_TIMEOUT_MS = 10_000;

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
        "We received a request to reset your Client Growth password.",
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
