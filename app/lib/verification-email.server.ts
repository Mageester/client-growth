const COOKIE_NAME = "axiom_verify_email";

/**
 * Carry the just-submitted verification recipient across one redirect without
 * putting personal data in browser history, referrer headers, or access logs.
 */
export function verificationEmailCookie(email: string, baseURL: string): string {
  const secure = new URL(baseURL).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(email.trim())}; Path=/login; Max-Age=600; HttpOnly; SameSite=Lax${secure}`;
}

export function verificationEmailFromRequest(request: Request): string {
  const raw = request.headers
    .get("Cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  if (!raw) return "";
  try {
    const email = decodeURIComponent(raw).trim();
    return email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email) ? email : "";
  } catch {
    return "";
  }
}
