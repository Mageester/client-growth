import { normalizeOrigin } from "@/adapters/evidence/urlPolicy";

export interface DomainCheck {
  ok: boolean;
  /** The stored form: bare host (plus port), no scheme, no trailing slash. */
  domain: string;
  error?: string;
}

/**
 * Normalize and validate a client website domain at the point of entry.
 *
 * Without this, an unusable value ("acme plumbing", "htp://x", a private host)
 * is stored happily and only fails later inside the crawler, where the agency
 * never sees it. The same policy that governs the crawl decides here.
 */
export function checkClientDomain(raw: string): DomainCheck {
  const trimmed = raw.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!trimmed) {
    return { ok: false, domain: "", error: "Enter the client's website domain." };
  }

  const result = normalizeOrigin(trimmed);
  if (!result.ok) {
    const detail =
      result.kind === "private-host" || result.kind === "internal-hostname"
        ? "That address is not a public website."
        : "That does not look like a website domain (example: acmeplumbing.com).";
    return { ok: false, domain: trimmed, error: `“${trimmed}” cannot be analyzed. ${detail}` };
  }

  const url = result.url;
  return { ok: true, domain: url.host };
}
