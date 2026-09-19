// app/lib/resend.server.ts
var RESEND_EMAILS_URL = "https://api.resend.com/emails";
var MONITOR_DIGEST_TIMEOUT_MS = 1e4;
function resolveMailTransport(env2) {
  if (env2.EMAIL_TRANSPORT?.trim() === "console") return { kind: "console" };
  try {
    const config3 = getResendConfig(env2);
    if (config3) return { kind: "resend", config: config3 };
  } catch (error3) {
    return {
      kind: "none",
      reason: error3 instanceof Error ? `${error3.message}. Set both RESEND_API_KEY and RESEND_FROM_EMAIL.` : "Email configuration is incomplete. Set both RESEND_API_KEY and RESEND_FROM_EMAIL."
    };
  }
  return {
    kind: "none",
    reason: "No email transport is configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL, or EMAIL_TRANSPORT=console for local development."
  };
}
__name(resolveMailTransport, "resolveMailTransport");
function getResendConfig(env2) {
  const apiKey = env2.RESEND_API_KEY?.trim();
  const from = env2.RESEND_FROM_EMAIL?.trim();
  if (!apiKey && !from) return null;
  if (!apiKey || !from) {
    throw new Error("Resend password-reset email configuration is incomplete");
  }
  return { apiKey, from };
}
__name(getResendConfig, "getResendConfig");
function createResendMonitorDigestSender(config3, fetcher = fetch) {
  return async ({ to, workspaceId, periodStart, subject, text, html: html2 }) => {
    const body = { from: config3.from, to: [to], subject, text, html: html2 };
    let response;
    try {
      response = await fetcher(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config3.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `monitor-digest/${workspaceId}/${periodStart}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(MONITOR_DIGEST_TIMEOUT_MS)
      });
    } catch {
      throw new Error("Monitor digest email delivery failed");
    }
    if (!response.ok) throw new Error("Monitor digest email delivery failed");
  };
}
__name(createResendMonitorDigestSender, "createResendMonitorDigestSender");
