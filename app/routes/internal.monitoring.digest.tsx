import { d1Db } from "../lib/d1.server";
import { runMonitorDigestTick } from "../lib/monitorDigest.server";
import type { Route } from "./+types/internal.monitoring.digest";

/**
 * Operator-only trigger for the MONITOR weekly-digest tick.
 *
 * It calls `runMonitorDigestTick` — the exact function the daily cron calls, with
 * the same due-workspace selection and the same entitlement gate — so verifying
 * the digest on a canary needs no waiting for a cron boundary and exercises the
 * real path rather than a parallel one.
 *
 * Safety properties mirror the monitoring trigger:
 *   - inert (404) unless MONITOR_DIGEST_TRIGGER_TOKEN is configured as a secret;
 *   - processes only workspaces genuinely due, and only entitled ones send;
 *   - respects the same claim, so firing it during the real tick is safe;
 *   - returns counts only, never client data or any email content.
 */

const MIN_TOKEN_LENGTH = 32;

/** Compare digests, not strings: equal work regardless of where they differ. */
async function tokensMatch(presented: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < left.length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** GET is never a way to start unattended work. */
export function loader() {
  throw new Response("Not found", { status: 404 });
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as Record<string, unknown>;
  const expected =
    typeof env.MONITOR_DIGEST_TRIGGER_TOKEN === "string" ? env.MONITOR_DIGEST_TRIGGER_TOKEN : "";

  // Not configured: the endpoint does not exist. A short or blank token is
  // treated as not configured rather than as a weak one.
  if (expected.trim().length < MIN_TOKEN_LENGTH) {
    throw new Response("Not found", { status: 404 });
  }
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }
  if (!(await tokensMatch(bearer(request), expected))) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const result = await runMonitorDigestTick({
    db: d1Db(context.cloudflare.env.DB as never),
    env,
  });

  return json(
    {
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      considered: result.considered,
      sent: result.sent,
      skipped: result.skipped,
      failed: result.failed,
      // Outcome per workspace, without naming it. Enough to confirm the canary
      // ran and what it decided; nothing an operator does not need.
      outcomes: result.workspaces.map((w) => w.outcome),
    },
    200,
  );
}
